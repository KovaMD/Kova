use crate::file_io;

// Sanitise a filename stem: replace whitespace and characters that break Markdown
// link syntax with underscores.
fn sanitise_stem(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_whitespace() || matches!(c, '(' | ')' | '[' | ']' | '"' | '\'') { '_' } else { c })
        .collect()
}

// Validate dest_dir, create assets/ subdirectory, and return its path.
fn prepare_assets_dir(dest_dir: &str) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(dest_dir)
        .map_err(|e| format!("Cannot access destination directory: {e}"))?;
    file_io::check_in_home(&canonical)?;
    let assets_dir = canonical.join("assets");
    std::fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Cannot create assets dir: {e}"))?;
    Ok(assets_dir)
}

// True if `path` exists and its contents are byte-identical to `bytes`.
fn file_matches_bytes(path: &std::path::Path, bytes: &[u8]) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() as usize == bytes.len() => {
            std::fs::read(path).map(|existing| existing == bytes).unwrap_or(false)
        }
        _ => false,
    }
}

// Write `bytes` into `assets_dir` under `{stem}.{ext}`, appending a numeric
// suffix on name collisions. If a colliding file already holds identical
// content, its name is reused instead of writing a fresh copy — this avoids
// piling up duplicate `-1`, `-2`, ... copies when the same asset is removed
// and re-added (its old, now-orphaned file is still sitting in assets_dir).
fn write_bytes_to_assets(bytes: &[u8], stem: &str, ext: &str, assets_dir: &std::path::Path) -> Result<String, String> {
    use std::io::Write;
    let mut name = format!("{stem}.{ext}");
    let mut counter = 1u32;
    loop {
        if counter > 10_000 {
            return Err("Too many files with the same name in assets/".into());
        }
        let dest = assets_dir.join(&name);
        // create_new atomically claims the filename (fails with AlreadyExists
        // if it's taken) instead of exists()-then-write, which two concurrent
        // Tauri command invocations could both pass before either had written.
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut f) => {
                f.write_all(bytes).map_err(|e| format!("Cannot write asset: {e}"))?;
                return Ok(name);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if file_matches_bytes(&dest, bytes) {
                    return Ok(name);
                }
                name = format!("{stem}-{counter}.{ext}");
                counter += 1;
            }
            Err(e) => return Err(format!("Cannot write asset: {e}")),
        }
    }
}

/// Copies `src` into `{dest_dir}/assets/`, creating the directory if needed.
/// Returns the final filename (e.g. "screenshot.png") so the caller can
/// insert a relative `assets/<filename>` reference in the document.
/// If a file with the same name already exists, appends a numeric suffix.
#[tauri::command]
pub fn copy_image_to_assets(src: String, dest_dir: String) -> Result<String, String> {
    let src_path = file_io::safe_read_path(&src)?;
    let raw_stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext      = src_path.extension().and_then(|s| s.to_str()).unwrap_or("png");
    let stem     = sanitise_stem(raw_stem);
    let assets_dir = prepare_assets_dir(&dest_dir)?;

    // Use std::fs::copy to preserve file metadata (timestamps, permissions).
    // On a collision, lazily read src_path (at most once) to check whether the
    // existing file is already an identical copy — e.g. an orphan left behind
    // by a previously-removed reference to this same source — and reuse its
    // name instead of writing yet another duplicate.
    let mut src_bytes: Option<Vec<u8>> = None;
    let mut name = format!("{stem}.{ext}");
    let mut counter = 1u32;
    loop {
        if counter > 10_000 {
            return Err("Too many files with the same name in assets/".into());
        }
        let dest = assets_dir.join(&name);
        // create_new atomically claims the filename (fails with AlreadyExists
        // if it's taken) instead of exists()-then-copy, which two concurrent
        // Tauri command invocations could both pass before either had written.
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(f) => {
                drop(f); // release the handle before fs::copy re-opens the same path
                std::fs::copy(&src_path, &dest)
                    .map_err(|e| format!("Cannot copy image: {e}"))?;
                return Ok(name);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let bytes = match &src_bytes {
                    Some(b) => b,
                    None => {
                        let read = std::fs::read(&src_path).map_err(|e| format!("Cannot read source file: {e}"))?;
                        src_bytes.get_or_insert(read)
                    }
                };
                if file_matches_bytes(&dest, bytes) {
                    return Ok(name);
                }
                name = format!("{stem}-{counter}.{ext}");
                counter += 1;
            }
            Err(e) => return Err(format!("Cannot copy image: {e}")),
        }
    }
}

