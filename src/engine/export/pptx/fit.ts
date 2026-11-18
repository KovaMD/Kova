// Text and table fitting for the PPTX export: pure measurement helpers that
// estimate wrapped heights and shrink font sizes so content fits its area.
import type { Area } from './context';
import type { PptxTextRun } from './pptxTypes';

// ── Table auto-fit ───────────────────────────────────────────────────────────
//
// PptxGenJS with autoPage:false (the mode we use — one slide in, one slide out)
// does no wrapping maths of its own: it emits `<a:tr h="{h / rowCount}">` and
// leaves the layout to PowerPoint. But `a:tr/@h` is a *minimum* — PowerPoint
// grows every row to fit its text and never shrinks the font — so a dense table
// handed a small area runs straight off the bottom of the slide, and the
// equal-width columns pptxgenjs assigns by default make a long-text column wrap
// into tall, lopsided rows. The live preview sidesteps all this by measuring
// the DOM and zoom-scaling the pane to fit (OverflowPane in layouts.tsx). With
// no DOM at export time we approximate the same outcome: estimate the wrapped
// height, step the font size down until it fits, and hand PowerPoint explicit
// content-weighted column widths and per-row heights so it renders close to
// what we computed.

const TABLE_MAX_FONT = 14;
const TABLE_MIN_FONT = 7;
// Inches of row height per text line, per point of font size. PowerPoint renders
// table cells at roughly font-size x 1.2 line spacing; the estimate is biased a
// little high so it errs towards shrinking a touch too much (a slightly smaller
// table) rather than too little (overflow — the bug this fixes).
const TABLE_LINE_FACTOR = 1.3 / 72;
export const TABLE_CELL_VMARGIN = 0.04; // in; top and bottom each (pptx "narrow" cell margin)
export const TABLE_CELL_HMARGIN = 0.06; // in; left and right each
// Average glyph advance as a fraction of the em — 0.5 is the usual rule of
// thumb for proportional body text and matches the character-per-line constant
// pptxgenjs itself assumes for auto-paging.
const TABLE_CHAR_EM = 0.5;

export interface TableFit {
  fontSize: number;
  colW: number[];
  rowH: number[];
  height: number;
  overflow: boolean;
}

// `matrix` is the plain-text grid (header row first). Returns the largest font
// size in [TABLE_MIN_FONT, TABLE_MAX_FONT] whose estimated table height fits
// `area.h`, plus the column/row geometry to emit for it. `overflow` is true when
// even the minimum font can't fit — the row heights are then squeezed so the
// graphic frame still lands on the slide (PowerPoint may nudge them back up a
// hair, but a tight table beats one hanging off the edge).
export function fitTableToArea(matrix: string[][], area: Area): TableFit {
  const availH = Math.max(0.5, area.h);
  const availW = Math.max(1, area.w);
  const nCols = Math.max(1, ...matrix.map((r) => r.length));

  // Column widths, weighted by each column's longest cell. Clamp every column's
  // desired width into [8%, 50%] of the total before normalising, so no column
  // is starved to an unreadable thread and none swallows the whole table.
  const em = (fs: number) => (fs * TABLE_CHAR_EM) / 72;
  const clampLo = availW * 0.08;
  const clampHi = availW * 0.5;
  const desired: number[] = [];
  for (let c = 0; c < nCols; c++) {
    let maxLen = 1;
    for (const row of matrix) maxLen = Math.max(maxLen, (row[c] ?? '').length);
    desired.push(Math.min(clampHi, Math.max(clampLo, maxLen * em(TABLE_MAX_FONT))));
  }
  const desiredSum = desired.reduce((a, b) => a + b, 0);
  const colW = desired.map((d) => (d / desiredSum) * availW);

  const linesFor = (text: string, colWidth: number, fs: number): number => {
    const usable = Math.max(0.2, colWidth - TABLE_CELL_HMARGIN * 2);
    const cpl = Math.max(1, Math.floor(usable / em(fs)));
    return (text || ' ')
      .split('\n')
      .reduce((sum, seg) => sum + Math.max(1, Math.ceil(seg.trim().length / cpl)), 0);
  };
  const rowHeightsFor = (fs: number): number[] =>
    matrix.map((row) => {
      let maxLines = 1;
      for (let c = 0; c < nCols; c++) {
        maxLines = Math.max(maxLines, linesFor(row[c] ?? '', colW[c], fs));
      }
      return maxLines * fs * TABLE_LINE_FACTOR + TABLE_CELL_VMARGIN * 2;
    });

  let fontSize = TABLE_MAX_FONT;
  let rowH = rowHeightsFor(fontSize);
  let total = rowH.reduce((a, b) => a + b, 0);
  while (total > availH && fontSize > TABLE_MIN_FONT) {
    fontSize -= 1;
    rowH = rowHeightsFor(fontSize);
    total = rowH.reduce((a, b) => a + b, 0);
  }

  let overflow = false;
  if (total > availH) {
    const squeeze = availH / total;
    rowH = rowH.map((h) => h * squeeze);
    total = availH;
    overflow = true;
  }

  return { fontSize, colW, rowH, height: total, overflow };
}

