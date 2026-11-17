/**
 * Run a fire-and-forget promise (window ops, event emits, opening URLs) whose
 * failure is not actionable. Rejections are swallowed; in dev builds they are
 * reported via console.debug so they can still be spotted. Never rejects.
 */
export function bestEffort<T>(promise: Promise<T>, label: string): Promise<T | undefined> {
  return promise.catch((err: unknown) => {
    if (import.meta.env.DEV) console.debug(`[bestEffort] ${label} failed:`, err);
    return undefined;
  });
}