// Scans markdown `content` for local `assets/…` references (in any syntax —
// Markdown image links, `<img>`/`<video>` tags, `!video[]()`, etc. — since it
// just looks for the literal "assets/" substring) and returns the raw
// relative-path tokens, e.g. `assets/foo.png`, `assets/my%20file.jpg`.
fn find_asset_tokens(content: &str) -> std::collections::HashSet<String> {
    let mut refs: std::collections::HashSet<String> = std::collections::HashSet::new();
    let needle = "assets/";
    let mut start = 0usize;
    while let Some(rel) = content[start..].find(needle) {
        let abs = start + rel;
        let rest = &content[abs..];
        let end = rest
            .find(|c: char| matches!(c, ')' | '"' | '\'' | ' ' | '\t' | '\n' | '\r'))
            .unwrap_or(rest.len());
        if end > needle.len() {
            refs.insert(rest[..end].to_string());
        }
        start = abs + 1; // advance past this match to avoid re-scanning
    }
    refs
}

/// Scans a markdown file for local `assets/…` references and returns them as
/// relative paths (e.g. `["assets/foo.png", "assets/bar.jpg"]`).
#[tauri::command]
pub fn scan_asset_refs(file_path: String) -> Result<Vec<String>, String> {
    let content = file_io::read(&file_path)?;
    Ok(find_asset_tokens(&content).into_iter().collect())
}

/// Writes `content` to `dest_path` and, if `asset_refs` is non-empty,
/// copies those asset files (resolved relative to `src_path`) into an
/// `assets/` folder next to the destination.
#[tauri::command]
pub fn copy_file_with_assets(
    src_path: String,
    content: String,
    dest_path: String,
    asset_refs: Vec<String>,
) -> Result<(), String> {
    let safe_src  = file_io::safe_read_path(&src_path)?;
    let safe_dest = file_io::safe_write_path(&dest_path)?;

    file_io::write(&dest_path, &content)?;

    if asset_refs.is_empty() {
        return Ok(());
    }

    let src_dir  = safe_src.parent().ok_or("Invalid source path")?;
    let dest_dir = safe_dest.parent().ok_or("Invalid dest path")?;

    for asset_ref in &asset_refs {
        // asset_refs is scraped from document content by the frontend with no
        // path validation — an absolute path or ".." component here could
        // otherwise make src_asset/dest_asset resolve outside src_dir/dest_dir,
        // or even to the exact same file (which would truncate it: fs::copy
        // opens the destination with truncate semantics before finishing the
        // read). Reject anything but a plain relative path up front.
        let rel = std::path::Path::new(asset_ref);
        if rel.is_absolute()
            || rel.components().any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(format!("Invalid asset reference: {asset_ref}"));
        }

        let src_asset  = src_dir.join(rel);
        let dest_asset = dest_dir.join(rel);
        // Create any intermediate directories the relative path requires.
        if let Some(parent) = dest_asset.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create dir for {asset_ref}: {e}"))?;
        }
        let safe_src_asset = file_io::safe_read_path(
            src_asset.to_str()
                .ok_or_else(|| format!("Asset path contains non-UTF-8 characters: {src_asset:?}"))?
        )?;
        let safe_dest_asset = file_io::safe_write_path(
            dest_asset.to_str()
                .ok_or_else(|| format!("Asset dest path contains non-UTF-8 characters: {dest_asset:?}"))?
        )?;
        // Defence in depth: the checks above should already guarantee these
        // stay within src_dir/dest_dir, but canonicalize() also resolves
        // symlinks, which could still walk outside — and copying a file onto
        // itself would silently truncate it, so refuse that outright too.
        if !safe_src_asset.starts_with(src_dir) || !safe_dest_asset.starts_with(dest_dir) {
            return Err(format!("Asset reference escapes its base directory: {asset_ref}"));
        }
        if safe_src_asset == safe_dest_asset {
            return Err(format!("Source and destination are the same file for {asset_ref}"));
        }
        std::fs::copy(&safe_src_asset, &safe_dest_asset)
            .map_err(|e| format!("Cannot copy {asset_ref}: {e}"))?;
    }

    Ok(())
}

