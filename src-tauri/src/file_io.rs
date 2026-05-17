use std::path::{Path, PathBuf};

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())
}

pub fn check_in_home(path: &Path) -> Result<(), String> {
    let home = home_dir()?;
    if path.starts_with(&home) {
        Ok(())
    } else {
        Err("Access denied: path is outside your home directory".to_string())
    }
}

// For reads the file must exist, so canonicalize resolves symlinks and traversal.
pub fn safe_read_path(path: &str) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    check_in_home(&canonical)?;
    Ok(canonical)
}

// For writes the file may not exist yet; canonicalize the parent instead.
fn safe_write_path(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let parent = p.parent().ok_or_else(|| "Invalid path: no parent directory".to_string())?;
    let filename = p.file_name().ok_or_else(|| "Invalid path: no filename".to_string())?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Failed to write file: {e}"))?;
    let resolved = canonical_parent.join(filename);
    check_in_home(&resolved)?;
    Ok(resolved)
}

pub fn read(path: &str) -> Result<String, String> {
    let safe = safe_read_path(path)?;
    std::fs::read_to_string(&safe).map_err(|e| format!("Failed to read file: {e}"))
}

pub fn write(path: &str, content: &str) -> Result<(), String> {
    let safe = safe_write_path(path)?;
    std::fs::write(&safe, content).map_err(|e| format!("Failed to write file: {e}"))
}

pub fn write_bytes(path: &str, bytes: &[u8]) -> Result<(), String> {
    let safe = safe_write_path(path)?;
    std::fs::write(&safe, bytes).map_err(|e| format!("Failed to write file: {e}"))
}
