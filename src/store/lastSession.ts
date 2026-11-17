// Tracks the most recently open file and slide position, independent of user
// settings — this is app-managed session state, not a preference. Only acted
// on at startup, and only when settings.startupBehavior is 'reopenLast'.

import { readJson, writeJson } from './storage';

export interface LastSession {
  path: string;
  slideIndex: number;
}

const STORAGE_KEY = 'kova:lastSession';

function isLastSession(value: unknown): value is LastSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<LastSession>;
  return typeof v.path === 'string' && typeof v.slideIndex === 'number';
}

export function loadLastSession(): LastSession | null {
  const parsed = readJson<LastSession | null>(STORAGE_KEY, null, isLastSession);
  return parsed ? { path: parsed.path, slideIndex: parsed.slideIndex } : null;
}

// localStorage unavailable/full — last-session restore is a convenience, not a
// correctness requirement, so both branches fail silently.
export function saveLastSession(session: LastSession | null): void {
  if (session) {
    writeJson(STORAGE_KEY, session);
    return;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
