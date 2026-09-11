use super::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

const DEFAULT_KEYBINDINGS: &str = include_str!("../../resources/default_keybindings.yaml");

/// Reads keybindings.yaml from the platform config dir, creating it from defaults if absent.
/// Returns (absolute_path, yaml_content).
#[tauri::command]
pub fn load_keybindings(app: AppHandle) -> Result<(String, String), String> {
    use tauri::Manager;
    let config_dir = app.path().config_dir().map_err(|e| e.to_string())?.join("kova");
    let path = config_dir.join("keybindings.yaml");

    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, DEFAULT_KEYBINDINGS).map_err(|e| e.to_string())?;
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok((path.to_string_lossy().into_owned(), content))
}

const EXAMPLE_THEME: &str = include_str!("../../resources/example_theme.yaml");

/// Returns (themes_dir_path, entries) where each entry is
/// (filename_without_extension, yaml_content).
/// Creates the platform config themes dir and an example file on first run.
#[tauri::command]
pub fn load_custom_themes(app: AppHandle) -> Result<(String, Vec<(String, String)>), String> {
    use tauri::Manager;
    let config_dir = app.path().config_dir().map_err(|e| e.to_string())?.join("kova");
    let themes_dir = config_dir.join("themes");
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

/// Starts (or restarts) watching the custom-themes directory for external
/// changes, so edits made in another editor while Kova is open can be picked
/// up live (issue #252) — the frontend listens for "theme-files-changed" and
/// reloads. Safe to call more than once: drops any previous watcher first,
/// same pattern as start_watching for the open document. Called once by the
/// frontend on startup; the watcher then lives for the app's lifetime.
#[tauri::command]
pub fn start_watching_themes(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    use tauri::Manager;
    let themes_dir = app.path().config_dir().map_err(|e| e.to_string())?.join("kova").join("themes");
    if !themes_dir.exists() {
        std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    }

    let mut guard = state.theme_watch.lock().unwrap_or_else(|e| e.into_inner());
    *guard = None; // drop the previous watcher before creating the new one
    let w = crate::watcher::create_theme_dir_watcher(app, themes_dir).map_err(|e| e.to_string())?;
    *guard = Some(w);
    Ok(())
}

/// Writes a theme YAML file to the platform config themes dir (remote install).
#[tauri::command]
pub fn save_theme(app: AppHandle, id: String, yaml: String) -> Result<(), String> {
    use tauri::Manager;
    if id.is_empty() || !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid theme id".into());
    }
    let themes_dir = app.path().config_dir().map_err(|e| e.to_string())?.join("kova").join("themes");
    std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    let path = themes_dir.join(format!("{id}.yaml"));
    std::fs::write(path, yaml).map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes a theme YAML file from the platform config themes dir (remote uninstall). Silent if file absent.
#[tauri::command]
pub fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    use tauri::Manager;
    if id.is_empty() || !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid theme id".into());
    }
    let path = app.path().config_dir().map_err(|e| e.to_string())?.join("kova")
        .join("themes").join(format!("{id}.yaml"));
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Downloads a font file from `url`, verifies its SHA-256, and caches it at
/// `~/.kova/themes/fonts/<sha256>.woff2`.  Idempotent — if the file is already
/// present the download is skipped and the cached path is returned immediately.
#[tauri::command]
pub async fn download_and_cache_font(
    app: AppHandle,
    url: String,
    sha256: String,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use tauri::Manager;

    // URL must be HTTPS to prevent cleartext interception.
    if !url.starts_with("https://") {
        return Err("font URL must use HTTPS".into());
    }

    // url/sha256 come from a theme file's `remoteFonts` list — attacker-
    // influenceable content (a shared/imported theme), same trust tier as an
    // opened document. Route through the same SSRF guard fetch_url_b64/
    // fetch_url_text use, rather than a bare reqwest::get with no address
    // validation at all (see the matching comment in commands/network.rs).
    let parsed_url = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if crate::net_guard::url_host_is_blocked(&parsed_url) {
        return Err("refusing to connect to a non-public address".into());
    }

    // sha256 must be exactly 64 lowercase hex chars — used as the filename,
    // so this also prevents any path-traversal via crafted hash strings.
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("sha256 must be a 64-character hex string".into());
    }

    let fonts_dir = app
        .path()
        .config_dir()
        .map_err(|e| e.to_string())?
        .join("kova")
        .join("themes")
        .join("fonts");

    let (dest, already_cached) = {
        let fonts_dir = fonts_dir.clone();
        let sha256 = sha256.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, bool), String> {
            std::fs::create_dir_all(&fonts_dir).map_err(|e| e.to_string())?;
            let dest = fonts_dir.join(format!("{sha256}.woff2"));
            let exists = dest.exists();
            Ok((dest, exists))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    if already_cached {
        return Ok(dest.to_string_lossy().into_owned());
    }

    const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024; // 20 MB

    let client = crate::net_guard::build_ssrf_safe_client()?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }

    if response.content_length().unwrap_or(0) > MAX_FONT_BYTES {
        return Err("font file too large (max 20 MB)".into());
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    if bytes.len() as u64 > MAX_FONT_BYTES {
        return Err("font file too large (max 20 MB)".into());
    }

    // Verify integrity before writing to disk.
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != sha256 {
        return Err(format!(
            "integrity check failed — expected {sha256}, got {actual}"
        ));
    }

    {
        let dest = dest.clone();
        tauri::async_runtime::spawn_blocking(move || std::fs::write(&dest, &bytes))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    }

    Ok(dest.to_string_lossy().into_owned())
}
