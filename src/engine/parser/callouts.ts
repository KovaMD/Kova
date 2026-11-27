// Obsidian/GitHub-style callout marker metadata and resolution, shared by the
// slide parser and CodeMirror editor autocomplete so offered markers and aliases
// stay in sync with what the parser actually recognises.

export type CalloutStyle = 'note' | 'info' | 'tip' | 'warning' | 'danger';

export const CALLOUT_CANONICAL_STYLES: readonly CalloutStyle[] = [
  'note',
  'info',
  'tip',
  'warning',
  'danger',
];

export const CALLOUT_STYLES = new Set<string>(CALLOUT_CANONICAL_STYLES);

export const CALLOUT_ALIASES: Record<string, CalloutStyle> = {
  hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip',
  caution: 'warning', attention: 'warning',
  error: 'danger', failure: 'danger', fail: 'danger', bug: 'danger', missing: 'danger',
  question: 'info', help: 'info', faq: 'info',
  abstract: 'note', summary: 'note', tldr: 'note', quote: 'note', cite: 'note', example: 'note',
};

export const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)\s*(.*)$/;

/** Maps a raw callout marker name (case-insensitively) to one of the five canonical styles. */
export function resolveCalloutStyle(rawType: string): CalloutStyle {
  const key = rawType.toLowerCase();
  return CALLOUT_STYLES.has(key) ? (key as CalloutStyle) : (CALLOUT_ALIASES[key] ?? 'note');
}