/// Decodes base64-encoded data and writes it as binary to the given path.
#[tauri::command]
pub fn write_file_bytes(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 decode error: {e}"))?;
    file_io::write_bytes(&path, &bytes)
}

/// Reads a binary file and returns its contents as standard base64.
/// Used by the PPTX import pipeline to hand raw bytes to the TypeScript parser.
#[tauri::command]
pub fn read_file_b64(path: String) -> Result<String, String> {
    use base64::Engine;
    let safe = file_io::safe_read_path(&path)?;
    let ext = safe.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    // The image and video extensions here must stay the same as
    // IMAGE_EXTENSIONS and VIDEO_EXTENSIONS in src/engine/mediaTypes.ts (plus
    // "pptx" for import). src/engine/__tests__/mediaTypes.test.ts reads this
    // list and fails if they drift apart.
    let allowed = matches!(
        ext.as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp" | "avif" | "tif" | "tiff" | "ico"
            | "pptx"
            | "mp4" | "webm" | "ogv" | "mov" | "m4v" | "mkv")
    );
    if !allowed {
        return Err("Access denied: only image, video, and presentation files may be read as base64".to_string());
    }
    let bytes = std::fs::read(&safe).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Writes base64-encoded bytes to `{dest_dir}/assets/{filename}`.
