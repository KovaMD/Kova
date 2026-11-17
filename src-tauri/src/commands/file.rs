use super::AppState;
use crate::file_io;
use crate::watcher;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Drain file paths that macOS delivered before the webview was ready to listen.
#[tauri::command]
pub fn take_pending_open(state: State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending_open.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Drain the CLI action (`--present` / `--check` / `--theme`) parsed at startup.
#[tauri::command]
pub fn take_pending_cli(state: State<'_, AppState>) -> Option<crate::cli::PendingCli> {
    state.pending_cli.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Existence probe for --check's media validation. Read-only and cheap —
/// deliberately not read_file_b64, which would load whole videos to answer
/// a yes/no question.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    file_io::read(&path)
}

#[tauri::command]
pub fn write_file(path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    // Stamp a 500 ms suppression window before the rename so the watcher
    // ignores the inotify/FSEvents events caused by our own atomic write.
    let until = crate::util::now_millis() + 500;
    state.own_write_suppress_until.store(until, Ordering::Relaxed);
    file_io::write(&path, &content)
}

#[tauri::command]
pub fn start_watching(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    // Validate and canonicalise before watching — same boundary check applied to
    // every other file command, preventing watching of arbitrary system files.
    let path_buf = file_io::safe_read_path(&path)?;

    let mut s = state.watch.lock().unwrap_or_else(|e| e.into_inner());
    // Drop previous watcher atomically before creating a new one.
    // Both fields are updated inside the same lock, preventing divergence.
    s.watcher = None;
    let suppress = Arc::clone(&state.own_write_suppress_until);
    let w = watcher::create(app, path_buf.clone(), suppress).map_err(|e| e.to_string())?;
    s.current_file = Some(path_buf);
    s.watcher = Some(w);

    Ok(())
}

#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old = file_io::safe_read_path(&old_path)?;
    // safe_write_path canonicalises the parent directory, resolving any `..`
    // components before the home-boundary check runs.  Using PathBuf::from +
    // check_in_home directly allowed traversal because starts_with matches
    // components lexically without normalising `..`.
    let new = file_io::safe_write_path(&new_path)?;
    std::fs::rename(&old, &new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_watching(state: State<'_, AppState>) {
    let mut s = state.watch.lock().unwrap_or_else(|e| e.into_inner());
    s.watcher = None;
    s.current_file = None;
}
