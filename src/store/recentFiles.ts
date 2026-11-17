// Most-recently-opened file paths, newest first. Feeds the File ▸ Open Recent
// submenu (macOS native menu + Windows/Linux in-window menu). App-managed
// state, not a user preference.

import { readJson, writeJson } from './storage';
import { basename, segments } from '../engine/paths';

const KEY = 'kova:recentFiles';
const MAX = 10;
const WIN_EXTENDED_PREFIX = '\\\\?\\';

// Strip the Windows `\\?\` extended-length prefix that Rust's
// std::fs::canonicalize adds (see src-tauri/src/commands/window.rs for the
// same fix applied there) — without this, a file opened once via the CLI
// (--present/--check canonicalise their path) and once via the GUI's Open
// dialog dedupe as two different entries for the same file (issue #185).
function normalizePath(path: string): string {
  return path.startsWith(WIN_EXTENDED_PREFIX) ? path.slice(WIN_EXTENDED_PREFIX.length) : path;
}

export function loadRecentFiles(): string[] {
  const parsed = readJson<unknown[]>(KEY, [], Array.isArray);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of parsed) {
    if (typeof p !== 'string') continue;
    const norm = normalizePath(p);
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
    if (result.length >= MAX) break;
  }
  return result;
}

// Prepend `path` (deduped), cap at MAX, persist, return the new list.
export function addRecentFile(path: string): string[] {
  const norm = normalizePath(path);
  const next = [norm, ...loadRecentFiles().filter((p) => p !== norm)].slice(0, MAX);
  writeJson(KEY, next); // full/unavailable — recents are a convenience
  return next;
}

export function removeRecentFile(path: string): string[] {
  const norm = normalizePath(path);
  const next = loadRecentFiles().filter((p) => p !== norm);
  writeJson(KEY, next);
  return next;
}

export function clearRecentFiles(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function recentFileBasename(path: string): string {
  return basename(path) || path;
}

/** Menu label; parent folder suffix when basename collisions exist in the list. */
export function recentFileMenuLabel(path: string, recents: string[]): string {
  const base = recentFileBasename(path);
  if (recents.filter((p) => recentFileBasename(p) === base).length <= 1) return base;
  const parts = segments(path);
  const parent = parts.length >= 2 ? parts[parts.length - 2] : '';
  return parent ? `${base} (${parent})` : base;
}
