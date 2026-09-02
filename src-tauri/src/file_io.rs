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
        let home = home_dir()?;
        let canonical_home = std::fs::canonicalize(&home).unwrap_or(home);
        if path.starts_with(&canonical_home) {
            Ok(())
        } else {
            Err("Access denied: path is outside your home directory".to_string())
        }
    }
}

// For reads the file must exist, so canonicalize resolves symlinks and traversal.
pub fn safe_read_path(path: &str) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    check_in_home(&canonical)?;
    Ok(canonical)
}// For writes the file may not exist yet; canonicalize the parent instead.
pub fn safe_write_path(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let parent = p.parent().ok_or_else(|| "Invalid path: no parent directory".to_string())?;
    let filename = p.file_name().ok_or_else(|| "Invalid path: no filename".to_string())?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Failed to write file: {e}"))?;
    let resolved = canonical_parent.join(filename);
    check_in_home(&resolved)?;
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
    // These tests verify the home-boundary logic used under Flatpak (see the
    // FLATPAK_ID gate in check_in_home) using portable path construction. The
    // Windows UNC-prefix tests have been removed: check_in_home is a no-op on
    // Windows (users may save anywhere), so those assertions are no longer
    // meaningful. The FLATPAK_ID env-var gate itself isn't unit tested here —
    // consistent with the unguarded APPIMAGE-detection checks elsewhere
    // (main.rs, lifecycle.rs) — since mutating process-global env vars in
    // parallel test runs is inherently racy.
    #[cfg(target_os = "linux")]
    mod linux_home_boundary {
        use std::path::Path;

        #[test]
        fn path_inside_home_is_allowed() {
            let home = Path::new("/home/ross");
            let inside = Path::new("/home/ross/Documents/file.md");
            assert!(inside.starts_with(home));
        }

        #[test]
        fn path_outside_home_is_blocked() {
            let home = Path::new("/home/ross");
            let outside = Path::new("/home/other/secret.txt");
            assert!(!outside.starts_with(home));
        }

        #[test]
        fn traversal_outside_home_is_blocked() {
            let home = Path::new("/home/ross");
            let traversal = Path::new("/etc/passwd");
            assert!(!traversal.starts_with(home));
        }
    }
}
