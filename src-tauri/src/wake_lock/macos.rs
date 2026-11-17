use std::sync::Mutex;

static CAFFEINATE: Mutex<Option<std::process::Child>> = Mutex::new(None);

pub fn set(active: bool) {
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
