use crate::{file_io, watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Opens a path in the native file manager (Finder / Nautilus / Explorer).
/// Uses platform process commands directly rather than tauri-plugin-opener,
/// which requires path scopes to be configured before it works on macOS.
#[tauri::command]
pub fn show_in_file_manager(path: String) -> Result<(), String> {
    let is_file = std::path::Path::new(&path).is_file();

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if is_file {
            cmd.arg("-R"); // reveal file in Finder rather than opening it
        }
        cmd.arg(&path).spawn().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open handles both files (opens parent dir) and directories
        let target = if is_file {
            std::path::Path::new(&path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(path.clone())
        } else {
            path.clone()
        };
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer");
        if is_file {
            cmd.arg(format!("/select,{path}")); // select file in Explorer
        } else {
            cmd.arg(&path);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Move the audience window to the correct external monitor then fullscreen it.
///
/// On Linux/Wayland setPosition is a no-op — the compositor controls window
/// placement and ignores application-supplied coordinates. The only reliable
/// protocol is xdg_toplevel_set_fullscreen(output), exposed through GTK3 as
/// gtk_window_fullscreen_on_monitor(screen, n).
///
/// On macOS and Windows the classic set_position → sleep → set_fullscreen
/// sequence works fine because those compositors honour the move.
#[tauri::command]
pub async fn setup_audience_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    // Give the audience window time to finish creating its native GTK/NS/HWND
    // handle before we try to fullscreen it.
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(400));
    })
    .await
    .ok();

    #[cfg(target_os = "linux")]
    {
        eprintln!("[kova] setup_audience_window: logical x={x:.0} y={y:.0}");
        let app2 = app.clone();
        app.run_on_main_thread(move || {
            use gtk::prelude::GtkWindowExt;
            use gdk::prelude::MonitorExt;

            let win = match app2.get_webview_window("audience") {
                Some(w) => w,
                None => { eprintln!("[kova] audience window not found in GTK thread"); return; }
            };
            let gtk_win = match win.gtk_window() {
                Ok(w) => w,
                Err(e) => { eprintln!("[kova] gtk_window() failed: {e}"); return; }
            };
            let display = match gdk::Display::default() {
                Some(d) => d,
                None => { eprintln!("[kova] no default GDK display"); return; }
            };

            let screen  = display.default_screen();
            let n       = display.n_monitors();
            let primary = display.primary_monitor();

            eprintln!("[kova] GDK sees {n} monitor(s):");
            for i in 0..n {
                if let Some(m) = display.monitor(i) {
                    let g = m.geometry();
                    let is_primary = primary.as_ref()
                        .map(|p| p.geometry() == g)
                        .unwrap_or(false);
                    eprintln!("[kova]   [{i}] pos=({},{}) size={}×{} primary={is_primary}",
                        g.x(), g.y(), g.width(), g.height());
                }
            }

            // Use the logical position passed from JS to identify the target monitor.
            // monitor_at_point is more reliable than "find non-primary" because it
            // works regardless of which monitor the OS considers primary.
            let cx = x as i32 + 1;
            let cy = y as i32 + 1;
            let target: i32 = if let Some(mon) = display.monitor_at_point(cx, cy) {
                let geom = mon.geometry();
                eprintln!("[kova] monitor_at_point({cx},{cy}) → ({},{}) {}×{}",
                    geom.x(), geom.y(), geom.width(), geom.height());
                (0..n)
                    .find(|&i| display.monitor(i).map(|m| m.geometry() == geom).unwrap_or(false))
                    .unwrap_or(0)
            } else {
                eprintln!("[kova] monitor_at_point({cx},{cy}) returned None; falling back to first non-primary");
                (0..n)
                    .find(|&i| {
                        display.monitor(i)
                            .map(|m| primary.as_ref().map(|p| p.geometry() != m.geometry()).unwrap_or(true))
                            .unwrap_or(false)
                    })
                    .unwrap_or(0)
            };

            eprintln!("[kova] calling fullscreen_on_monitor({target})");
            gtk_win.fullscreen_on_monitor(&screen, target);
            eprintln!("[kova] fullscreen_on_monitor done");
        })
        .map_err(|e| format!("run_on_main_thread failed: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
        // macOS / Windows: move to the external monitor, pause, then go fullscreen.
        if let Some(win) = app.get_webview_window("audience") {
            win.set_position(tauri::LogicalPosition::<f64>::new(x, y))
                .map_err(|e: tauri::Error| e.to_string())?;
        }
        tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(std::time::Duration::from_millis(250));
        })
        .await
        .ok();
        if let Some(win) = app.get_webview_window("audience") {
            win.set_fullscreen(true).map_err(|e: tauri::Error| e.to_string())?;
        }
        Ok(())
    }
}

