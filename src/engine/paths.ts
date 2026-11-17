// Filesystem path helpers shared across the app. Every helper treats both `/`
// and `\` as separators so the same code works for POSIX, Windows drive
// (`C:\...`), UNC (`\\server\share\...`) and mixed-separator paths. They are
// purely lexical: nothing here touches the filesystem or URL schemes.

const SEP = /[/\\]/;

/** Index of the last `/` or `\` in `p`, or -1 if it has none. */
function lastSeparator(p: string): number {
  return Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
}

/** Split a path into its segments on either separator (empty segments kept). */
export function segments(p: string): string[] {
  return p.split(SEP);
}

/** Replace every backslash with a forward slash. */
export function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Final segment of `p`: everything after the last separator. Returns the whole
 * string when there is no separator and '' when `p` ends in a separator.
 */
export function basename(p: string): string {
  return p.slice(lastSeparator(p) + 1);
}

/**
 * Everything before the last separator, with that separator dropped (so a
 * file at the POSIX root gives ''). When `p` has no separator at all the
 * result is `ifNone`, which defaults to ''.
 */
export function dirname(p: string): string;
export function dirname<F>(p: string, ifNone: F): string | F;
export function dirname<F>(p: string, ...ifNone: [] | [F]): string | F {
  const i = lastSeparator(p);
  if (i >= 0) return p.slice(0, i);
  return ifNone.length ? ifNone[0] : '';
}

/** Basename with its last extension removed (`a.tar.gz` gives `a.tar`). */
export function stem(p: string): string {
  return basename(p).replace(/\.[^.]+$/, '');
}

/**
 * True when `ref` is a plain relative path: not rooted at `/` and with no `..`
 * segment. Rust re-validates asset refs; this is only a cheap pre-check.
 */
export function isLocalRelative(ref: string): boolean {
  return !ref.startsWith('/') && !segments(ref).includes('..');
}

// Join a relative image path to the document directory and collapse `.`/`..`
// segments. The Tauri asset protocol needs a normalized filesystem path, not a
// literal `/dir/../img/x.png`, or the image fails to load.
export function normalizePath(docDir: string, rel: string): string {
  const sep = docDir.includes('\\') ? '\\' : '/';
  const out: string[] = [];
  for (const s of `${docDir}${sep}${rel}`.split(/[/\\]+/)) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (out.length && !/^[A-Za-z]:$/.test(out[out.length - 1])) out.pop(); }
    else out.push(s);
  }
  // POSIX paths need their leading slash back; Windows drive letters don't.
  return (/^[A-Za-z]:$/.test(out[0] ?? '') ? '' : sep) + out.join(sep);
}
