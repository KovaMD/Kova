/**
 * The fields of a Tauri `Monitor` that external-monitor selection reads.
 * Structural so the engine stays free of Tauri imports; generic callers get
 * their own monitor type back.
 */
export interface MonitorLike {
  name: string | null;
  position: { x: number; y: number };
}

/**
 * Pick the monitor the audience window should go on, or null when there is
 * only one display.
 *
 * `current` is the monitor Kova is running on (currentMonitor(), not
 * primaryMonitor(): on Wayland primaryMonitor() returns null for every
 * monitor because "primary" is an X11 concept the compositor doesn't expose).
 * With a current monitor, the first monitor with a different name wins;
 * name-based matching works on macOS and Windows.
 *
 * Wayland: currentMonitor() can also return null. Heuristic: the secondary
 * monitor is typically to the right or below, so pick the one whose origin is
 * furthest from (0, 0) (x + y; ties keep the earlier monitor).
 */
export function pickExternalMonitor<M extends MonitorLike>(all: readonly M[], current: M | null): M | null {
  if (all.length <= 1) return null;
  if (current) {
    return all.find((m) => m.name !== current.name) ?? null;
  }
  return all.reduce((best, m) =>
    (m.position.x + m.position.y) > (best.position.x + best.position.y) ? m : best
  );
}
