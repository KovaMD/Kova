// Safe JSON persistence over localStorage. Both helpers swallow every failure
// (storage unavailable, quota exceeded, corrupt JSON) so callers can treat
// persisted state as a convenience rather than a correctness requirement.

/**
 * Read and parse the JSON value stored under `key`. Returns `fallback` when
 * the key is missing, the stored text is not valid JSON, localStorage throws,
 * or `validate` rejects the parsed value.
 */
export function readJson<T>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => value is T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Serialise `value` as JSON under `key`. Failures (storage unavailable or
 * full) are swallowed; returns whether the write succeeded.
 */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
