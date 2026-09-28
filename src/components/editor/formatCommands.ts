import { EditorSelection, type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// ── Star-group helpers (for bold/italic which share the * character) ────────

type StarGroup = { openAt: number; closeAt: number; openCount: number; closeCount: number };

/**
 * Collect all runs of consecutive `*` chars in `text`, pair them left-to-right
 * (1st with 2nd, 3rd with 4th, …), and return the pair whose range contains `pos`.
 */
function findStarGroup(text: string, pos: number): StarGroup | null {
  const groups: { start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '*') {
      const s = i;
      while (i < text.length && text[i] === '*') i++;
      groups.push({ start: s, end: i });
    } else {
      i++;
    }
  }
  for (let k = 0; k + 1 < groups.length; k += 2) {
    const open = groups[k], close = groups[k + 1];
    if (open.start <= pos && pos < close.end) {
      return { openAt: open.start, closeAt: close.start, openCount: open.end - open.start, closeCount: close.end - close.start };
    }
  }
  return null;
}

// ── Adjacent-star counter (for selection-based bold/italic toggle) ───────────

// Returns true when text is wrapped by `before`…`after`, disambiguating * vs **.
function lineIsWrapped(text: string, before: string, after: string): boolean {
  if (text.length <= before.length + after.length) return false;
  if (!text.startsWith(before) || !text.endsWith(after)) return false;
  if (before === '*') {
    if (text[1] === '*' || text[text.length - 2] === '*') return false;
  }
  return true;
}

function countStarsAround(state: EditorState, from: number, to: number): [number, number] {
  let n = 0;
  while (from - n > 0 && state.sliceDoc(from - n - 1, from - n) === '*') n++;
  let m = 0;
  while (to + m < state.doc.length && state.sliceDoc(to + m, to + m + 1) === '*') m++;
  return [n, m];
}

// ── Non-star enclosing pair finder (~~, <u>, `) ──────────────────────────────

function findEnclosingMarkerPair(
  text: string,
  pos: number,
  before: string,
  after: string,
): [number, number] | null {
  const bLen = before.length;
  const aLen = after.length;

  if (before === after) {
    const positions: number[] = [];
    let i = 0;
    while (i <= text.length - bLen) {
      if (text.startsWith(before, i)) { positions.push(i); i += bLen; }
      else i++;
    }
    for (let k = 0; k + 1 < positions.length; k += 2) {
      const open = positions[k], close = positions[k + 1];
      if (open <= pos && pos < close + aLen) return [open, close];
    }
    return null;
  }

  // Asymmetric (e.g. <u>...</u>)
  let openIdx = -1, i = 0;
  while (i + bLen <= text.length) {
    if (text.startsWith(before, i) && i <= pos) { openIdx = i; i += bLen; }
    else i++;
  }
  if (openIdx === -1) return null;
  let closeIdx = -1;
  i = openIdx + bLen;
  while (i + aLen <= text.length) {
    if (text.startsWith(after, i)) { closeIdx = i; break; }
    i++;
  }
  return closeIdx === -1 ? null : [openIdx, closeIdx];
}

// Cursor-move command between slide starts: the body start, then the line after
// each standalone `---` (frontmatter skipped). `pick(i, n)` maps the current
// slide index to the target; out-of-range falls through (returns false).
export function slideNav(pick: (i: number, n: number) => number) {
  return (view: EditorView): boolean => {
    const doc = view.state.doc.toString();
    const fm = doc.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    const start = fm ? fm[0].length : 0;
    const starts = [start];
    const body = doc.slice(start);
    for (let m, sep = /^---$/gm; (m = sep.exec(body)); ) {
      const a = start + m.index + m[0].length;
      starts.push(a + (doc[a] === '\r' ? 2 : doc[a] === '\n' ? 1 : 0));
    }
    let i = 0;
    const cur = view.state.selection.main.head;
    while (i + 1 < starts.length && starts[i + 1] <= cur) i++;
    const target = starts[pick(i, starts.length)];
    if (target === undefined) return false;
    view.dispatch({ selection: EditorSelection.cursor(target), effects: EditorView.scrollIntoView(target, { y: 'start' }) });
    return true;
  };
}

// ── Main wrap/toggle command factory ─────────────────────────────────────────

