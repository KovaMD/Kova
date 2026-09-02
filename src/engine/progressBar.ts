// One source of truth for progress-bar markup. Two call sites render it: the
// block `!progress` element (the React <ProgressBar> in elements.tsx) and a
// `!progress` directive inside a table cell (an HTML string the parser emits
// in markdownToSlides.ts). Keeping the inner markup here stops the two drifting
// — the PPTX exporter reverse-engineers a table cell by looking for these exact
// class names (see progressBarText in exportPptx.ts).

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
