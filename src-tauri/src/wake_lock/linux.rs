use gio::glib::Variant;
use gio::prelude::*;
use std::sync::Mutex;

static SCREENSAVER_COOKIE: Mutex<Option<u32>> = Mutex::new(None);

pub fn set(active: bool) {
    let mut cookie_guard = SCREENSAVER_COOKIE.lock().unwrap_or_else(|e| e.into_inner());
    if active && cookie_guard.is_none() {
        if let Some(result) = screensaver_call("Inhibit", &inhibit_args()) {
            if let Some((cookie,)) = result.get::<(u32,)>() {
                *cookie_guard = Some(cookie);
            }
        }
    } else if !active {
        if let Some(c) = cookie_guard.take() {
            let _ = screensaver_call("UnInhibit", &uninhibit_args(c));
        }
    }
}

/// Arguments for `org.freedesktop.ScreenSaver.Inhibit(application, reason)`.
fn inhibit_args() -> Variant {
    ("Kova", "Presentation mode").to_variant()
}

/// Arguments for `org.freedesktop.ScreenSaver.UnInhibit(cookie)`.
fn uninhibit_args(cookie: u32) -> Variant {
    (cookie,).to_variant()
}

/// Call `method` on the session bus's `org.freedesktop.ScreenSaver` service.
/// Returns `None` if the bus is unreachable or the call fails.
fn screensaver_call(method: &str, args: &Variant) -> Option<Variant> {
    let conn = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE).ok()?;
    conn.call_sync(
        Some("org.freedesktop.ScreenSaver"),
        "/org/freedesktop/ScreenSaver",
        "org.freedesktop.ScreenSaver",
        method,
        Some(args),
        None,
        gio::DBusCallFlags::NONE,
        -1,
        gio::Cancellable::NONE,
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inhibit_args_are_application_and_reason_strings() {
        let args = inhibit_args();
        assert_eq!(args.type_().as_str(), "(ss)");
        assert_eq!(
            args.get::<(String, String)>(),
            Some(("Kova".to_string(), "Presentation mode".to_string()))
        );
    }

    #[test]
    fn uninhibit_args_wrap_the_cookie() {
        let args = uninhibit_args(42);
        assert_eq!(args.type_().as_str(), "(u)");
        assert_eq!(args.get::<(u32,)>(), Some((42,)));
    }
}