export function makeWrapCommand(before: string, after: string, placeholder: string) {
  const bLen = before.length;
  const aLen = after.length;
  const isStarMarker = /^\*+$/.test(before) && /^\*+$/.test(after);

  return (view: EditorView): boolean => {
    const { state } = view;
    const { from, to } = state.selection.main;

    // ── Selection present ───────────────────────────────────────────────────
    if (from !== to) {
      // ── Multi-line: apply markers per line ─────────────────────────────
      const startLine = state.doc.lineAt(from);
      const rawEnd    = state.doc.lineAt(to);
      // If selection ends exactly at a line boundary, don't include that line
      const endLineNum = (to === rawEnd.from && rawEnd.number > startLine.number)
        ? rawEnd.number - 1
        : rawEnd.number;

      if (startLine.number !== endLineNum) {
        const lines: Array<{ from: number; to: number; text: string }> = [];
        for (let n = startLine.number; n <= endLineNum; n++) {
          const l = state.doc.line(n);
          lines.push({ from: l.from, to: l.to, text: l.text });
        }

        const contentLines = lines.filter(l => l.text.trim() !== '');
        const allWrapped   = contentLines.length > 0
          && contentLines.every(l => lineIsWrapped(l.text, before, after));

        const changes: Array<{ from: number; to: number; insert: string }> = [];
        if (allWrapped) {
          for (const l of contentLines) {
            changes.push({ from: l.from,           to: l.from + bLen, insert: '' });
            changes.push({ from: l.to   - aLen,    to: l.to,          insert: '' });
          }
        } else {
          for (const l of contentLines) {
            if (!lineIsWrapped(l.text, before, after)) {
              changes.push({ from: l.from, to: l.from, insert: before });
              changes.push({ from: l.to,   to: l.to,   insert: after  });
            }
          }
        }

        if (changes.length > 0) view.dispatch({ changes });
        view.focus();
        return true;
      }

      if (isStarMarker) {
        const [sBefore, sAfter] = countStarsAround(state, from, to);
        const min  = Math.min(sBefore, sAfter);
        const isOn = bLen === 1 ? min % 2 === 1 : min >= bLen;

        if (isOn) {
          view.dispatch({
            changes: [
              { from: from - bLen, to: from,          insert: '' },
              { from: to,          to: to + bLen,     insert: '' },
            ],
            selection: EditorSelection.range(from - bLen, to - bLen),
          });
        } else {
          const selText = state.sliceDoc(from, to);
          if (lineIsWrapped(selText, before, before)) {
            // Selection is already wrapped in this marker — toggle off
            view.dispatch({
              changes: [
                { from,            to: from + bLen, insert: '' },
                { from: to - aLen, to,              insert: '' },
              ],
              selection: EditorSelection.range(from, to - bLen - aLen),
            });
          } else {
            // Wrap entire selection (makes the whole line bold/italic)
            view.dispatch({
              changes: [
                { from, to: from, insert: before },
                { from: to, to,   insert: after },
              ],
              selection: EditorSelection.range(from + bLen, to + bLen),
            });
          }
        }
      } else {
        // Exact-match toggle for ~~, <u>, `
        const outerBefore = from >= bLen ? state.sliceDoc(from - bLen, from) : '';
        const outerAfter  = to + aLen <= state.doc.length ? state.sliceDoc(to, to + aLen) : '';
        if (outerBefore === before && outerAfter === after) {
          view.dispatch({
            changes: [
              { from: from - bLen, to: from, insert: '' },
              { from: to, to: to + aLen, insert: '' },
            ],
            selection: EditorSelection.range(from - bLen, to - bLen),
          });
        } else {
          view.dispatch({
            changes: [
              { from, to: from, insert: before },
              { from: to, to, insert: after },
            ],
            selection: EditorSelection.range(from + bLen, to + bLen),
          });
        }
      }
      view.focus();
      return true;
    }

    // ── No selection ────────────────────────────────────────────────────────
    const line = state.doc.lineAt(from);
    const rel  = from - line.from;

    if (isStarMarker) {
      const group = findStarGroup(line.text, rel);
      if (group) {
        const min  = Math.min(group.openCount, group.closeCount);
        const isOn = bLen === 1 ? min % 2 === 1 : min >= bLen;
        const absOpen  = line.from + group.openAt;
        const absClose = line.from + group.closeAt;
        if (isOn) {
          // Remove bLen stars from the front of each group
          view.dispatch({
            changes: [
              { from: absOpen,  to: absOpen + bLen,  insert: '' },
              { from: absClose, to: absClose + bLen, insert: '' },
            ],
            selection: EditorSelection.cursor(Math.max(absOpen, from - bLen)),
          });
        } else {
          // Extend existing group by inserting at the front of each
          view.dispatch({
            changes: [
              { from: absOpen,  to: absOpen,  insert: before },
              { from: absClose, to: absClose, insert: after },
            ],
            selection: EditorSelection.cursor(from + bLen),
          });
        }
        view.focus();
        return true;
      }
    } else {
      const pair = findEnclosingMarkerPair(line.text, rel, before, after);
      if (pair) {
        const absOpen = line.from + pair[0], absClose = line.from + pair[1];
        view.dispatch({
          changes: [
            { from: absOpen,  to: absOpen + bLen,  insert: '' },
            { from: absClose, to: absClose + aLen, insert: '' },
          ],
          selection: EditorSelection.cursor(Math.max(absOpen, from - bLen)),
        });
        view.focus();
        return true;
      }
    }

    // Nothing found — insert placeholder and select it
    const insert = `${before}${placeholder}${after}`;
    view.dispatch({
      changes: { from, insert },
      selection: EditorSelection.range(from + bLen, from + bLen + placeholder.length),
    });
    view.focus();
    return true;
  };
}

