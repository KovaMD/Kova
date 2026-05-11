// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // AppImage sandboxing breaks WebKit input events; disable it when running as AppImage.
    #[cfg(target_os = "linux")]
    if std::env::var("APPIMAGE").is_ok() {
        std::env::set_var("WEBKIT_FORCE_SANDBOX", "0");
    }

    kova_lib::run()
}
