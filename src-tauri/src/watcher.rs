use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use notify::event::ModifyKind;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
struct LastSeen {
    mtime: Option<SystemTime>,
    size: Option<u64>,
}

/// True for pure metadata events — on Linux these are inotify IN_ATTRIB
/// events emitted by sync clients (OneDrive, Dropbox) touching timestamps or
/// xattrs without changing the file's bytes. Shared by both watchers below so
/// a future adjustment to this filter (e.g. another spurious event kind seen
/// on some platform/sync-client) can't update one and silently miss the other.
fn is_metadata_only(kind: &EventKind) -> bool {
    matches!(kind, EventKind::Modify(ModifyKind::Metadata(_)))
}

pub fn create(
    app: AppHandle,
    path: PathBuf,
    suppress_until: Arc<AtomicU64>,
) -> notify::Result<RecommendedWatcher> {
    let last_seen = Arc::new(Mutex::new(LastSeen::default()));
    let watch_path = path.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                if is_metadata_only(&event.kind) {
                    return;
                }

                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    // Ignore events that arrive within the suppression window set by
                    // write_file — these are caused by Kova's own atomic rename and
                    // should not be surfaced to the frontend as external changes.
                    let now = SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    if now < suppress_until.load(Ordering::Relaxed) {
                        return;
                    }

                    // Stat-based pre-filter for platforms where the event kind does not
                    // distinguish metadata from content changes (e.g. macOS FSEvents
                    // returns ModifyKind::Any for both). If mtime and size are both
                    // unchanged the bytes are almost certainly the same — skip without
                    // a full file read. Falls through on stat failure so a genuine
                    // change is never silently dropped.
                    if let Ok(meta) = fs::metadata(&path) {
                        let mtime = meta.modified().ok();
                        let size = Some(meta.len());
                        let mut ls = last_seen.lock().unwrap_or_else(|e| e.into_inner());
                        if ls.mtime == mtime && ls.size == size {
                            return;
                        }
                        ls.mtime = mtime;
                        ls.size = size;
                    }

                    let _ = app.emit("file-changed", ());
                } else if matches!(event.kind, EventKind::Remove(_)) {
                    let _ = app.emit("file-deleted", ());
                }
            }
        },
        Config::default(),
    )?;
    watcher.watch(&watch_path, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

/// Watches the custom-themes directory (flat, so non-recursive is enough) and
/// emits "theme-files-changed" whenever a .yaml/.yml file in it is added,
/// modified, or removed — e.g. from an external editor saving a theme file
/// while Kova is open (issue #252). Unlike `create`, this has no per-file
/// write-suppression window: Kova's own theme writes (save_theme/delete_theme)
/// triggering an extra, harmless reload is preferable to the complexity of
/// threading a suppression flag through those commands too.
pub fn create_theme_dir_watcher(app: AppHandle, dir: PathBuf) -> notify::Result<RecommendedWatcher> {
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                if is_metadata_only(&event.kind) {
                    return;
                }
                if !matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)) {
                    return;
                }
                let is_theme_file = event.paths.iter().any(|p| {
                    matches!(p.extension().and_then(|e| e.to_str()), Some("yaml") | Some("yml"))
                });
                if !is_theme_file {
                    return;
                }
                let _ = app.emit("theme-files-changed", ());
            }
        },
        Config::default(),
    )?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}
