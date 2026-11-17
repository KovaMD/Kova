//! Small shared helpers used across the Tauri commands and the file watcher.

/// Current wall-clock time as milliseconds since the Unix epoch.
///
/// Returns 0 if the system clock is set before 1970 (the same fallback every
/// call site used before this helper existed).
pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Pause an async command for `ms` milliseconds without blocking the async
/// runtime: the sleep runs on Tauri's blocking thread pool and is awaited.
pub async fn sleep_ms(ms: u64) {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    })
    .await
    .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_millis_is_after_2020_and_does_not_go_backwards() {
        // 2020-01-01T00:00:00Z in ms; guards against seconds/nanos mix-ups.
        let a = now_millis();
        assert!(a > 1_577_836_800_000, "now_millis looks wrong: {a}");
        let b = now_millis();
        assert!(b >= a, "now_millis went backwards: {a} -> {b}");
    }

    #[test]
    fn sleep_ms_waits_at_least_the_requested_time() {
        let start = std::time::Instant::now();
        tauri::async_runtime::block_on(sleep_ms(20));
        assert!(start.elapsed() >= std::time::Duration::from_millis(20));
    }
}