// ── Body text auto-fit ───────────────────────────────────────────────────────
//
// Same problem as tables, for the main text box: runs go out at fixed sizes
// (18pt body, 16pt sub-bullets, ...) and shrinkText only sets PowerPoint's
// "Shrink text on overflow" flag, which PowerPoint applies on first edit, not
// on open — so a dense slide (e.g. three ||| columns of 15 bullets, issue
// #272) opens with its text running off the bottom. Estimate the wrapped
// height with the table fitter's constants and scale every run down together
// until it fits, so the deck opens right in PowerPoint, Keynote and Google
// Slides alike.

const TEXT_MIN_SCALE = 0.5;
const TEXT_SCALE_STEP = 0.05;
const TEXT_BOX_HINSET = 0.1;  // in; OOXML default lIns/rIns
const TEXT_BOX_VINSET = 0.05; // in; OOXML default tIns/bIns
const BULLET_INDENT = 0.375;  // in; pptxgenjs' default 27pt bullet indent, per level

/** Estimated rendered height (in) of `runs` in a box `w` wide at `scale`. A run
 *  carrying `bullet` starts a paragraph; `breakLine` ends one. */
export function estimateRunsHeight(runs: PptxTextRun[], w: number, scale: number): number {
  let total = TEXT_BOX_VINSET * 2;
  let chars = 0, fs = 0, spaceAfter = 0, indent = 0, lines = 0;
  let open = false;
  const em = (f: number) => (f * TABLE_CHAR_EM) / 72;
  const close = () => {
    if (!open) return;
    const usable = Math.max(0.2, w - TEXT_BOX_HINSET * 2 - indent);
    const cpl = Math.max(1, Math.floor(usable / em(fs)));
    lines += Math.max(1, Math.ceil(chars / cpl));
    total += lines * fs * TABLE_LINE_FACTOR + spaceAfter / 72;
    chars = 0; fs = 0; spaceAfter = 0; indent = 0; lines = 0;
    open = false;
  };
  for (const run of runs) {
    const o = run.options ?? {};
    if (o.bullet) close();
    const runFs = ((o.fontSize as number | undefined) ?? 18) * scale;
    if (!open) {
      open = true;
      // `bullet: { indent }` (pt) overrides the default per-level indent.
      const customIndent = (o.bullet as { indent?: number } | undefined)?.indent;
      const bulletIndent = customIndent ? customIndent / 72 : BULLET_INDENT;
      indent = o.bullet ? bulletIndent * (1 + ((o.indentLevel as number | undefined) ?? 0)) : 0;
    }
    fs = Math.max(fs, runFs);
    spaceAfter = Math.max(spaceAfter, ((o.paraSpaceAfter as number | undefined) ?? 0) * scale);
    // An embedded newline (code/math fallbacks) is a hard line break: count
    // the wrapped lines of every segment before the last, carry the last on.
    const segs = run.text.split('\n');
    for (let i = 0; i < segs.length - 1; i++) {
      const cpl = Math.max(1, Math.floor(Math.max(0.2, w - TEXT_BOX_HINSET * 2 - indent) / em(fs)));
      lines += Math.max(1, Math.ceil((chars + segs[i].length) / cpl));
      chars = 0;
    }
    chars += segs[segs.length - 1].length;
    if (o.breakLine) close();
  }
  close();
  return total;
}

/** Largest scale in [TEXT_MIN_SCALE, 1] at which `runs` fit `area`. */
export function fitRunsScale(runs: PptxTextRun[], area: Area): { scale: number; overflow: boolean } {
  let scale = 1;
  while (scale > TEXT_MIN_SCALE && estimateRunsHeight(runs, area.w, scale) > area.h) {
    scale = Math.max(TEXT_MIN_SCALE, scale - TEXT_SCALE_STEP);
  }
  return { scale, overflow: estimateRunsHeight(runs, area.w, scale) > area.h };
}

export function scaleRuns(runs: PptxTextRun[], scale: number): PptxTextRun[] {
  if (scale === 1) return runs;
  const half = (n: number) => Math.max(1, Math.round(n * scale * 2) / 2);
  return runs.map((run) => {
    const o = run.options ?? {};
    return {
      text: run.text,
      options: {
        ...o,
        fontSize: half((o.fontSize as number | undefined) ?? 18),
        ...(typeof o.paraSpaceAfter === 'number' ? { paraSpaceAfter: half(o.paraSpaceAfter) } : {}),
      },
    };
  });
}
