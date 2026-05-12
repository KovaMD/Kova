import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { isSpellCheckerReady, onSpellCheckerChange, spellCheck } from './spellChecker';

// ── Word extraction ───────────────────────────────────────────────────────────

interface WordRange { from: number; to: number; word: string }

export function extractWords(doc: string): WordRange[] {
  const result: WordRange[] = [];
  const lines = doc.split('\n');
  let pos = 0;
  let inFencedCode = false;
  let inFrontMatter = false;
  let lineIndex = 0;

  for (const line of lines) {
    lineIndex++;
    const len = line.length;

    if (lineIndex === 1 && line === '---') { inFrontMatter = true; pos += len + 1; continue; }
    if (inFrontMatter) { if (line === '---' || line === '...') inFrontMatter = false; pos += len + 1; continue; }
    if (/^(`{3,}|~{3,})/.test(line)) { inFencedCode = !inFencedCode; pos += len + 1; continue; }
    if (inFencedCode) { pos += len + 1; continue; }
    if (/^\s*[%!]/.test(line)) { pos += len + 1; continue; }

    const skip: [number, number][] = [];
    for (const re of [/`[^`]*`/g, /https?:\/\/\S+/g, /\]\([^)]*\)/g, /<[^>]+>/g]) {
      let m;
      while ((m = re.exec(line)) !== null) skip.push([m.index, m.index + m[0].length]);
    }
    skip.sort((a, b) => a[0] - b[0]);

    const wordRe = /[a-zA-Z][a-zA-Z'-]*/g;
    let m;
    outer: while ((m = wordRe.exec(line)) !== null) {
      const rawFrom = m.index;
      let word = m[0];
      while (word.endsWith("'") || word.endsWith('-')) word = word.slice(0, -1);
      if (word.length < 2) continue;

      const rawTo = rawFrom + word.length;
      for (const [sf, st] of skip) {
        if (rawFrom < st && rawTo > sf) continue outer;
      }

      result.push({ from: pos + rawFrom, to: pos + rawTo, word });
    }
    pos += len + 1;
  }
  return result;
}

// ── CodeMirror extension ──────────────────────────────────────────────────────

const setSpellDecorations = StateEffect.define<DecorationSet>();

const spellErrorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects) if (e.is(setSpellDecorations)) return e.value;
    return v;
  },
  provide: f => EditorView.decorations.from(f),
});

const spellErrorMark = Decoration.mark({ class: 'cm-spell-error' });

const spellPlugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;
    cleanup: (() => void) | null = null;

    constructor(private view: EditorView) {
      this.cleanup = onSpellCheckerChange(() => this.schedule());
      this.schedule();
    }

    update(u: ViewUpdate) {
      if (u.docChanged) this.schedule();
    }

    schedule() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(), 350);
    }

    run() {
      if (!isSpellCheckerReady()) return;
      const words = extractWords(this.view.state.doc.toString());
      const ranges: ReturnType<typeof spellErrorMark.range>[] = [];
      for (const { from, to, word } of words) {
        if (!spellCheck(word)) ranges.push(spellErrorMark.range(from, to));
      }
      this.view.dispatch({ effects: setSpellDecorations.of(Decoration.set(ranges, true)) });
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      this.cleanup?.();
    }
  },
);

export function spellCheckExtension(): Extension {
  return [spellErrorField, spellPlugin];
}