export function makeHeadingCommand(level: number) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from } = state.selection.main;
    const line = state.doc.lineAt(from);
    const existing = line.text.match(/^(#{1,6}) /);
    const prefix = '#'.repeat(level) + ' ';

    let change: { from: number; to: number; insert: string };
    let cursorDelta: number;

    if (existing) {
      const oldPrefix = existing[0];
      if (existing[1].length === level) {
        // Same level — toggle off
        change = { from: line.from, to: line.from + oldPrefix.length, insert: '' };
        cursorDelta = -oldPrefix.length;
      } else {
        // Different level — replace
        change = { from: line.from, to: line.from + oldPrefix.length, insert: prefix };
        cursorDelta = prefix.length - oldPrefix.length;
      }
    } else {
      // No heading — insert
      change = { from: line.from, to: line.from, insert: prefix };
      cursorDelta = prefix.length;
    }

    view.dispatch({
      changes: change,
      selection: EditorSelection.cursor(Math.max(line.from, from + cursorDelta)),
    });
    return true;
  };
}

const LIST_PREFIX_RE = /^(\d+\.\s+|- )/;

export function makeLinePrefixCommand(prefix: string) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from, to } = state.selection.main;
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);

    const lines = [];
    for (let n = startLine.number; n <= endLine.number; n++) lines.push(state.doc.line(n));

    // Toggle off only when every selected line already has this exact prefix.
    const allHavePrefix = lines.every((line) => line.text.startsWith(prefix));

    const changes = lines.map((line) => {
      if (allHavePrefix) {
        return { from: line.from, to: line.from + prefix.length, insert: '' };
      }
      const existing = line.text.match(LIST_PREFIX_RE);
      const removeLen = existing ? existing[0].length : 0;
      return { from: line.from, to: line.from + removeLen, insert: prefix };
    });

    const changeSet = state.changes(changes);
    view.dispatch({
      changes,
      selection: EditorSelection.range(changeSet.mapPos(from, 1), changeSet.mapPos(to, 1)),
    });
    view.focus();
    return true;
  };
}

const UL_PREFIX_RE = /^- /;
const OL_PREFIX_RE = /^\d+\.\s+/;

/**
 * UL/OL button handler. Differs from makeLinePrefixCommand in two ways OL needs:
 * numbers are sequential rather than a fixed string, and — so a second click after
 * appending plain lines to an existing list doesn't disturb it — a selection mixing
 * already-listed lines with bare ones only adds markers to the bare lines.
 */
export function makeListCommand(kind: 'ul' | 'ol') {
  const ownRe = kind === 'ul' ? UL_PREFIX_RE : OL_PREFIX_RE;
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from, to } = state.selection.main;
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);

    const lines = [];
    for (let n = startLine.number; n <= endLine.number; n++) lines.push(state.doc.line(n));

    const allHaveOwn = lines.every((line) => ownRe.test(line.text));
    const allHaveAny = lines.every((line) => LIST_PREFIX_RE.test(line.text));
    const noneHaveAny = lines.every((line) => !LIST_PREFIX_RE.test(line.text));

    const changes: { from: number; to: number; insert: string }[] = [];

    if (allHaveOwn) {
      // Toggle off — every selected line is already this exact list type.
      for (const line of lines) {
        const removeLen = line.text.match(ownRe)![0].length;
        changes.push({ from: line.from, to: line.from + removeLen, insert: '' });
      }
    } else if (allHaveAny || noneHaveAny) {
      // Uniform selection (either all bare, or all marked with some other list
      // type) — rewrite every line as this list type, numbering OL sequentially.
      let n = 1;
      for (const line of lines) {
        const existing = line.text.match(LIST_PREFIX_RE);
        const removeLen = existing ? existing[0].length : 0;
        const insert = kind === 'ul' ? '- ' : `${n}. `;
        changes.push({ from: line.from, to: line.from + removeLen, insert });
        n++;
      }
    } else {
      // Mixed selection — leave already-listed lines untouched and only add
      // markers to bare ones, numbering OL to continue the existing sequence.
      let n = 1;
      for (const line of lines) {
        if (LIST_PREFIX_RE.test(line.text)) { n++; continue; }
        const insert = kind === 'ul' ? '- ' : `${n}. `;
        changes.push({ from: line.from, to: line.from, insert });
        n++;
      }
    }

    if (changes.length === 0) { view.focus(); return true; }

    const changeSet = state.changes(changes);
    view.dispatch({
      changes,
      selection: EditorSelection.range(changeSet.mapPos(from, 1), changeSet.mapPos(to, 1)),
    });
    view.focus();
    return true;
  };
}

