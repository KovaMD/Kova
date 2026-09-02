use crate::file_io;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// --- Wake lock (prevent display sleep during presentations) ---

#[cfg(target_os = "macos")]
static CAFFEINATE: Mutex<Option<std::process::Child>> = Mutex::new(None);

#[cfg(target_os = "linux")]
static SCREENSAVER_COOKIE: Mutex<Option<u32>> = Mutex::new(None);

#[cfg(target_os = "windows")]
extern "system" {
    fn SetThreadExecutionState(esFlags: u32) -> u32;
}

// Sender whose drop signals the wake-lock thread to exit.
#[cfg(target_os = "windows")]
static WIN_WAKE_TX: Mutex<Option<std::sync::mpsc::SyncSender<()>>> = Mutex::new(None);

#[tauri::command]
#[allow(unused_variables)]
pub fn set_wake_lock(active: bool) {
    #[cfg(target_os = "macos")]
    {
        let mut guard = CAFFEINATE.lock().unwrap_or_else(|e| e.into_inner());
        if active {
            if guard.is_none() {
                // -d: prevent display sleep; -i: prevent idle sleep (also suppresses App Nap,
                // which can throttle background WebViews after ~10 min of inactivity).
                if let Ok(child) = std::process::Command::new("caffeinate").args(["-d", "-i"]).spawn() {
                    *guard = Some(child);
                }
            }
        } else if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    #[cfg(target_os = "linux")]
    {
        use gio::prelude::*;
        let mut cookie_guard = SCREENSAVER_COOKIE.lock().unwrap_or_else(|e| e.into_inner());
        if active && cookie_guard.is_none() {
            if let Ok(conn) = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) {
                let args = ("Kova", "Presentation mode").to_variant();
                if let Ok(result) = conn.call_sync(
                    Some("org.freedesktop.ScreenSaver"),
                    "/org/freedesktop/ScreenSaver",
                    "org.freedesktop.ScreenSaver",
                    "Inhibit",
                    Some(&args),
                    None,
                    gio::DBusCallFlags::NONE,
                    -1,
                    gio::Cancellable::NONE,
                ) {
                    if let Some((cookie,)) = result.get::<(u32,)>() {
                        *cookie_guard = Some(cookie);
                    }
                }
            }
        } else if !active {
            if let Some(c) = cookie_guard.take() {
                if let Ok(conn) = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) {
                    let args = (c,).to_variant();
                    let _ = conn.call_sync(
                        Some("org.freedesktop.ScreenSaver"),
                        "/org/freedesktop/ScreenSaver",
                        "org.freedesktop.ScreenSaver",
                        "UnInhibit",
                        Some(&args),
                        None,
                        gio::DBusCallFlags::NONE,
                        -1,
                        gio::Cancellable::NONE,
                    );
                }
            }
        }
    }

    // SetThreadExecutionState is per-thread; calling it on a Tokio pool thread
    // whose lifetime we don't control would let the inhibit lapse silently when
    // that thread is recycled. A dedicated persistent thread holds the state for
    // the full duration of the presentation and re-asserts every 30 s as
    // recommended by the Windows docs.
    #[cfg(target_os = "windows")]
    {
        let mut guard = WIN_WAKE_TX.lock().unwrap_or_else(|e| e.into_inner());
        if active {
            if guard.is_none() {
                let (tx, rx) = std::sync::mpsc::sync_channel::<()>(0);
                *guard = Some(tx);
                std::thread::spawn(move || unsafe {
                    const ES_CONTINUOUS: u32 = 0x80000000;
                    const ES_DISPLAY_REQUIRED: u32 = 0x00000002;
                    SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
                    loop {
                        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                                SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
                            }
                            _ => break,
                        }
                    }
                    SetThreadExecutionState(ES_CONTINUOUS);
                });
            }
        } else {
            guard.take(); // drop sender → thread's recv returns Disconnected → exits
        }
    }
}

