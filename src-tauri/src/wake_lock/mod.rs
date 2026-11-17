//! Wake lock: keeps the display awake while a presentation is running.
//!
//! Each operating system has its own mechanism, so each lives in its own
//! module and only the one matching the build target is compiled in:
//!
//! - macOS: a `caffeinate -d -i` child process held for the duration.
//! - Linux: an `org.freedesktop.ScreenSaver.Inhibit` D-Bus cookie.
//! - Windows: `SetThreadExecutionState` re-asserted from a dedicated thread.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(target_os = "windows")]
use windows as platform;

/// Acquire (`true`) or release (`false`) the display wake lock.
///
/// Acquiring while already held, or releasing while not held, is a no-op.
/// Failures are silently ignored, matching the previous behaviour: a missing
/// wake lock must never stop a presentation from starting.
pub fn set(active: bool) {
    platform::set(active);
}
