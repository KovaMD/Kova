// Quitting Kova: the OS window close (Alt+F4, taskbar "Close window",
// compositor gestures) and the app-level quit (Cmd+Q, Dock "Quit") both go
// through the unsaved-changes guard before the process exits.
import { useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirmExit, setWakeLock } from '../platform/ipc';
import { bestEffort } from '../platform/bestEffort';

export interface UseWindowLifecycleOptions {
  /** Runs `proceed` now, or after the user resolves the unsaved-changes prompt. */
  guardDirty: (proceed: () => void) => void;
}

export function useWindowLifecycle({ guardDirty }: UseWindowLifecycleOptions) {
  /** Exit the app (no prompt; callers go through guardDirty first). */
  const quitApp = useCallback(async () => {
    // Unconditional: guarantees the macOS `caffeinate` child (and the Linux
    // DBus screensaver inhibit) are released on every normal quit path, not
    // just the ones that remembered to flip presentMode/presenterMode off
    // first. A crash/kill -9 can't be intercepted from user space.
    await bestEffort(setWakeLock(false), 'set_wake_lock');
    // confirm_exit sets exit_confirmed=true then calls app.exit(0). Using
    // destroy() here instead causes a race on Linux: GTK's window teardown is
    // async relative to Tauri's registry, so get_webview_window("main") still
    // returns Some during ExitRequested and prevent_exit() is called, leaving
    // the process alive with no visible window.
    await bestEffort(confirmExit(), 'confirm_exit');
  }, []);

  // OS-level window close. Kova's own close button calls guardDirty(quitApp)
  // directly so it never reaches this path. Tauri calls prevent_close() while
  // a JS listener is registered; event.preventDefault() makes that explicit so
  // the contract doesn't depend on that implementation detail.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      guardDirty(quitApp);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [guardDirty, quitApp]);

  // App-level quit (Cmd+Q / Dock "Quit" on macOS, or any other path that
  // exits the whole app rather than just this window): see the matching
  // RunEvent::ExitRequested handler in lib.rs. This never fires for the
  // window-level close above, so both need their own guard.
  useEffect(() => {
    const unlisten = listen('app-exit-requested', () => { guardDirty(quitApp); });
    return () => { unlisten.then((fn) => fn()); };
  }, [guardDirty, quitApp]);

  return { quitApp };
}