// ── Type-to-wrap for markdown emphasis markers ───────────────────────────────

const WRAP_ON_TYPE_CHARS = new Set(['*', '_', '`']);

/**
 * Typing `*`, `_`, or `` ` `` over a selection wraps it in that marker instead
 * of replacing it — the same gesture Typora and CodeMirror's own bracket/quote
 * auto-close use, just extended to markdown emphasis. Deliberately not
 * toggle-aware like `makeWrapCommand`: the inner text stays selected after
 * wrapping, so typing the same character again nests another marker around
 * it (`*` twice over a selection yields `**text**`) rather than reasoning
 * about what's "already on" — simpler and matches literal repeated keystrokes.
 *
 * Exported separately from the `wrapOnType` extension so tests can call it
 * directly rather than reach into CodeMirror's internal facet-value storage.
 */
export function handleWrapOnType(view: EditorView, from: number, to: number, insert: string): boolean {
  if (view.composing || view.state.readOnly) return false;
  if (!WRAP_ON_TYPE_CHARS.has(insert)) return false;
  const sel = view.state.selection.main;
  if (sel.empty || from !== sel.from || to !== sel.to) return false;

  view.dispatch({
    changes: [
      { from: sel.from, to: sel.from, insert },
      { from: sel.to, to: sel.to, insert },
    ],
    selection: EditorSelection.range(sel.from + insert.length, sel.to + insert.length),
    userEvent: 'input.type',
  });
  return true;
}

export const wrapOnType = EditorView.inputHandler.of(handleWrapOnType);

export function findNextRange(doc: string, query: string, start: number, dir: 1 | -1 = 1): { from: number; to: number } | null {
  const q = query.trim();
  if (!q) return null;

  const hay = doc.toLowerCase();
  const needle = q.toLowerCase();

  const boundedStart = Math.max(0, Math.min(start, hay.length));
  let idx: number;
  if (dir === 1) {
    idx = hay.indexOf(needle, boundedStart);
  } else {
    idx = boundedStart === 0 ? -1 : hay.lastIndexOf(needle, Math.min(hay.length - 1, boundedStart - 1));
  }

  // Wrap.
  if (idx === -1) {
    idx = dir === 1 ? hay.indexOf(needle, 0) : hay.lastIndexOf(needle);
  }
  if (idx === -1) return null;

  return { from: idx, to: idx + needle.length };
}

/** Every non-overlapping case-insensitive occurrence of `query` in `doc`, in order. */
export function findAllRanges(doc: string, query: string): { from: number; to: number }[] {
  const q = query.trim();
  if (!q) return [];

  const hay = doc.toLowerCase();
  const needle = q.toLowerCase();

  const ranges: { from: number; to: number }[] = [];
  let idx = 0;
  while ((idx = hay.indexOf(needle, idx)) !== -1) {
    ranges.push({ from: idx, to: idx + needle.length });
    idx += needle.length;
  }
  return ranges;
}

// ── Find/replace commands ─────────────────────────────────────────────────

/** Selects the next occurrence of `query` from the current selection, wrapping around. */
export function goToNextMatch(view: EditorView, query: string, dir: 1 | -1 = 1): boolean {
  const doc = view.state.doc.toString();
  const sel = view.state.selection.main;
  const start = dir === 1 ? sel.to : sel.from;

  const range = findNextRange(doc, query, start, dir);
  if (!range) return false;

  const { from, to } = range;
  view.dispatch({
    selection: EditorSelection.range(from, to),
    effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 12 }),
  });
  view.focus();
  return true;
}

/**
 * Replaces the current selection if it's itself a live match for `query`,
 * then advances to the next occurrence either way — matching how most
 * editors' "Replace" button behaves (plain Find when nothing matches yet).
 */
export function replaceCurrent(view: EditorView, query: string, replacement: string): void {
  if (!query.trim()) return;
  const sel = view.state.selection.main;
  const selText = view.state.sliceDoc(sel.from, sel.to);
  if (!sel.empty && selText.toLowerCase() === query.trim().toLowerCase()) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: replacement },
      selection: EditorSelection.cursor(sel.from + replacement.length),
    });
  }
  goToNextMatch(view, query, 1);
}

/** Replaces every occurrence of `query` in the document; returns the count replaced. */
export function replaceAll(view: EditorView, query: string, replacement: string): number {
  const ranges = findAllRanges(view.state.doc.toString(), query);
  if (ranges.length === 0) return 0;
  view.dispatch({ changes: ranges.map((r) => ({ from: r.from, to: r.to, insert: replacement })) });
  view.focus();
  return ranges.length;
}
