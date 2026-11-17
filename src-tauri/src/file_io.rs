use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())
}

pub fn check_in_home(path: &Path) -> Result<(), String> {
    // This enforces the Flatpak sandbox boundary: Flatpak apps are expected to
    // access only the user's home directory, so we hard-fail for paths outside
    // it. FLATPAK_ID is set by the Flatpak runtime for every process it
    // launches (mirrors the APPIMAGE-detection pattern in main.rs/lifecycle.rs)
    // — deb/rpm/AppImage/native Linux builds are not sandboxed this way and,
    // like macOS/Windows, legitimately need to open/save files anywhere (external
    // drives, /mnt, /media, NAS mounts), so the check is skipped for them.
    // canonicalize() already prevents path-traversal attacks on every platform
    // by resolving symlinks and .. components, regardless of this check.
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path; // suppress unused-variable warning
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var("FLATPAK_ID").is_err() {
            return Ok(());
        }
        check_within_home(path, &home_dir()?)
    }
}

/// True when `path` is `home` or lies beneath it. Compares whole path
/// components, so `/home/ross2` is not inside `/home/ross`. Pure: does not
/// touch the filesystem, so callers must pass already-canonical paths.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn is_within(path: &Path, home: &Path) -> bool {
    path.starts_with(home)
}

/// The Flatpak home-boundary check against an explicit `home`, so tests can
/// use a temp directory instead of mutating $HOME / FLATPAK_ID.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn check_within_home(path: &Path, home: &Path) -> Result<(), String> {
    let canonical_home = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    if is_within(path, &canonical_home) {
        Ok(())
    } else {
        Err("Access denied: path is outside your home directory".to_string())
    }
}

// For reads the file must exist, so canonicalize resolves symlinks and traversal.
pub fn safe_read_path(path: &str) -> Result<PathBuf, String> {
    resolve_read_path(path, check_in_home)
}

fn resolve_read_path(
    path: &str,
    check: impl Fn(&Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    check(&canonical)?;
    Ok(canonical)
}

// For writes the file may not exist yet; canonicalize the parent instead.
pub fn safe_write_path(path: &str) -> Result<PathBuf, String> {
    resolve_write_path(path, check_in_home)
}

fn resolve_write_path(
    path: &str,
    check: impl Fn(&Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let parent = p.parent().ok_or_else(|| "Invalid path: no parent directory".to_string())?;
    let filename = p.file_name().ok_or_else(|| "Invalid path: no filename".to_string())?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Failed to write file: {e}"))?;
    let resolved = canonical_parent.join(filename);
    check(&resolved)?;
    Ok(resolved)
}

/// `std::fs::canonicalize` on Windows returns the `\\?\` extended-length
/// ("verbatim") prefix form (and `\\?\UNC\host\share` for UNC paths), which
/// several downstream consumers of a canonicalised path don't expect: the
/// frontend derives a document directory from it with plain string
/// splitting (see resolvePath.ts) and mistakes the literal `?` for the start
/// of a URL query string, and Explorer's `/select` doesn't recognise the
/// prefix either. Strips it back to the ordinary `C:\...` /
/// `\\host\share\...` form other platforms already return.
#[cfg(windows)]
pub fn strip_verbatim_prefix(path: String) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path
    }
}

#[cfg(not(windows))]
pub fn strip_verbatim_prefix(path: String) -> String {
    path
}

pub fn read(path: &str) -> Result<String, String> {
    let safe = safe_read_path(path)?;
    std::fs::read_to_string(&safe).map_err(|e| format!("Failed to read file: {e}"))
}

pub fn write(path: &str, content: &str) -> Result<(), String> {
    let safe = safe_write_path(path)?;
    atomic_write(&safe, content.as_bytes())
}

pub fn write_bytes(path: &str, bytes: &[u8]) -> Result<(), String> {
    let safe = safe_write_path(path)?;
    atomic_write(&safe, bytes)
}

static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