/// Opens a path in the native file manager (Finder / Nautilus / Explorer).
/// Uses platform process commands directly rather than tauri-plugin-opener,
/// which requires path scopes to be configured before it works on macOS.
#[tauri::command]
pub fn show_in_file_manager(path: String) -> Result<(), String> {
    // Canonicalize (resolves symlinks/traversal) and enforce home boundary.
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Invalid path: {e}"))?;
    file_io::check_in_home(&canonical)?;

    let is_file = canonical.is_file();

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if is_file {
            cmd.arg("-R"); // reveal file in Finder rather than opening it
        }
        cmd.arg(&canonical).spawn().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open handles both files (opens parent dir) and directories
        let target = if is_file {
            canonical.parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| canonical.to_string_lossy().into_owned())
        } else {
            canonical.to_string_lossy().into_owned()
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
            // Strip the \\?\ extended-length prefix that canonicalize adds on Windows
            // — Explorer /select does not recognise UNC-prefixed paths.
            let clean = file_io::strip_verbatim_prefix(canonical.to_string_lossy().into_owned());
            cmd.arg(format!("/select,\"{}\"", clean));
        } else {
            cmd.arg(&canonical);
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
///
/// `x`/`y` are logical pixels (physical ÷ scale factor from Tauri).
/// `physical_x`/`physical_y` are raw physical pixel coordinates, used on X11
/// where GDK may operate in physical-pixel screen coordinates.
#[tauri::command]
pub async fn setup_audience_window(
    app: AppHandle,
    x: f64,
    y: f64,
    _physical_x: f64,
    _physical_y: f64,
) -> Result<(), String> {
    // Wait for the audience window to appear in the manager, up to 5 s.
    // This replaces a single fixed sleep: on fast machines we proceed sooner;
    // on slow/loaded machines we don't give up prematurely.
    let found = 'wait: {
        for _ in 0..50 {
            if app.get_webview_window("audience").is_some() {
                break 'wait true;
            }
            tauri::async_runtime::spawn_blocking(|| {
                std::thread::sleep(std::time::Duration::from_millis(100));
            })
            .await
            .ok();
        }
        false
    };
    if !found {
        return Err("audience window did not appear within 5 s".into());
    }
    // Brief extra pause to allow the native GTK/NS/HWND handle to be realized
    // after the window first appears in the manager.
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
    })
    .await
    .ok();

    #[cfg(target_os = "linux")]
    {
        #[cfg(debug_assertions)]
        eprintln!("[kova] setup_audience_window: logical x={x:.0} y={y:.0}  physical x={_physical_x:.0} y={_physical_y:.0}");
        let app2 = app.clone();
        app.run_on_main_thread(move || {
            use gtk::prelude::GtkWindowExt;
            use gdk::prelude::MonitorExt;

            let win = match app2.get_webview_window("audience") {
                Some(w) => w,
                None => {
                    #[cfg(debug_assertions)]
                    eprintln!("[kova] audience window not found in GTK thread");
                    return;
                }
            };
            let gtk_win = match win.gtk_window() {
                Ok(w) => w,
                Err(e) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[kova] gtk_window() failed: {e}");
                    return;
                }
            };
            let display = match gdk::Display::default() {
                Some(d) => d,
                None => {
                    #[cfg(debug_assertions)]
                    eprintln!("[kova] no default GDK display");
                    return;
                }
            };

            let screen  = display.default_screen();
            let n       = display.n_monitors();

            #[cfg(debug_assertions)]
            {
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
            }

            // GDK coordinate space depends on the display backend:
            //   Wayland — logical (compositor) units, matching `x`/`y`.
            //   X11 without GDK_SCALE — physical pixels, matching `physical_x`/`physical_y`.
            //   X11 with GDK_SCALE — logical pixels, matching `x`/`y`.
            // Try physical coordinates first on X11 (they're always valid there),
            // then fall back to logical. On Wayland only use logical.
            let display_name = display.name();
            let is_wayland = display_name.to_ascii_lowercase().contains("wayland");

            let candidates: &[(i32, i32)] = if is_wayland {
                &[(x as i32 + 1, y as i32 + 1)]
            } else {
                &[
                    (_physical_x as i32 + 1, _physical_y as i32 + 1),
                    (x as i32 + 1, y as i32 + 1),
                ]
            };

            let found_monitor = candidates.iter().find_map(|&(cx, cy)| {
                let m = display.monitor_at_point(cx, cy)?;
                #[cfg(debug_assertions)]
                {
                    let g = m.geometry();
                    eprintln!("[kova] monitor_at_point({cx},{cy}) → ({},{}) {}×{}",
                        g.x(), g.y(), g.width(), g.height());
                }
                Some(m)
            });

            let target: i32 = if let Some(mon) = found_monitor {
                let geom = mon.geometry();
                (0..n)
                    .find(|&i| display.monitor(i).map(|m| m.geometry() == geom).unwrap_or(false))
                    .unwrap_or(0)
            } else {
                // Proximity fallback: pick the monitor whose origin is closest to the
                // logical target point. Works regardless of primary-monitor availability
                // (Wayland exposes no primary) and regardless of DPI configuration.
                #[cfg(debug_assertions)]
                eprintln!("[kova] monitor_at_point returned None; using proximity fallback");
                let (tx, ty) = (x as i32, y as i32);
                (0..n)
                    .min_by_key(|&i| {
                        display.monitor(i)
                            .map(|m| {
                                let g = m.geometry();
                                let dx = (g.x() - tx) as i64;
                                let dy = (g.y() - ty) as i64;
                                dx * dx + dy * dy
                            })
                            .unwrap_or(i64::MAX)
                    })
                    .unwrap_or(0)
            };

            #[cfg(debug_assertions)]
            eprintln!("[kova] calling fullscreen_on_monitor({target})");
            gtk_win.fullscreen_on_monitor(&screen, target);
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
#[cfg_attr(not(debug_assertions), allow(unreachable_code, unused_variables))]
pub fn debug_monitors(app: AppHandle) -> String {
    #[cfg(not(debug_assertions))]
    return String::new();

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
