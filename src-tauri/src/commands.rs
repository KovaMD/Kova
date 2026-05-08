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

const DEFAULT_KEYBINDINGS: &str = "\
# Kova — Keyboard Shortcuts
# ─────────────────────────────────────────────────────────────────────────────
# Edit this file to customise keyboard shortcuts, then restart Kova.
#
# Format:   action: modifier+key
# Modifiers (combine with +):  ctrl  shift  alt
#
# Available actions:
#   new_file    open_file    save    save_as    focus_mode

new_file:   ctrl+n
open_file:  ctrl+o
save:       ctrl+s
save_as:    ctrl+shift+s
focus_mode: ctrl+shift+f
";

/// Reads ~/.kova/keybindings.yaml, creating it from defaults if absent.
/// Returns (absolute_path, yaml_content).
#[tauri::command]
pub fn load_keybindings(app: AppHandle) -> Result<(String, String), String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let path = home.join(".kova").join("keybindings.yaml");

    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, DEFAULT_KEYBINDINGS).map_err(|e| e.to_string())?;
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok((path.to_string_lossy().into_owned(), content))
}

/// Returns the YAML contents of every .yaml/.yml file in ~/.kova/themes/.
/// Each entry is (filename_without_extension, yaml_content).
#[tauri::command]
pub fn load_custom_themes(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let themes_dir = home.join(".kova").join("themes");

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
    let output = match std::process::Command::new("fc-list")
        .arg("--format")
        .arg("%{family[0]}\n")
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };

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
