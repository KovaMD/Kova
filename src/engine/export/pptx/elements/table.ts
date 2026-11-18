import type { SlideElement } from '../../../types';
import type { Area, ElementRenderContext } from '../context';
import { hex } from '../colour';
import { TABLE_CELL_HMARGIN, TABLE_CELL_VMARGIN, fitTableToArea } from '../fit';
import { stepShapeName } from '../timing';
import { firstFont } from '../fonts';
import { stripHtml } from '../html';
import { CAPTION_H, addCaption } from './image';
/** Renders the table into `area`, auto-fitting font/columns/rows. Returns the
 *  height actually consumed (<= area.h) so the caller can place a caption. */
export function addTable(
  ctx: ElementRenderContext,
  el: Extract<SlideElement, { type: 'table' }>,
  area: Area,
  objectName?: string,
): number {
  const { s, theme: t, warnings } = ctx;
  const tc = ctx.colours.text;
  const colAlign = (i: number): 'left' | 'center' | 'right' =>
    (el.align?.[i] as 'left' | 'center' | 'right' | null | undefined) ?? 'left';

  const cellText = (html: string) => progressBarText(html) ?? stripHtml(html);
  const headerText = el.headers.map(cellText);
  const bodyText = el.rows.map((row) => row.map(cellText));
  const fit = fitTableToArea([headerText, ...bodyText], area);

  if (fit.overflow) {
    const label = headerText.join(' | ').slice(0, 40);
    warnings.push(
      `Table too large for the slide — scaled down to ${fit.fontSize}pt and may still be tight${label ? ` (columns: "${label}")` : ''}`,
    );
  }

  const headerRow = headerText.map((h, i) => ({
    text: h,
    options: {
      bold: true,
      color: hex(t.colors.title_text),
      fill: { color: hex(t.colors.primary) },
      align: colAlign(i),
      fontSize: fit.fontSize,
    },
  }));
  const bodyRows = bodyText.map((row) =>
    row.map((cell, i) => ({ text: cell, options: { color: tc, fontSize: fit.fontSize, align: colAlign(i) } })),
  );

  s.addTable([headerRow, ...bodyRows], {
    x: area.x, y: area.y, w: area.w, h: fit.height,
    colW: fit.colW,
    rowH: fit.rowH,
    fontSize: fit.fontSize,
    fontFace: firstFont(t.fonts.body),
    valign: 'top',
    margin: [TABLE_CELL_VMARGIN, TABLE_CELL_HMARGIN, TABLE_CELL_VMARGIN, TABLE_CELL_HMARGIN],
    border: { color: hex(t.colors.accent), pt: 0.5 },
    ...(objectName ? { objectName } : {}),
  });

  return fit.height;
}

// A `!progress` directive in a table cell is rendered as an HTML bar (see
// progressBar.ts). PptxGenJS table cells can't hold shapes, so the block
// `!progress` path's rect drawing isn't available here — fall back to a text
// meter (label · filled/empty blocks · percent) rather than stripHtml's
// run-together "Done75%".
function progressBarText(cellHtml: string): string | null {
  if (!cellHtml.includes('sl-progress')) return null;
  const div = document.createElement('div');
  div.innerHTML = cellHtml;
  const bar = div.querySelector('.sl-progress');
  if (!bar) return null;
  const label = (bar.querySelector('.sl-progress__label')?.textContent ?? '').trim();
  const pctText = (bar.querySelector('.sl-progress__pct')?.textContent ?? '').trim();
  const pct = Math.max(0, Math.min(100, parseFloat(pctText) || 0));
  const filled = Math.round(pct / 10);
  const meter = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return [label, meter, pctText].filter(Boolean).join('  ');
}
/** A table with its caption in `box` (its allotted share, caption included).
 *  A table is its own dedicated shape (like a lone image), so a step on it
 *  can target the whole shape directly — unlike addTable itself, this was
 *  previously never wired to stepTargets at all, so a stepped table rendered
 *  fully visible regardless of step. */
export function addTableElement(
  ctx: ElementRenderContext, el: Extract<SlideElement, { type: 'table' }>, box: Area,
) {
  const { s, theme: t, steps: stepTargets } = ctx;
  const tableH = box.h;
  const capH = el.caption ? CAPTION_H : 0;
  const tableArea: Area = { x: box.x, y: box.y, w: box.w, h: tableH - capH };
  const objectName = el.step !== undefined ? stepShapeName(tableArea, 'table') : undefined;
  const usedH = addTable(ctx, el, tableArea, objectName);
  if (objectName) stepTargets.push({ step: el.step!, objectName });
  // Anchor the caption just under the fitted table (which is usually
  // shorter than its allotted share) rather than at the bottom of the
  // share, but never past it — images, if any, start at that boundary.
  addCaption(s, el.caption, t, box.x, box.y + Math.min(usedH, tableH - capH), box.w);
}
