use crate::{file_io, watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// Opens a path in the native file manager (Finder / Nautilus / Explorer).
/// Uses platform process commands directly rather than tauri-plugin-opener,
/// which requires path scopes to be configured before it works on macOS.
#[tauri::command]
pub fn show_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

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

/// Copies `src` into `{dest_dir}/assets/`, creating the directory if needed.
/// Returns the final filename (e.g. "screenshot.png") so the caller can
/// insert a relative `assets/<filename>` reference in the document.
/// If a file with the same name already exists, appends a numeric suffix.
#[tauri::command]
pub fn copy_image_to_assets(src: String, dest_dir: String) -> Result<String, String> {
    let src_path = std::path::Path::new(&src);
    let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext  = src_path.extension().and_then(|s| s.to_str()).unwrap_or("png");

    let assets_dir = std::path::Path::new(&dest_dir).join("assets");
    std::fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Cannot create assets dir: {e}"))?;

    let mut name = format!("{stem}.{ext}");
    let mut counter = 1u32;
    loop {
        let dest = assets_dir.join(&name);
        if !dest.exists() {
            std::fs::copy(src_path, &dest)
                .map_err(|e| format!("Cannot copy image: {e}"))?;
            return Ok(name);
        }
        name = format!("{stem}-{counter}.{ext}");
        counter += 1;
    }
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

const EXAMPLE_THEME: &str = "\
# Kova Theme — Example
# ─────────────────────────────────────────────────────────────────────────────
# Copy this file, rename it, and edit the values to create a custom theme.
# Place .yaml files in this folder and restart Kova to load them.
# Only include the properties you want to override — everything else inherits
# from the built-in defaults.
#
# Colour values accept any valid CSS colour: #rrggbb, rgb(), hsl(), etc.

name: My Custom Theme

colors:
  primary:    \"#1B3A5C\"   # title/section slide background, strong accents
  accent:     \"#2563EB\"   # links, highlights, progress bars
  background: \"#ffffff\"   # default slide background
  text:       \"#1a1a1a\"   # body text
  title_text: \"#ffffff\"   # text on title and section slides
  section_bg: \"#E8F0FE\"   # section divider background
  code_bg:    \"#F5F7FA\"   # code block background

fonts:
  title: \"Inter, 'Helvetica Neue', Arial, sans-serif\"
  body:  \"Inter, 'Helvetica Neue', Arial, sans-serif\"
  code:  \"'JetBrains Mono', 'Fira Code', monospace\"

layout:
  title_align:   center      # center | left | bottom-left
  heading_align: left        # left | center
  decoration:    none        # none | dots | grid | diagonal | bar-left

footer:
  show:              false
  text:              \"{title} — {slide_number} / {total}\"
  show_slide_number: true

header:
  show: false
  text: \"\"
";

/// Returns (themes_dir_path, entries) where each entry is
/// (filename_without_extension, yaml_content).
/// Creates ~/.kova/themes/ and an example file on first run.
#[tauri::command]
pub fn load_custom_themes(app: AppHandle) -> Result<(String, Vec<(String, String)>), String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let themes_dir = home.join(".kova").join("themes");
    let dir_str = themes_dir.to_string_lossy().into_owned();

    if !themes_dir.exists() {
        std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
        std::fs::write(themes_dir.join("example.yaml"), EXAMPLE_THEME)
            .map_err(|e| e.to_string())?;
        return Ok((dir_str, vec![]));
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
        if id == "example" {
            continue; // never load the template as a real theme
        }
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        result.push((id, content));
    }

    Ok((dir_str, result))
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
