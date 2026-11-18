// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '..';
import { fitTableToArea } from '../fit';
import { DEFAULT_THEME } from '../../../theme';
import type { Slide, SlideElement } from '../../../types';

// The live preview scales an overflowing table down to fit (OverflowPane's
// zoom-to-fit). PptxGenJS in autoPage:false mode does no such thing — it emits
// `<a:tr h="{h/rows}">` (a *minimum* PowerPoint then grows to fit the text) with
// equal-width columns, so a dense table used to run straight off the slide and
// wrap into lopsided rows. addTable now estimates the wrapped height and steps
// the font size down until the table fits its area. See fitTableToArea().

const EMU_PER_INCH = 914400;
const SLIDE_H_16x9 = 5.625;

function makeSlide(elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: 'Results', titleLevel: 2,
    elements, speakerNotes: '', references: [], layout: 'title-content', hidden: false,
  };
}

async function slideXml(slide: Slide): Promise<{ xml: string; warnings: string[] }> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return { xml, warnings: res.warnings };
}

/** Isolate the `<a:tbl>…</a:tbl>` fragment so assertions can't pick up a
 *  header/footer/caption run elsewhere on the slide. */
function tableXml(xml: string): string {
  const m = xml.match(/<a:tbl>[\s\S]*<\/a:tbl>/);
  if (!m) throw new Error('no table in slide XML');
  return m[0];
}
function rowHeightsInches(xml: string): number[] {
  return [...tableXml(xml).matchAll(/<a:tr h="(\d+)">/g)].map((m) => Number(m[1]) / EMU_PER_INCH);
}
function colWidthsInches(xml: string): number[] {
  return [...tableXml(xml).matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((m) => Number(m[1]) / EMU_PER_INCH);
}
/** Smallest `sz=` (hundredths of a point) inside the table = its shrunk body font. */
function minFontPt(xml: string): number {
  const szs = [...tableXml(xml).matchAll(/sz="(\d+)"/g)].map((m) => Number(m[1]) / 100);
  return Math.min(...szs);
}

const denseRows = (n: number): string[][] =>
  Array.from({ length: n }, (_, i) => [
    `Feature number ${i + 1}`,
    `A reasonably long sentence describing what feature ${i + 1} does in practice and why it matters.`,
    i % 2 ? 'In progress' : 'Done',
    `Person ${String.fromCharCode(65 + i)}`,
  ]);

// The 16:9 title-content body area a table gets on its own.
const BODY = { x: 0.5, y: 1, w: 9, h: 4 };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('fitTableToArea', () => {
  it('keeps the 14pt base font and equal columns for a small table', () => {
    const fit = fitTableToArea([['A', 'B'], ['1', '2'], ['3', '4']], BODY);
    expect(fit.fontSize).toBe(14);
    expect(fit.overflow).toBe(false);
    expect(fit.colW).toHaveLength(2);
    expect(fit.colW[0]).toBeCloseTo(fit.colW[1]);
    expect(sum(fit.colW)).toBeCloseTo(BODY.w);
    expect(fit.rowH).toHaveLength(3);
    expect(fit.height).toBeCloseTo(sum(fit.rowH));
    expect(fit.height).toBeLessThanOrEqual(BODY.h);
  });

  it('steps the font down until a dense table fits', () => {
    const matrix = [['Feature', 'Description', 'Status', 'Owner'], ...denseRows(7)];
    const area = { ...BODY, h: 2.5 };
    const fit = fitTableToArea(matrix, area);
    expect(fit.fontSize).toBeLessThan(14);
    expect(fit.fontSize).toBeGreaterThanOrEqual(7);
    expect(fit.overflow).toBe(false);
    expect(fit.height).toBeLessThanOrEqual(area.h);
  });

  it('weights column widths by content length', () => {
    const fit = fitTableToArea([
      ['ID', 'Notes'],
      ['1', 'A long free-text note that needs a lot more horizontal room than the id column beside it.'],
    ], BODY);
    expect(fit.colW[1]).toBeGreaterThan(fit.colW[0] * 2);
  });

  it('clamps at 7pt and squeezes rows into the area when it cannot fit', () => {
    const matrix = [['Feature', 'Description', 'Status', 'Owner'], ...denseRows(40)];
    const fit = fitTableToArea(matrix, BODY);
    expect(fit.fontSize).toBe(7);
    expect(fit.overflow).toBe(true);
    expect(fit.height).toBe(BODY.h);
    expect(sum(fit.rowH)).toBeCloseTo(BODY.h);
  });
});

describe('exportPptx table auto-fit', () => {
  it('shrinks a dense 4x8 table so its rows fit within the slide', async () => {
    const table: SlideElement = {
      type: 'table',
      headers: ['Feature', 'Description', 'Status', 'Owner'],
      rows: denseRows(7),
    };
    const { xml } = await slideXml(makeSlide([
      { type: 'paragraph', text: 'Some intro text about the data below.', html: 'Some intro text about the data below.' },
      table,
    ]));

    const rows = rowHeightsInches(xml);
    expect(rows).toHaveLength(8); // header + 7

    const totalH = rows.reduce((a, b) => a + b, 0);
    // The whole table must fit inside one slide (it shares the body with a
    // paragraph, so in practice it gets well under half the slide height).
    expect(totalH).toBeLessThanOrEqual(SLIDE_H_16x9);

    // A table this dense cannot fit at the 14pt base size — the fitter must
    // have stepped the font down.
    expect(minFontPt(xml)).toBeLessThan(14);
    expect(minFontPt(xml)).toBeGreaterThanOrEqual(7); // never below the floor
  });

  it('keeps the base font and emits explicit column widths for a small table', async () => {
    const { xml } = await slideXml(makeSlide([
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] },
    ]));

    expect(minFontPt(xml)).toBe(14);

    const cols = colWidthsInches(xml);
    expect(cols).toHaveLength(2);
    // Two short, equal columns → roughly equal widths that sum to the area.
    expect(Math.abs(cols[0] - cols[1])).toBeLessThan(0.05);
    const totalW = cols.reduce((a, b) => a + b, 0);
    expect(totalW).toBeGreaterThan(8); // ~9" content area on a 10" slide
    expect(totalW).toBeLessThanOrEqual(9.05);
  });

  it('gives a wide-content column more width than a short-content column', async () => {
    const { xml } = await slideXml(makeSlide([
      {
        type: 'table',
        headers: ['ID', 'Notes'],
        rows: [
          ['1', 'A long free-text note that needs a lot more horizontal room than the id column beside it.'],
          ['2', 'Another lengthy note explaining the second row in a similarly verbose amount of detail here.'],
        ],
      },
    ]));
    const cols = colWidthsInches(xml);
    expect(cols).toHaveLength(2);
    expect(cols[1]).toBeGreaterThan(cols[0] * 2);
  });

  it('warns and clamps at the minimum font when a table cannot possibly fit', async () => {
    const table: SlideElement = {
      type: 'table',
      headers: ['Feature', 'Description', 'Status', 'Owner'],
      rows: denseRows(40),
    };
    const { xml, warnings } = await slideXml(makeSlide([table]));

    const totalH = rowHeightsInches(xml).reduce((a, b) => a + b, 0);
    // Squeezed so the graphic frame still lands on the slide.
    expect(totalH).toBeLessThanOrEqual(SLIDE_H_16x9);
    expect(minFontPt(xml)).toBe(7);
    expect(warnings.some((w) => w.toLowerCase().includes('table too large'))).toBe(true);
  });
});