/// Returns a formatted string describing monitor layout from both Tauri's and
/// GDK's perspective. Call from the browser devtools console:
///   await window.__TAURI__.core.invoke('debug_monitors')
#[tauri::command]
pub fn debug_monitors(app: AppHandle) -> String {
    let mut out = String::new();

    match app.primary_monitor() {
        Ok(Some(pm)) => out.push_str(&format!("Tauri primary: {:?}\n", pm.name())),
        Ok(None)     => out.push_str("Tauri primary: (none)\n"),
        Err(e)       => out.push_str(&format!("Tauri primary error: {e}\n")),
    }
    match app.available_monitors() {
        Ok(monitors) => {
            for (i, m) in monitors.iter().enumerate() {
                out.push_str(&format!(
                    "Tauri[{i}]: {:?}  pos=({},{})  {}×{}  scale={:.1}\n",
                    m.name(),
                    m.position().x, m.position().y,
                    m.size().width, m.size().height,
                    m.scale_factor(),
                ));
            }
        }
        Err(e) => out.push_str(&format!("Tauri monitors error: {e}\n")),
    }

    #[cfg(target_os = "linux")]
    {
        use gdk::prelude::MonitorExt;
        out.push('\n');
        if let Some(display) = gdk::Display::default() {
            let n       = display.n_monitors();
            let primary = display.primary_monitor();
            out.push_str(&format!("GDK: {n} monitor(s)\n"));
            for i in 0..n {
                if let Some(m) = display.monitor(i) {
                    let g = m.geometry();
                    let is_primary = primary.as_ref()
                        .map(|p| p.geometry() == g)
                        .unwrap_or(false);
                    out.push_str(&format!(
                        "GDK[{i}]: pos=({},{})  {}×{}  primary={is_primary}\n",
                        g.x(), g.y(), g.width(), g.height()
                    ));
                }
            }
        } else {
            out.push_str("GDK: no default display\n");
        }
    }

    out
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
    let raw_stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext      = src_path.extension().and_then(|s| s.to_str()).unwrap_or("png");

    // Sanitise: replace whitespace and characters that break Markdown link syntax.
    let stem: String = raw_stem.chars()
        .map(|c| if c.is_whitespace() || matches!(c, '(' | ')' | '[' | ']' | '"' | '\'') { '_' } else { c })
        .collect();

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

/// Returns true if the running installation supports in-place updates.
/// On Linux this requires AppImage — deb/rpm users must update via their package manager.
#[tauri::command]
pub fn can_self_update() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var("APPIMAGE").is_ok()
    } else {
        true
    }
}

/// Returns a sorted, deduplicated list of font family names available on the system.
#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    #[cfg(not(target_os = "windows"))]
    {
        // Linux and macOS: use fontconfig
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

    #[cfg(target_os = "windows")]
    {
        // Windows: enumerate fonts via PowerShell (.NET InstalledFontCollection)
        let output = match std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[System.Drawing.Text.InstalledFontCollection]::new().Families | \
                 ForEach-Object { $_.Name }",
            ])
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
}
