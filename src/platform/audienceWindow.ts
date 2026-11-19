// The audience (second-screen) window used by dual and mirror presentation
// modes: monitor detection, creation, the present:* event handshake and
// teardown. Each wrapper does exactly what the inline App.tsx code did, so
// callers keep their own ordering and error handling.
import { emit, emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor, type Monitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as ipc from './ipc';
import type { PresentInitPayload } from '../AudienceApp';

export const AUDIENCE_WINDOW_LABEL = 'audience';

export interface DetectedMonitors {
  all: Monitor[];
  /** Null on Wayland, where the compositor doesn't report it. */
  current: Monitor | null;
}

/**
 * All monitors plus the one Kova is running on. Uses currentMonitor(), not
 * primaryMonitor(): on Wayland primaryMonitor() returns null for every
 * monitor. Never rejects; a failed query reports no monitors.
 */
export async function detectMonitors(): Promise<DetectedMonitors> {
  let all: Monitor[] = [];
  let current: Monitor | null = null;
  try {
    [all, current] = await Promise.all([availableMonitors(), currentMonitor()]);
  } catch { /* ignore */ }
  return { all, current };
}

/** Close the audience window if one is open. Never rejects. */
export async function closeAudienceWindow(): Promise<void> {
  try {
    const win = await WebviewWindow.getByLabel(AUDIENCE_WINDOW_LABEL);
    if (win) await win.close().catch(() => {});
  } catch { /* ignore */ }
}

/**
 * Create the frameless audience window over `monitor`. No fullscreen:true:
 * on Linux that ignores x/y and captures the primary monitor. Fullscreen is
 * applied by positionAudienceWindow after present:ready fires.
 */
export function createAudienceWindow(monitor: Monitor): WebviewWindow {
  return new WebviewWindow(AUDIENCE_WINDOW_LABEL, {
    url: '/#audience',
    x: monitor.position.x / monitor.scaleFactor,
    y: monitor.position.y / monitor.scaleFactor,
    width: monitor.size.width / monitor.scaleFactor,
    height: monitor.size.height / monitor.scaleFactor,
    decorations: false,
    title: 'Kova — Presentation',
    resizable: false,
    focus: false,
  });
}

/** Fires once the audience window's React tree is listening. */
export const onAudienceReady = (handler: () => void): Promise<UnlistenFn> =>
  listen('present:ready', handler);

/** Hand the audience window its deck and starting position. */
export const sendPresentInit = (payload: PresentInitPayload): Promise<void> =>
  emitTo(AUDIENCE_WINDOW_LABEL, 'present:init', payload);

/** Move the audience window onto `monitor` and fullscreen it (via Rust). Never rejects. */
export async function positionAudienceWindow(monitor: Monitor): Promise<void> {
  await ipc.setupAudienceWindow({
    x: monitor.position.x / monitor.scaleFactor,
    y: monitor.position.y / monitor.scaleFactor,
    physicalX: monitor.position.x,
    physicalY: monitor.position.y,
  }).catch(() => {});
}

/** Broadcast the end of the presentation to the audience window. Never rejects. */
export async function emitPresentExit(): Promise<void> {
  await emit('present:exit', null).catch(() => {});
}
