mod commands;
mod file_io;
mod watcher;

use commands::AppState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            current_file: Mutex::new(None),
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::start_watching,
            commands::stop_watching,
            commands::load_keybindings,
            commands::load_custom_themes,
            commands::list_system_fonts,
            commands::write_file_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
