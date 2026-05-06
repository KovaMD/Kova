use crate::{file_io, watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};

pub struct AppState {
    pub current_file: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    file_io::read(&path)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    file_io::write(&path, &content)
}

#[tauri::command]
pub fn start_watching(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    // Drop previous watcher before creating a new one
    *state.watcher.lock().unwrap() = None;

    let w = watcher::create(app, path_buf.clone()).map_err(|e| e.to_string())?;
    *state.current_file.lock().unwrap() = Some(path_buf);
    *state.watcher.lock().unwrap() = Some(w);

    Ok(())
}

#[tauri::command]
pub fn stop_watching(state: State<'_, AppState>) {
    *state.watcher.lock().unwrap() = None;
    *state.current_file.lock().unwrap() = None;
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

/// Returns the YAML contents of every .yaml/.yml file in ~/.kova/themes/.
/// Each entry is (filename_without_extension, yaml_content).
#[tauri::command]
pub fn load_custom_themes() -> Result<Vec<(String, String)>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let themes_dir = std::path::PathBuf::from(home).join(".kova").join("themes");

    if !themes_dir.exists() {
        return Ok(vec![]);
    }

    let mut result = Vec::new();
    let entries = std::fs::read_dir(&themes_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "yaml" && ext != "yml" {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("custom")
            .to_string();
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        result.push((id, content));
    }

    Ok(result)
}

/// Returns a sorted, deduplicated list of font family names available on the system.
/// Uses fontconfig (fc-list) on Linux/macOS; returns an empty list if unavailable.
#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    let output = std::process::Command::new("fc-list")
        .arg("--format")
        .arg("%{family[0]}\n")
        .output()
        .unwrap_or_default();

    let mut fonts: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();

    fonts.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    fonts.dedup();
    fonts
}