/// Creates the assets directory if absent. Appends a numeric suffix on name conflicts.
/// Returns the final filename (e.g. "pptx_slide1_img1.png").
#[tauri::command]
pub fn write_asset_bytes(data: String, filename: String, dest_dir: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 decode error: {e}"))?;
    let path     = std::path::Path::new(&filename);
    let raw_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext      = path.extension().and_then(|s| s.to_str()).unwrap_or("png");
    let stem     = sanitise_stem(raw_stem);
    let assets_dir = prepare_assets_dir(&dest_dir)?;
    write_bytes_to_assets(&bytes, &stem, ext, &assets_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    // Unique per-test scratch dir under the OS temp dir. FLATPAK_ID isn't set
    // under `cargo test`, so check_in_home is a no-op here regardless of
    // where the OS temp dir actually lives.
    fn temp_scratch_dir(label: &str) -> std::path::PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("kova-assets-test-{label}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_bytes_to_assets_reuses_name_for_identical_content() {
        let dir = temp_scratch_dir("dedup-same");
        let name1 = write_bytes_to_assets(b"hello world", "clip", "mp4", &dir).unwrap();
        let name2 = write_bytes_to_assets(b"hello world", "clip", "mp4", &dir).unwrap();
        assert_eq!(name1, "clip.mp4");
        assert_eq!(name2, "clip.mp4");
        assert!(!dir.join("clip-1.mp4").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_bytes_to_assets_suffixes_on_real_collision() {
        let dir = temp_scratch_dir("dedup-diff");
        let name1 = write_bytes_to_assets(b"first version", "clip", "mp4", &dir).unwrap();
        let name2 = write_bytes_to_assets(b"second version", "clip", "mp4", &dir).unwrap();
        assert_eq!(name1, "clip.mp4");
        assert_eq!(name2, "clip-1.mp4");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn setup_copy_scenario(label: &str) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let src_dir = temp_scratch_dir(&format!("copy-src-{label}"));
        let dest_dir = temp_scratch_dir(&format!("copy-dest-{label}"));
        let src_md = src_dir.join("doc.md");
        std::fs::write(&src_md, "# hi").unwrap();
        (src_dir, dest_dir, src_md)
    }

    #[test]
    fn copy_file_with_assets_rejects_absolute_asset_ref() {
        let (src_dir, dest_dir, src_md) = setup_copy_scenario("abs");
        let secret = src_dir.join("secret.txt");
        std::fs::write(&secret, b"do not touch").unwrap();
        let dest_md = dest_dir.join("copy.md");

        let result = copy_file_with_assets(
            src_md.to_str().unwrap().to_string(),
            "# hi".to_string(),
            dest_md.to_str().unwrap().to_string(),
            vec![secret.to_str().unwrap().to_string()],
        );

        assert!(result.is_err(), "absolute asset_ref must be rejected");
        assert_eq!(std::fs::read(&secret).unwrap(), b"do not touch", "source file must be untouched");
        let _ = std::fs::remove_dir_all(&src_dir);
        let _ = std::fs::remove_dir_all(&dest_dir);
    }

    #[test]
    fn copy_file_with_assets_rejects_parent_dir_traversal() {
        let (src_dir, dest_dir, src_md) = setup_copy_scenario("traversal");
        let dest_md = dest_dir.join("copy.md");

        let result = copy_file_with_assets(
            src_md.to_str().unwrap().to_string(),
            "# hi".to_string(),
            dest_md.to_str().unwrap().to_string(),
            vec!["../../../etc/passwd".to_string()],
        );

        assert!(result.is_err(), "'..'-containing asset_ref must be rejected");
        let _ = std::fs::remove_dir_all(&src_dir);
        let _ = std::fs::remove_dir_all(&dest_dir);
    }

    #[test]
    fn copy_file_with_assets_copies_plain_relative_asset() {
        let (src_dir, dest_dir, src_md) = setup_copy_scenario("happy");
        std::fs::create_dir_all(src_dir.join("assets")).unwrap();
        std::fs::write(src_dir.join("assets/pic.png"), b"pngdata").unwrap();
        let dest_md = dest_dir.join("copy.md");

        let result = copy_file_with_assets(
            src_md.to_str().unwrap().to_string(),
            "# hi".to_string(),
            dest_md.to_str().unwrap().to_string(),
            vec!["assets/pic.png".to_string()],
        );

        assert!(result.is_ok(), "plain relative asset_ref should still work: {result:?}");
        assert_eq!(std::fs::read(dest_dir.join("assets/pic.png")).unwrap(), b"pngdata");
        let _ = std::fs::remove_dir_all(&src_dir);
        let _ = std::fs::remove_dir_all(&dest_dir);
    }

    #[test]
    fn copy_file_with_assets_leaves_no_temp_file_behind() {
        let (src_dir, dest_dir, src_md) = setup_copy_scenario("atomic");
        let dest_md = dest_dir.join("copy.md");
        std::fs::write(&dest_md, "old content").unwrap();

        let result = copy_file_with_assets(
            src_md.to_str().unwrap().to_string(),
            "# new content".to_string(),
            dest_md.to_str().unwrap().to_string(),
            vec![],
        );

        assert!(result.is_ok(), "copy should succeed: {result:?}");
        assert_eq!(std::fs::read_to_string(&dest_md).unwrap(), "# new content");
        let leftovers: Vec<_> = std::fs::read_dir(&dest_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".kova-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&src_dir);
        let _ = std::fs::remove_dir_all(&dest_dir);
    }

}
