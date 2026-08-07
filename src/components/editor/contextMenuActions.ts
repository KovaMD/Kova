import { invoke } from '@tauri-apps/api/core';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { STEP_MARKER_PATTERN } from '../../engine/parser/stepMarkers';
import { computeNextStep } from '../../engine/parser/markdownToSlides';

export function getWordAtPos(view: EditorView, pos: number): { word: string; from: number; to: number } | null {
  const doc = view.state.doc.toString();
  let from = pos;
  let to = pos;
  while (from > 0 && /[a-zA-Z'-]/.test(doc[from - 1])) from--;
  while (to < doc.length && /[a-zA-Z'-]/.test(doc[to])) to++;
  while (from < to && /['"-]/.test(doc[from])) from++;
  while (to > from && /['"-]/.test(doc[to - 1])) to--;
  if (to - from < 2) return null;
  return { word: doc.slice(from, to), from, to };
}

export function doCopy(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from !== to) navigator.clipboard.writeText(view.state.sliceDoc(from, to));
}

export function doCut(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  navigator.clipboard.writeText(view.state.sliceDoc(from, to));
  view.dispatch({ changes: { from, to, insert: '' } });
  view.focus();
}

export async function doPaste(view: EditorView): Promise<void> {
  // Linux: read the GTK clipboard natively. WebKitGTK rejects both
  // navigator.clipboard.readText() (throws NotAllowedError) and scripted
  // document.execCommand('paste') (silently no-ops) regardless of
  // user-gesture context, so a script-triggered paste needs to bypass the
  // webview's clipboard APIs entirely.
  try {
    const text = await invoke<string>('read_clipboard_text');
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
    });
    view.focus();
    return;
  } catch {
    // Not Linux, or clipboard has no text.
  }
  // mac / Windows: this triggers a real native 'paste' DOM event, handled
  // by the useMediaPaste listener.
  view.focus();
  document.execCommand('paste');
}

export function doInsert(view: EditorView, snippet: string, cursorOffset: number): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: EditorSelection.cursor(from + cursorOffset),
  });
  view.focus();
}

export function insertTable(view: EditorView, rows: number, cols: number): void {
  const headerCells = Array.from({ length: cols }, (_, i) => ` Header ${i + 1} `).join('|');
  const sepCells    = Array(cols).fill(' ------ ').join('|');
  const dataRow     = '|' + Array(cols).fill(' Cell   ').join('|') + '|';
  const dataRows    = Array(rows - 1).fill(dataRow).join('\n');
  doInsert(view, `|${headerCells}|\n|${sepCells}|\n${dataRows}`, 2);
}

// Trailing `<!-- step -->` / `<!-- step: N -->` marker at the end of a line —
// anchored with optional leading whitespace so it can be stripped cleanly.
const TRAILING_STEP_RE = new RegExp(`\\s*${STEP_MARKER_PATTERN}\\s*$`);

// The lines a "reveal on click" toggle should act on: every line touched by
// a real (non-empty) selection, or just the line containing `pos` when
// there's only a bare cursor — a plain right-click with nothing highlighted,
// or the keyboard shortcut fired with no selection.
function affectedStepLines(view: EditorView, pos: number) {
  const sel = view.state.selection.main;
  const from = sel.from !== sel.to ? sel.from : pos;
  const to = sel.from !== sel.to ? sel.to : pos;
  const startLine = view.state.doc.lineAt(from).number;
  const endLine = view.state.doc.lineAt(to).number;
  const lines = [];
  for (let n = startLine; n <= endLine; n++) lines.push(view.state.doc.line(n));
  return lines;
}

export function hasLineStepMarker(view: EditorView, pos: number): boolean {
  return affectedStepLines(view, pos).some((line) => TRAILING_STEP_RE.test(line.text));
}

/** Toggles a `<!-- step -->` marker across every line touched by the current
 *  selection (or just the line containing `pos` when there's no selection).
 *  If any affected line already carries a marker, every marker in range is
 *  stripped. Otherwise every affected line gets one — a lone line gets a
 *  bare auto-incrementing `<!-- step -->`, while a multi-line selection gets
 *  the same explicit number (via computeNextStep) on every line so they
 *  group onto a single click instead of each auto-incrementing separately.
 *  Only covers the trailing-inline form (a paragraph/list-item line); the
 *  own-line-after form used for images/tables/etc. still needs the marker
 *  typed by hand on its own line. */
export function doToggleLineStepMarker(view: EditorView, pos: number): void {
  const lines = affectedStepLines(view, pos);
  const removing = lines.some((line) => TRAILING_STEP_RE.test(line.text));

  if (removing) {
    const changes = lines.flatMap((line) => {
      const m = line.text.match(TRAILING_STEP_RE);
      return m ? [{ from: line.from + m.index!, to: line.to, insert: '' }] : [];
    });
    view.dispatch({ changes });
  } else if (lines.length === 1) {
    view.dispatch({ changes: { from: lines[0].to, insert: ' <!-- step -->' } });
  } else {
    const step = computeNextStep(view.state.doc.toString(), lines[0].number);
    const changes = lines.map((line) => ({ from: line.to, insert: ` <!-- step: ${step} -->` }));
    view.dispatch({ changes });
  }
  view.focus();
}

export function doWrap(view: EditorView, before: string, after: string, placeholder: string): void {
  const { from, to } = view.state.selection.main;
  if (from === to) {
    const insert = `${before}${placeholder}${after}`;
    view.dispatch({
      changes: { from, insert },
      selection: EditorSelection.range(from + before.length, from + before.length + placeholder.length),
    });
  } else {
    const selected = view.state.sliceDoc(from, to);
    const insert = `${before}${selected}${after}`;
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.cursor(from + insert.length),
    });
  }
  view.focus();
}