// Writes `data` to `dest` via a sibling temp file then an atomic rename.
// Keeps the temp file in the same directory as `dest` so the rename is
// guaranteed to be on the same filesystem (required on Windows).
// On POSIX the rename is atomic; on Windows it is near-atomic (the OS
// replaces the destination in a single kernel transaction on NTFS).
fn atomic_write(dest: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let seq = WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dest.with_file_name(format!(
        "{}.{}.kova-tmp",
        dest.file_name().unwrap_or_default().to_string_lossy(),
        seq
    ));
    std::fs::write(&tmp, data)
        .map_err(|e| format!("Failed to write file: {e}"))?;
    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to save file: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// A fresh, empty directory under the system temp dir, removed on drop.
    /// Unique per test (pid + counter) so parallel tests never collide.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let n = SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("kova-file-io-{}-{}-{}", label, std::process::id(), n));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            // Canonicalise so assertions compare like with like (macOS /var -> /private/var).
            TempDir(std::fs::canonicalize(&dir).unwrap())
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    // ── safe_read_path / safe_write_path path resolution ─────────────────
    // These run outside Flatpak (FLATPAK_ID is not set under `cargo test`),
    // so the home-boundary check is a no-op and they pin down the resolution
    // behaviour every platform relies on.

    #[test]
    fn read_ok_path_returns_canonical_path() {
        let t = TempDir::new("read-ok");
        let f = t.path().join("deck.md");
        std::fs::write(&f, "# hi").unwrap();
        assert_eq!(safe_read_path(s(&f)).unwrap(), f);
    }

    #[test]
    fn read_resolves_dotdot_traversal() {
        let t = TempDir::new("read-dotdot");
        std::fs::create_dir(t.path().join("a")).unwrap();
        let f = t.path().join("deck.md");
        std::fs::write(&f, "x").unwrap();
        let sneaky = t.path().join("a").join("..").join("deck.md");
        assert_eq!(safe_read_path(s(&sneaky)).unwrap(), f);
    }

    #[test]
    fn read_missing_file_is_an_error() {
        let t = TempDir::new("read-missing");
        let err = safe_read_path(s(&t.path().join("nope.md"))).unwrap_err();
        assert!(err.starts_with("Failed to read file:"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn read_resolves_symlink_to_its_target() {
        let t = TempDir::new("read-symlink");
        let target = t.path().join("real.md");
        std::fs::write(&target, "x").unwrap();
        let link = t.path().join("link.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(safe_read_path(s(&link)).unwrap(), target);
    }

    #[test]
    fn write_ok_path_for_new_file() {
        let t = TempDir::new("write-ok");
        let f = t.path().join("new.md");
        assert_eq!(safe_write_path(s(&f)).unwrap(), f);
    }

    #[test]
    fn write_resolves_dotdot_in_parent() {
        let t = TempDir::new("write-dotdot");
        std::fs::create_dir(t.path().join("a")).unwrap();
        let sneaky = t.path().join("a").join("..").join("new.md");
        assert_eq!(safe_write_path(s(&sneaky)).unwrap(), t.path().join("new.md"));
    }

    #[test]
    fn write_missing_parent_is_an_error() {
        let t = TempDir::new("write-missing-parent");
        let f = t.path().join("no-such-dir").join("new.md");
        let err = safe_write_path(s(&f)).unwrap_err();
        assert!(err.starts_with("Failed to write file:"), "{err}");
    }

    #[test]
    fn write_path_ending_in_dotdot_has_no_filename() {
        let t = TempDir::new("write-no-name");
        let p = t.path().join("..");
        assert_eq!(
            safe_write_path(s(&p)).unwrap_err(),
            "Invalid path: no filename"
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_resolves_symlinked_parent_dir() {
        let t = TempDir::new("write-symlink-dir");
        let real = t.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = t.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(
            safe_write_path(s(&link.join("new.md"))).unwrap(),
            real.join("new.md")
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_over_symlink_replaces_the_link_not_its_target() {
        // safe_write_path only canonicalises the parent, so a filename that is
        // itself a symlink is passed through unresolved. That is safe because
        // the atomic write renames over the link, leaving the target alone.
        let outside = TempDir::new("write-symlink-outside");
        let target = outside.path().join("victim.txt");
        std::fs::write(&target, "original").unwrap();
        let t = TempDir::new("write-symlink-file");
        let link = t.path().join("deck.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        write(s(&link), "new").unwrap();

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "original");
        assert!(!std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "new");
    }

    // ── Home boundary (the check enforced under Flatpak) ─────────────────
    // The FLATPAK_ID gate itself isn't unit tested: mutating process-global
    // env vars in parallel test runs is racy. Instead these drive the same
    // check through a seam that takes `home` explicitly.

    #[test]
    fn is_within_accepts_home_and_paths_beneath_it() {
        let home = Path::new("/home/ross");
        assert!(is_within(home, home));
        assert!(is_within(Path::new("/home/ross/Documents/deck.md"), home));
    }

    #[test]
    fn is_within_rejects_paths_outside_home() {
        let home = Path::new("/home/ross");
        assert!(!is_within(Path::new("/home/other/secret.txt"), home));
        assert!(!is_within(Path::new("/etc/passwd"), home));
        assert!(!is_within(Path::new("/home"), home));
    }

    #[test]
    fn is_within_rejects_sibling_with_shared_prefix() {
        // A naive string prefix check would wrongly accept this.
        assert!(!is_within(Path::new("/home/ross2/deck.md"), Path::new("/home/ross")));
    }

    fn in_home(home: &Path) -> impl Fn(&Path) -> Result<(), String> + '_ {
        move |p| check_within_home(p, home)
    }

    const DENIED: &str = "Access denied: path is outside your home directory";

    #[test]
    fn boundary_read_ok_inside_home() {
        let home = TempDir::new("b-read-ok");
        let f = home.path().join("deck.md");
        std::fs::write(&f, "x").unwrap();
        assert_eq!(resolve_read_path(s(&f), in_home(home.path())).unwrap(), f);
    }

    #[test]
    fn boundary_read_dotdot_escape_is_denied() {
        let root = TempDir::new("b-read-dotdot");
        let home = root.path().join("home");
        std::fs::create_dir(&home).unwrap();
        std::fs::write(root.path().join("secret.txt"), "x").unwrap();
        let sneaky = home.join("..").join("secret.txt");
        assert_eq!(resolve_read_path(s(&sneaky), in_home(&home)).unwrap_err(), DENIED);
    }

    #[cfg(unix)]
    #[test]
    fn boundary_read_symlink_escape_is_denied() {
        let home = TempDir::new("b-read-link-home");
        let outside = TempDir::new("b-read-link-out");
        let target = outside.path().join("secret.txt");
        std::fs::write(&target, "x").unwrap();
        let link = home.path().join("innocent.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(resolve_read_path(s(&link), in_home(home.path())).unwrap_err(), DENIED);
    }

    #[test]
    fn boundary_write_ok_inside_home() {
        let home = TempDir::new("b-write-ok");
        let f = home.path().join("new.md");
        assert_eq!(resolve_write_path(s(&f), in_home(home.path())).unwrap(), f);
    }

    #[test]
    fn boundary_write_dotdot_escape_is_denied() {
        let root = TempDir::new("b-write-dotdot");
        let home = root.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let sneaky = home.join("..").join("new.md");
        assert_eq!(resolve_write_path(s(&sneaky), in_home(&home)).unwrap_err(), DENIED);
    }

    #[cfg(unix)]
    #[test]
    fn boundary_write_symlinked_dir_escape_is_denied() {
        let home = TempDir::new("b-write-link-home");
        let outside = TempDir::new("b-write-link-out");
        let link = home.path().join("dir");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        let f = link.join("new.md");
        assert_eq!(resolve_write_path(s(&f), in_home(home.path())).unwrap_err(), DENIED);
    }

    #[test]
    fn boundary_write_missing_parent_errors_before_boundary_check() {
        let home = TempDir::new("b-write-missing");
        let f = home.path().join("no-such-dir").join("new.md");
        let err = resolve_write_path(s(&f), in_home(home.path())).unwrap_err();
        assert!(err.starts_with("Failed to write file:"), "{err}");
    }
}
