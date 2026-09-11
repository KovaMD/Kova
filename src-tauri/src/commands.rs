mod assets;
mod clipboard;
mod config;
mod file;
mod fonts;
mod lifecycle;
mod network;
mod pdf;
mod window;

pub use assets::*;
pub use clipboard::*;
pub use config::*;
pub use file::*;
pub use fonts::*;
pub use lifecycle::*;
pub use network::*;
pub use pdf::*;
pub use window::*;

use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

// Consolidating both watcher fields into one Mutex eliminates the TOCTOU window
// between separate current_file and watcher lock/unlock cycles.
pub struct WatchState {
    pub current_file: Option<PathBuf>,
    pub watcher: Option<notify::RecommendedWatcher>,
}

pub struct AppState {
    pub watch: Mutex<WatchState>,
    /// The themes-directory watcher (issue #252) — started once at app launch
    /// and left running for the app's lifetime, unlike `watch` which is
    /// re-pointed at a new file every time a document is opened.
    pub theme_watch: Mutex<Option<notify::RecommendedWatcher>>,
    /// Set once the frontend has resolved the unsaved-changes prompt (or there
    /// was nothing to confirm) for an in-flight app-level quit. Checked by the
    /// `RunEvent::ExitRequested` handler in lib.rs so the retried `app.exit()`
    /// below isn't intercepted a second time.
    pub exit_confirmed: std::sync::atomic::AtomicBool,
    /// File paths from macOS "Open With" / double-click that arrived (via
    /// `RunEvent::Opened`) before the frontend mounted its listener. Drained
    /// once on startup by `take_pending_open`.
    pub pending_open: Mutex<Vec<String>>,
    /// CLI action (`--present` / `--check` / `--theme`) parsed at startup by
    /// `cli::startup`, before the webview exists. Drained once on startup by
    /// `take_pending_cli`.
    pub pending_cli: Mutex<Option<crate::cli::PendingCli>>,
    /// Unix-millisecond deadline before which the watcher should suppress
    /// file-changed events — set by write_file to swallow events caused by
    /// Kova's own atomic rename rather than a genuine external edit.
    pub own_write_suppress_until: Arc<AtomicU64>,
}
