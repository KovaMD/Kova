use tauri::{AppHandle, Manager};

/// Prevent (or allow again) display sleep during presentations. The per-OS
/// implementations live in `crate::wake_lock`.
#[tauri::command]
pub fn set_wake_lock(active: bool) {
    crate::wake_lock::set(active);
}

/// A monitor's geometry as `(x, y, width, height)` in GDK screen coordinates.
#[cfg(any(target_os = "linux", test))]
type MonitorRect = (i32, i32, i32, i32);

/// The points handed to GDK's `monitor_at_point`, in the order they are tried.
/// Each is offset by +1 so it lands inside the monitor rather than on its edge.
/// Wayland only gets the logical point; X11 tries physical first, then logical.
#[cfg(any(target_os = "linux", test))]
fn audience_probe_points(
    is_wayland: bool,
    x: f64,
    y: f64,
    physical_x: f64,
    physical_y: f64,
) -> Vec<(i32, i32)> {
    if is_wayland {
        vec![(x as i32 + 1, y as i32 + 1)]
    } else {
        vec![
            (physical_x as i32 + 1, physical_y as i32 + 1),
            (x as i32 + 1, y as i32 + 1),
        ]
    }
}

/// Chooses the monitor index for `fullscreen_on_monitor`.
///
/// `hit` is the geometry of the monitor GDK found at one of the probe points,
/// if any. `monitors[i]` is the geometry of GDK monitor `i` (None if GDK could
/// not return it). `target` is the logical target point.
///
/// With a hit, returns the first index whose geometry equals it (0 if none
/// does). Without one, falls back to proximity: the monitor whose origin is
/// closest to `target`. That works regardless of primary-monitor availability
/// (Wayland exposes no primary) and regardless of DPI configuration.
#[cfg(any(target_os = "linux", test))]
fn pick_audience_monitor(
    hit: Option<MonitorRect>,
    monitors: &[Option<MonitorRect>],
    target: (i32, i32),
) -> i32 {
    let n = monitors.len() as i32;
    if let Some(geom) = hit {
        (0..n)
            .find(|&i| monitors[i as usize].map(|m| m == geom).unwrap_or(false))
            .unwrap_or(0)
    } else {
        let (tx, ty) = target;
        (0..n)
            .min_by_key(|&i| {
                monitors[i as usize]
                    .map(|(gx, gy, _, _)| {
                        let dx = (gx - tx) as i64;
                        let dy = (gy - ty) as i64;
                        dx * dx + dy * dy
                    })
                    .unwrap_or(i64::MAX)
            })
            .unwrap_or(0)
    }
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
    physical_x: f64,
    physical_y: f64,
) -> Result<(), String> {
    // Wait for the audience window to appear in the manager, up to 5 s.
    // This replaces a single fixed sleep: on fast machines we proceed sooner;
    // on slow/loaded machines we don't give up prematurely.
    let found = 'wait: {
        for _ in 0..50 {
            if app.get_webview_window("audience").is_some() {
                break 'wait true;
            }
            crate::util::sleep_ms(100).await;
        }
        false
    };
    if !found {
        return Err("audience window did not appear within 5 s".into());
    }
    // Brief extra pause to allow the native GTK/NS/HWND handle to be realized
    // after the window first appears in the manager.
    crate::util::sleep_ms(150).await;

    #[cfg(target_os = "linux")]
    {
        #[cfg(debug_assertions)]
        eprintln!("[kova] setup_audience_window: logical x={x:.0} y={y:.0}  physical x={physical_x:.0} y={physical_y:.0}");
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

            let candidates = audience_probe_points(is_wayland, x, y, physical_x, physical_y);

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

            #[cfg(debug_assertions)]
            if found_monitor.is_none() {
                eprintln!("[kova] monitor_at_point returned None; using proximity fallback");
            }
            let to_rect = |g: gdk::Rectangle| -> MonitorRect { (g.x(), g.y(), g.width(), g.height()) };
            let monitors: Vec<Option<MonitorRect>> = (0..n)
                .map(|i| display.monitor(i).map(|m| to_rect(m.geometry())))
                .collect();
            let target = pick_audience_monitor(
                found_monitor.map(|m| to_rect(m.geometry())),
                &monitors,
                (x as i32, y as i32),
            );

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
        // The physical coordinates are only needed by the Linux/X11 path above.
        let _ = (physical_x, physical_y);
        if let Some(win) = app.get_webview_window("audience") {
            win.set_position(tauri::LogicalPosition::<f64>::new(x, y))
                .map_err(|e: tauri::Error| e.to_string())?;
        }
        crate::util::sleep_ms(250).await;
        if let Some(win) = app.get_webview_window("audience") {
            win.set_fullscreen(true).map_err(|e: tauri::Error| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Laptop panel at the origin plus an external monitor to its right.
    const LAPTOP: MonitorRect = (0, 0, 1920, 1080);
    const EXTERNAL: MonitorRect = (1920, 0, 2560, 1440);

    // audience_probe_points

    #[test]
    fn wayland_probes_only_the_logical_point() {
        assert_eq!(audience_probe_points(true, 1920.0, 0.0, 3840.0, 0.0), vec![(1921, 1)]);
    }

    #[test]
    fn x11_probes_physical_then_logical() {
        assert_eq!(
            audience_probe_points(false, 1920.0, 0.0, 3840.0, 0.0),
            vec![(3841, 1), (1921, 1)],
        );
    }

    #[test]
    fn probe_points_truncate_fractions_towards_zero() {
        assert_eq!(audience_probe_points(true, 1919.9, 0.6, 0.0, 0.0), vec![(1920, 1)]);
        assert_eq!(audience_probe_points(true, -0.5, -1.5, 0.0, 0.0), vec![(1, 0)]);
    }

    #[test]
    fn probe_points_handle_negative_origins() {
        // A monitor placed to the left of the primary has a negative x.
        assert_eq!(audience_probe_points(true, -1920.0, 0.0, 0.0, 0.0), vec![(-1919, 1)]);
    }

    #[test]
    fn probe_points_map_nan_to_zero() {
        // Characterisation: an f64 to i32 cast turns NaN into 0.
        assert_eq!(audience_probe_points(true, f64::NAN, 0.0, 0.0, 0.0), vec![(1, 1)]);
    }

    // pick_audience_monitor: hit path

    #[test]
    fn hit_returns_the_matching_monitor_index() {
        let monitors = [Some(LAPTOP), Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(Some(EXTERNAL), &monitors, (0, 0)), 1);
        assert_eq!(pick_audience_monitor(Some(LAPTOP), &monitors, (5000, 5000)), 0);
    }

    #[test]
    fn hit_ignores_the_target_point() {
        // A hit wins even when another monitor's origin is nearer the target.
        let monitors = [Some(LAPTOP), Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(Some(EXTERNAL), &monitors, (0, 0)), 1);
    }

    #[test]
    fn hit_with_mirrored_geometry_returns_first_match() {
        let monitors = [Some(EXTERNAL), Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(Some(EXTERNAL), &monitors, (0, 0)), 0);
    }

    #[test]
    fn hit_skips_monitors_gdk_could_not_return() {
        let monitors = [None, Some(LAPTOP), Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(Some(EXTERNAL), &monitors, (0, 0)), 2);
    }

    #[test]
    fn hit_not_in_list_falls_back_to_zero_not_proximity() {
        // Characterisation: an unmatched hit gives 0 without trying proximity.
        let monitors = [Some(LAPTOP), Some(EXTERNAL)];
        let stray = (1920, 0, 1280, 720);
        assert_eq!(pick_audience_monitor(Some(stray), &monitors, (1920, 0)), 0);
    }

    #[test]
    fn hit_must_match_size_as_well_as_origin() {
        let monitors = [Some(LAPTOP), Some((1920, 0, 1920, 1080)), Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(Some(EXTERNAL), &monitors, (0, 0)), 2);
    }

    // pick_audience_monitor: proximity fallback

    #[test]
    fn no_hit_picks_the_nearest_origin() {
        let monitors = [Some(LAPTOP), Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(None, &monitors, (1920, 0)), 1);
        assert_eq!(pick_audience_monitor(None, &monitors, (10, 10)), 0);
        assert_eq!(pick_audience_monitor(None, &monitors, (1900, 0)), 1);
    }

    #[test]
    fn no_hit_measures_to_origin_not_containment() {
        // Characterisation: the point (1200, 0) lies on the laptop panel but is
        // nearer the external monitor's origin, so the external one is chosen.
        let monitors = [Some(LAPTOP), Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(None, &monitors, (1200, 0)), 1);
    }

    #[test]
    fn no_hit_tie_picks_the_lowest_index() {
        let monitors = [Some((-100, 0, 100, 100)), Some((100, 0, 100, 100))];
        assert_eq!(pick_audience_monitor(None, &monitors, (0, 0)), 0);
    }

    #[test]
    fn no_hit_skips_missing_monitors() {
        let monitors = [None, Some(EXTERNAL)];
        assert_eq!(pick_audience_monitor(None, &monitors, (0, 0)), 1);
    }

    #[test]
    fn no_hit_with_all_monitors_missing_returns_zero() {
        assert_eq!(pick_audience_monitor(None, &[None, None], (0, 0)), 0);
    }

    #[test]
    fn no_monitors_returns_zero() {
        assert_eq!(pick_audience_monitor(None, &[], (0, 0)), 0);
        assert_eq!(pick_audience_monitor(Some(LAPTOP), &[], (0, 0)), 0);
    }

    #[test]
    fn no_hit_squared_distance_does_not_overflow_for_large_gaps() {
        // Squares are taken in i64, so a gap of ~100k pixels on both axes
        // (whose square would overflow i32) still compares correctly.
        let monitors = [Some((100_000, 100_000, 1, 1)), Some((0, 0, 1, 1))];
        assert_eq!(pick_audience_monitor(None, &monitors, (100_000, 100_001)), 0);
        assert_eq!(pick_audience_monitor(None, &monitors, (1, 1)), 1);
    }
}
