use super::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

const DEFAULT_KEYBINDINGS: &str = include_str!("../../resources/default_keybindings.yaml");

/// Kova's folder inside the platform config dir (e.g. `~/.config/kova` on
/// Linux). Only builds the path; never creates anything.
fn kova_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app.path().config_dir().map_err(|e| e.to_string())?.join("kova"))
}

/// The custom-themes folder inside Kova's config dir. Only builds the path;
/// callers that need it to exist create it themselves (see ensure_themes_dir).
fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(kova_config_dir(app)?.join("themes"))
}

/// Reads keybindings.yaml from the platform config dir, creating it from defaults if absent.
/// Returns (absolute_path, yaml_content).
#[tauri::command]
pub fn load_keybindings(app: AppHandle) -> Result<(String, String), String> {
    let path = kova_config_dir(&app)?.join("keybindings.yaml");

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

/// Returns the platform config themes dir, creating it (and writing the
/// example theme template) on first run. Guarded by `state.themes_dir_init`
/// so `load_custom_themes` and `start_watching_themes` — invoked from two
/// separate frontend mount effects with no ordering guarantee across the IPC
/// boundary — can't race each other into skipping the bootstrap.
fn ensure_themes_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    let _guard = state.themes_dir_init.lock().unwrap_or_else(|e| e.into_inner());
    let themes_dir = themes_dir(app)?;
    if !themes_dir.exists() {
        std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
        std::fs::write(themes_dir.join("example.yaml"), EXAMPLE_THEME)
            .map_err(|e| e.to_string())?;
    }
    Ok(themes_dir)
}

/// Returns (themes_dir_path, entries) where each entry is
/// (filename_without_extension, yaml_content).
#[tauri::command]
pub fn load_custom_themes(app: AppHandle, state: State<'_, AppState>) -> Result<(String, Vec<(String, String)>), String> {
    let themes_dir = ensure_themes_dir(&app, &state)?;
    let dir_str = themes_dir.to_string_lossy().into_owned();

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
    let themes_dir = ensure_themes_dir(&app, &state)?;

    let mut guard = state.theme_watch.lock().unwrap_or_else(|e| e.into_inner());
    *guard = None; // drop the previous watcher before creating the new one
    let w = crate::watcher::create_theme_dir_watcher(app, themes_dir).map_err(|e| e.to_string())?;
    *guard = Some(w);
    Ok(())
}

/// Checks a theme id before it is used as a file name. Allows letters and
/// digits (any script, since `is_alphanumeric` is Unicode-aware), `-` and
/// `_`; anything else, including `.` and path separators, is rejected so an
/// id can never escape the themes directory.
fn validate_theme_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid theme id".into());
    }
    Ok(())
}

/// Writes a theme YAML file to the platform config themes dir (remote install).
#[tauri::command]
pub fn save_theme(app: AppHandle, id: String, yaml: String) -> Result<(), String> {
    validate_theme_id(&id)?;
    let themes_dir = themes_dir(&app)?;
    std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    let path = themes_dir.join(format!("{id}.yaml"));
    std::fs::write(path, yaml).map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes a theme YAML file from the platform config themes dir (remote uninstall). Silent if file absent.
#[tauri::command]
pub fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    validate_theme_id(&id)?;
    let path = themes_dir(&app)?.join(format!("{id}.yaml"));
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

    use crate::net_guard::{fetch_capped, preflight, FetchError, FetchKind, FetchOpts};

    // url/sha256 come from a theme file's `remoteFonts` list — attacker-
    // influenceable content (a shared/imported theme), same trust tier as an
    // opened document. Route through the same SSRF guard fetch_url_b64/
    // fetch_url_text use (net_guard::fetch_capped). HTTPS only, to prevent
    // cleartext interception.
    const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024; // 20 MB
    let opts = FetchOpts {
        https_only: true,
        max_bytes: MAX_FONT_BYTES,
        accept: None,
        kind: FetchKind::Get,
    };
    // This command has always worded its errors differently from the
    // network commands; keep those strings.
    let font_err = |e: FetchError| -> String {
        match e {
            FetchError::BadScheme { .. } => "font URL must use HTTPS".into(),
            FetchError::Send(e) | FetchError::Read(e) => format!("download failed: {e}"),
            FetchError::Status(s) => format!("download failed: HTTP {s}"),
            FetchError::TooLarge { .. } => "font file too large (max 20 MB)".into(),
            other => other.to_string(),
        }
    };
    // Check the URL up front (before the hash and cache checks), as before;
    // fetch_capped repeats the same check itself below.
    preflight(&url, &opts).map_err(font_err)?;

    // sha256 must be exactly 64 lowercase hex chars — used as the filename,
    // so this also prevents any path-traversal via crafted hash strings.
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("sha256 must be a 64-character hex string".into());
    }

    let fonts_dir = themes_dir(&app)?.join("fonts");

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

    let bytes = fetch_capped(&url, &opts).await.map_err(font_err)?.bytes;

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

#[cfg(test)]
mod tests {
    use super::validate_theme_id;

    #[test]
    fn rejects_empty_id() {
        assert_eq!(validate_theme_id(""), Err("invalid theme id".to_string()));
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        assert!(validate_theme_id("../x").is_err());
        assert!(validate_theme_id("..").is_err());
    }

    #[test]
    fn rejects_path_separators_and_dots() {
        assert!(validate_theme_id("a/b").is_err());
        assert!(validate_theme_id("a\\b").is_err());
        assert!(validate_theme_id("a.yaml").is_err());
        assert!(validate_theme_id("a b").is_err());
    }

    #[test]
    fn accepts_unicode_letters() {
        assert!(validate_theme_id("tema-čšž").is_ok());
        assert!(validate_theme_id("Größe").is_ok());
        assert!(validate_theme_id("日本").is_ok());
    }

    #[test]
    fn accepts_ascii_ids_with_dash_and_underscore() {
        assert_eq!(validate_theme_id("my-theme_2"), Ok(()));
    }
}
