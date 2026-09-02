// One source of truth for the `!progress[label](…)` directive: its grammar
// (parseProgressDirective) and its markup (progressBarInnerHtml). The directive
// is recognised in three places — a standalone block element and a plain table
// cell (markdownToSlides.ts), and a computed `!sheet` cell (sheet.ts) — which
// previously each carried their own near-identical regex. The markup is shared
// by the block <ProgressBar> (elements.tsx) and the table-cell HTML string, and
// the PPTX exporter reverse-engineers a cell by these exact class names (see
// progressBarText in exportPptx.ts).

const DIRECTIVE_RE = /^!progress\[([^\]]*)\]\((.+)\)$/;
// Looser: any non-empty `(…)`, matching a malformed directive too. `!sheet`
// footer detection uses this to tell "the author meant a progress bar here"
// from "the author meant a `!`-prefixed footer label".
const DIRECTIVE_SHAPE_RE = /^!progress\[[^\]]*\]\(.+\)$/;

/** A `!progress` directive's payload: a literal percentage, or a sheet formula
 *  (the leading `=` stripped). */
export type ProgressDirective =
  | { label: string; value: number }
  | { label: string; formula: string };

/** Parse a `!progress[label](…)` directive, or null if `text` isn't one. The
 *  inner value is either a bare number (`75`, `75.5`) or a `=`-prefixed sheet
 *  formula; anything else is not a recognised directive. */
export function parseProgressDirective(text: string): ProgressDirective | null {
  const m = text.trim().match(DIRECTIVE_RE);
  if (!m) return null;
  const [, label, inner] = m;
  if (/^\d+(?:\.\d+)?$/.test(inner)) return { label, value: parseFloat(inner) };
  const formula = /^\s*=(.+)$/.exec(inner);
  return formula ? { label, formula: formula[1] } : null;
}

/** Whether `text` has the shape of a `!progress[…](…)` directive, well-formed
 *  or not — see DIRECTIVE_SHAPE_RE. */
export function looksLikeProgressDirective(text: string): boolean {
  return DIRECTIVE_SHAPE_RE.test(text.trim());
}

/** Clamp a raw progress value to the displayable 0–100 range. */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Inner markup of a progress bar — the header row (label + percent) and the
 * track/fill — without the outer `.sl-progress` element. Each call site adds
 * that wrapper itself, plus any variant class (`.sl-progress--table`).
 */
export function progressBarInnerHtml(label: string, value: number): string {
  const pct = clampPercent(value);
  return (
    '<div class="sl-progress__header">' +
    `<span class="sl-progress__label">${esc(label)}</span>` +
    `<span class="sl-progress__pct">${pct}%</span>` +
    '</div>' +
    '<div class="sl-progress__track">' +
    `<div class="sl-progress__fill" style="width: ${pct}%"></div>` +
    '</div>'
  );
}
