// Tracks which app version the user has already been shown a "what's new"
// notice for, independent of user settings — this is app-managed bookkeeping,
// not a preference. Only acted on at startup.

const STORAGE_KEY = 'kova:lastSeenVersion';

export function loadLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLastSeenVersion(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // localStorage unavailable/full — the only cost is re-showing the notice,
    // so fail silently.
  }
}
