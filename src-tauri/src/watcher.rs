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

/// True for event kinds the document watcher treats as "the file may have new
/// content". Checked after `is_metadata_only` has already been ruled out.
fn is_content_event(kind: &EventKind) -> bool {
    matches!(kind, EventKind::Modify(_) | EventKind::Create(_))
}

impl LastSeen {
    /// Records the latest stat result and reports whether it differs from the
    /// previous one. Returns false (and records nothing) when both mtime and
    /// size are unchanged.
    fn update(&mut self, mtime: Option<SystemTime>, size: Option<u64>) -> bool {
        if self.mtime == mtime && self.size == size {
            return false;
        }
        self.mtime = mtime;
        self.size = size;
        true
    }
}

/// The theme-directory watcher's whole event filter: true when `event` should
/// trigger a "theme-files-changed" reload.
fn is_theme_file_event(event: &Event) -> bool {
    if is_metadata_only(&event.kind) {
        return false;
    }
    if !matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)) {
        return false;
    }
    event.paths.iter().any(|p| {
        matches!(p.extension().and_then(|e| e.to_str()), Some("yaml") | Some("yml"))
    })
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

                if is_content_event(&event.kind) {
                    // Ignore events that arrive within the suppression window set by
                    // write_file — these are caused by Kova's own atomic rename and
                    // should not be surfaced to the frontend as external changes.
                    if crate::util::now_millis() <suppress_until.load(Ordering::Relaxed) {
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
                        if !ls.update(mtime, size) {
                            return;
                        }
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
                if is_theme_file_event(&event) {
                    let _ = app.emit("theme-files-changed", ());
                }
            }
        },
        Config::default(),
    )?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{
        AccessKind, AccessMode, CreateKind, DataChange, MetadataKind, RemoveKind, RenameMode,
    };
    use std::time::Duration;

    fn modify_data() -> EventKind {
        EventKind::Modify(ModifyKind::Data(DataChange::Content))
    }

    fn metadata() -> EventKind {
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any))
    }

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        paths.iter().fold(Event::new(kind), |e, p| e.add_path(PathBuf::from(p)))
    }

    // is_metadata_only

    #[test]
    fn metadata_events_are_metadata_only() {
        assert!(is_metadata_only(&metadata()));
        assert!(is_metadata_only(&EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions))));
        assert!(is_metadata_only(&EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended))));
    }

    #[test]
    fn content_and_ambiguous_modifies_are_not_metadata_only() {
        assert!(!is_metadata_only(&modify_data()));
        // macOS FSEvents reports ModifyKind::Any for both metadata and content,
        // so it must not be filtered here (the stat check handles it).
        assert!(!is_metadata_only(&EventKind::Modify(ModifyKind::Any)));
        assert!(!is_metadata_only(&EventKind::Modify(ModifyKind::Name(RenameMode::To))));
        assert!(!is_metadata_only(&EventKind::Create(CreateKind::File)));
        assert!(!is_metadata_only(&EventKind::Remove(RemoveKind::File)));
    }

    // is_content_event

    #[test]
    fn modify_and_create_are_content_events() {
        assert!(is_content_event(&modify_data()));
        assert!(is_content_event(&EventKind::Modify(ModifyKind::Any)));
        assert!(is_content_event(&EventKind::Modify(ModifyKind::Name(RenameMode::To))));
        assert!(is_content_event(&EventKind::Create(CreateKind::File)));
        // Metadata is still a Modify; the watcher rules it out first via
        // is_metadata_only, not here.
        assert!(is_content_event(&metadata()));
    }

    #[test]
    fn remove_access_and_other_are_not_content_events() {
        assert!(!is_content_event(&EventKind::Remove(RemoveKind::File)));
        assert!(!is_content_event(&EventKind::Access(AccessKind::Close(AccessMode::Write))));
        assert!(!is_content_event(&EventKind::Any));
        assert!(!is_content_event(&EventKind::Other));
    }

    // LastSeen::update

    #[test]
    fn last_seen_first_stat_counts_as_a_change() {
        let mut ls = LastSeen::default();
        assert!(ls.update(Some(SystemTime::UNIX_EPOCH), Some(10)));
    }

    #[test]
    fn last_seen_identical_stat_is_not_a_change() {
        let mut ls = LastSeen::default();
        let t = SystemTime::UNIX_EPOCH + Duration::from_secs(5);
        assert!(ls.update(Some(t), Some(10)));
        assert!(!ls.update(Some(t), Some(10)));
        assert!(!ls.update(Some(t), Some(10)));
    }

    #[test]
    fn last_seen_mtime_or_size_change_is_a_change() {
        let mut ls = LastSeen::default();
        let t1 = SystemTime::UNIX_EPOCH + Duration::from_secs(5);
        let t2 = SystemTime::UNIX_EPOCH + Duration::from_secs(6);
        assert!(ls.update(Some(t1), Some(10)));
        assert!(ls.update(Some(t2), Some(10)), "mtime changed");
        assert!(ls.update(Some(t2), Some(11)), "size changed");
        assert!(!ls.update(Some(t2), Some(11)));
        // Going back to an earlier value still counts as a change.
        assert!(ls.update(Some(t1), Some(10)));
    }

    #[test]
    fn last_seen_unknown_mtime_compares_as_none() {
        // Platforms without mtime support give None; size alone then decides.
        let mut ls = LastSeen::default();
        assert!(ls.update(None, Some(3)));
        assert!(!ls.update(None, Some(3)));
        assert!(ls.update(None, Some(4)));
    }

    #[test]
    fn last_seen_default_matches_all_none() {
        // Edge case: a stat of (None, None) against a fresh LastSeen is
        // reported as unchanged. In practice size is always Some.
        let mut ls = LastSeen::default();
        assert!(!ls.update(None, None));
    }

    // is_theme_file_event

    #[test]
    fn theme_yaml_and_yml_changes_trigger_reload() {
        assert!(is_theme_file_event(&event(modify_data(), &["/t/dark.yaml"])));
        assert!(is_theme_file_event(&event(modify_data(), &["/t/dark.yml"])));
        assert!(is_theme_file_event(&event(EventKind::Create(CreateKind::File), &["/t/new.yaml"])));
        assert!(is_theme_file_event(&event(EventKind::Remove(RemoveKind::File), &["/t/old.yml"])));
        assert!(is_theme_file_event(&event(EventKind::Modify(ModifyKind::Any), &["/t/a.yaml"])));
    }

    #[test]
    fn theme_metadata_only_events_are_ignored() {
        assert!(!is_theme_file_event(&event(metadata(), &["/t/dark.yaml"])));
    }

    #[test]
    fn theme_access_and_other_kinds_are_ignored() {
        let close = EventKind::Access(AccessKind::Close(AccessMode::Write));
        assert!(!is_theme_file_event(&event(close, &["/t/dark.yaml"])));
        assert!(!is_theme_file_event(&event(EventKind::Any, &["/t/dark.yaml"])));
        assert!(!is_theme_file_event(&event(EventKind::Other, &["/t/dark.yaml"])));
    }

    #[test]
    fn theme_non_yaml_files_are_ignored() {
        assert!(!is_theme_file_event(&event(modify_data(), &["/t/notes.txt"])));
        assert!(!is_theme_file_event(&event(modify_data(), &["/t/dark.yaml.bak"])));
        assert!(!is_theme_file_event(&event(modify_data(), &["/t/dark.yaml~"])));
        assert!(!is_theme_file_event(&event(modify_data(), &["/t/no-extension"])));
    }

    #[test]
    fn theme_event_without_paths_is_ignored() {
        assert!(!is_theme_file_event(&event(modify_data(), &[])));
    }

    #[test]
    fn theme_rename_with_any_yaml_path_triggers_reload() {
        // e.g. an editor's atomic save renames a temp file over the theme.
        let rename = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
        assert!(is_theme_file_event(&event(rename, &["/t/.dark.yaml.swp", "/t/dark.yaml"])));
    }

    #[test]
    fn theme_extension_match_is_case_sensitive() {
        // Characterisation: upper-case extensions do not trigger a reload.
        assert!(!is_theme_file_event(&event(modify_data(), &["/t/Dark.YAML"])));
        assert!(!is_theme_file_event(&event(modify_data(), &["/t/Dark.Yml"])));
    }

    #[test]
    fn theme_dotfile_named_yaml_is_ignored() {
        // Path::extension treats ".yaml" as a stem with no extension.
        assert!(!is_theme_file_event(&event(modify_data(), &["/t/.yaml"])));
    }
}
