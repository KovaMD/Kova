mod cli;
mod commands;
mod file_io;
mod net_guard;
mod watcher;

use commands::{AppState, WatchState};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // CLI handling must resolve before the Tauri builder runs: --help,
    // --version, usage errors, and nonexistent action paths all print to the
    // terminal and exit without ever creating a window.
    let startup = cli::startup();
    let cli_action_active = startup.pending.is_some();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Just size/position/maximized — explicitly not VISIBLE, DECORATIONS,
                // or FULLSCREEN (all included in the crate's ::all() default): this is
                // a single-window editor with no hide-to-tray feature, so there's no
                // legitimate saved-as-hidden state to restore, and re-opening into OS
                // fullscreen unprompted would be a surprise users didn't ask for.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                // The audience (presentation output) window is positioned
                // programmatically onto an external monitor by setup_audience_window
                // every time a presentation starts — it must never be restored from a
                // stale saved position/size, which would fight that placement logic.
                .with_denylist(&["audience"])
                .build(),
        )
        .manage(AppState {
            watch: Mutex::new(WatchState { current_file: None, watcher: None }),
            exit_confirmed: AtomicBool::new(false),
            // "Open With" on Linux/Windows (and now terminal launches on all
            // three platforms) passes file paths as CLI arguments; cli::startup
            // has already collected the ones that exist. The frontend drains
            // them via take_pending_open after mount. macOS Finder opens arrive
            // later via RunEvent::Opened below.
            pending_open: Mutex::new(startup.open),
            pending_cli: Mutex::new(startup.pending),
            own_write_suppress_until: Arc::new(AtomicU64::new(0)),
        })
        .setup(move |app| {
            // macOS: titleBarStyle Overlay still draws the window title text next
            // to the traffic lights, and setTitle("") doesn't clear it. Hide it at
            // the NSWindow level so only the in-app centered doctitle shows.
            #[cfg(target_os = "macos")]
            {
                use objc2_app_kit::{NSWindow, NSWindowTitleVisibility};
                if let Some(win) = app.get_webview_window("main") {
                    if let Ok(ptr) = win.ns_window() {
                        let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                        unsafe {
                            ns.setTitleVisibility(NSWindowTitleVisibility::Hidden);
                            ns.setTitlebarAppearsTransparent(true);
                        }
                    }
                }
            }
            // The main window is declared visible: false in tauri.conf.json so
            // CLI actions can run without flashing the editor. Normal launches
            // show it here (after creation, before the event loop pumps —
            // flash-free, identical UX to a config-visible window). CLI actions
            // leave it hidden: the frontend shows it when entering presentation,
            // and a standalone --check never shows it at all.
            if !cli_action_active {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::start_watching,
            commands::rename_file,
            commands::stop_watching,
            commands::load_keybindings,
            commands::load_custom_themes,
            commands::list_system_fonts,
            commands::write_file_bytes,
            commands::read_file_b64,
            commands::write_asset_bytes,
            commands::copy_image_to_assets,
            commands::scan_asset_refs,
            commands::copy_file_with_assets,
            commands::show_in_file_manager,
            commands::setup_audience_window,
            commands::debug_monitors,
            commands::can_self_update,
            commands::restart_app,
            commands::save_theme,
            commands::delete_theme,
            commands::download_and_cache_font,
            commands::set_wake_lock,
            commands::read_clipboard_image,
            commands::read_clipboard_text,
            commands::fetch_url_b64,
            commands::fetch_url_text,
            commands::probe_url,
            commands::confirm_exit,
            commands::cli_exit,
            commands::cli_stdout,
            commands::install_cli_symlink,
            commands::path_exists,
            commands::take_pending_open,
            commands::take_pending_cli,
            commands::export_pdf_native,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Cmd+Q (macOS default app menu), Dock "Quit", and any other app-level quit
    // triggers RunEvent::ExitRequested rather than the main window's
    // CloseRequested — the latter is already guarded by the frontend's
    // `onCloseRequested` listener (App.tsx), but that listener never fires for
    // an app-level quit. Intercept here so unsaved changes get the same
    // confirmation prompt regardless of which gesture the user used to quit.
    app.run(move |app_handle, event| {
        // macOS file association: double-click / "Open With" delivers paths here.
        // Emit for a running app; also buffer so a launch-with-file isn't lost
        // before the frontend mounts its listener (drained via take_pending_open).
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if !paths.is_empty() {
                let state = app_handle.state::<AppState>();
                // Dedupe against paths already buffered from argv — a terminal
                // launch now populates pending_open on macOS too, and the same
                // file must not open twice if Opened also delivers it.
                let mut pending = state.pending_open.lock().unwrap_or_else(|e| e.into_inner());
                for p in &paths {
                    if !pending.contains(p) {
                        pending.push(p.clone());
                    }
                }
                drop(pending);
                let _ = app_handle.emit("open-file", paths);
            }
            return;
        }
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let state = app_handle.state::<AppState>();
            if state.exit_confirmed.load(Ordering::SeqCst) {
                return; // user already confirmed via confirm_exit — let it through
            }
            // Only intercept while the main window is still alive; if it has
            // already closed cleanly (e.g. via the window-level close flow) there
            // is nothing left to confirm and the exit should proceed normally.
            if app_handle.get_webview_window("main").is_some() {
                api.prevent_exit();
                let _ = app_handle.emit("app-exit-requested", ());
            }
        }
    });
}
