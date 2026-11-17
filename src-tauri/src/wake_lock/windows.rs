use std::sync::Mutex;

extern "system" {
    fn SetThreadExecutionState(esFlags: u32) -> u32;
}

// Sender whose drop signals the wake-lock thread to exit.
static WIN_WAKE_TX: Mutex<Option<std::sync::mpsc::SyncSender<()>>> = Mutex::new(None);

// SetThreadExecutionState is per-thread; calling it on a Tokio pool thread
// whose lifetime we don't control would let the inhibit lapse silently when
// that thread is recycled. A dedicated persistent thread holds the state for
// the full duration of the presentation and re-asserts every 30 s as
// recommended by the Windows docs.
pub fn set(active: bool) {
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
