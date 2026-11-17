use tauri::{AppHandle, Manager};

/// Prevent (or allow again) display sleep during presentations. The per-OS
/// implementations live in `crate::wake_lock`.
#[tauri::command]
pub fn set_wake_lock(active: bool) {
    crate::wake_lock::set(active);
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
