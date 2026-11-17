// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// buildPrintDocument resolves assets over Tauri IPC; the golden fixtures
// below use none, so any call is a regression.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => { throw new Error(`unexpected invoke: ${cmd}`); },
}));

import { nupCols, notesEnabled, planPage, type PdfExportOpts } from '../pdfLayout';
import { buildPrintDocument } from '../exportPdfNative';

const AR = { w: 16, h: 9 };

describe('pdfLayout', () => {
  it('picks grid columns per sheet size', () => {
    expect(nupCols(1)).toBe(1);
    expect(nupCols(2)).toBe(2);
    expect(nupCols(4)).toBe(2);
    expect(nupCols(6)).toBe(3);
  });

  it('enables notes only at 1-up with a non-empty note', () => {
    expect(notesEnabled({ perPage: 1, notes: ['hi'] })).toBe(true);
    expect(notesEnabled({ perPage: 1, notes: ['', '  '] })).toBe(false);
    expect(notesEnabled({ perPage: 4, notes: ['hi'] })).toBe(false);
    expect(notesEnabled({})).toBe(false);
  });

  it('lays A4 out landscape by default', () => {
    const p = planPage(AR, { perPage: 1 });
    expect(p.mode).toBe('single');
    expect([p.pageWmm, p.pageHmm]).toEqual([297, 210]); // A4 landscape
    expect(p.pageWpx).toBeGreaterThan(p.pageHpx);
    expect(p.cols).toBe(1);
  });

  it('honours Letter paper', () => {
    const p = planPage(AR, { perPage: 1, paper: 'letter' });
    expect([p.pageWmm, p.pageHmm]).toEqual([279, 216]);
  });

  it('scales a slide to fit its cell without overflow', () => {
    const p = planPage(AR, { perPage: 4 });
    expect(p.mode).toBe('nup');
    expect(p.cols).toBe(2);
    expect(p.rows).toBe(2);
    expect(960 * p.slideScale).toBeLessThanOrEqual(p.cellWpx + 0.01);
    expect(p.slideNativeHpx * p.slideScale).toBeLessThanOrEqual(p.cellHpx + 0.01);
  });

  it('reserves a notes band below the slide', () => {
    const p = planPage(AR, { perPage: 1, notes: ['speaker note'] });
    expect(p.mode).toBe('notes');
    expect(p.notesTopPx).toBeGreaterThan(p.marginPx);
    expect(p.notesTopPx).toBeLessThan(p.pageHpx - p.marginPx);
  });

  it('fullBleed sets page size to the slide with no margins and unit scale', () => {
    const p = planPage(AR, { fullBleed: true });
    expect(p.mode).toBe('single');
    expect(p.marginPx).toBe(0);
    expect(p.gapPx).toBe(0);
    expect(p.pageWpx).toBe(960);
    expect(p.slideNativeHpx).toBe(540);
    expect(p.pageHpx).toBe(540);
    expect(p.slideScale).toBe(1);
    expect(p.cols).toBe(1);
    expect(p.rows).toBe(1);
  });

  it('"slide" paper matches the slide with no margins at 1-up', () => {
    const p = planPage(AR, { perPage: 1, paper: 'slide' });
    expect(p.mode).toBe('single');
    expect(p.marginPx).toBe(0);
    expect(p.pageWpx).toBe(960);
    expect(p.pageHpx).toBe(540);
    expect(p.slideScale).toBe(1);
  });

  it('"slide" paper falls back to A4 when combined with N-up', () => {
    const p = planPage(AR, { perPage: 4, paper: 'slide' });
    expect(p.mode).toBe('nup');
    expect([p.pageWmm, p.pageHmm]).toEqual([297, 210]);
  });

  it('"slide" paper falls back to A4 when combined with notes', () => {
    const p = planPage(AR, { perPage: 1, paper: 'slide', notes: ['hi'] });
    expect(p.mode).toBe('notes');
    expect([p.pageWmm, p.pageHmm]).toEqual([297, 210]);
  });
});

// ── Golden (characterisation) tests, refactor card P0-06 ─────────────────────
// Pin the exact layout numbers for every paper/aspect/mode combination the UI
// can request, and the page structure the PDF print document is built from.
// PDF export intentionally flattens build steps (parity with PowerPoint and
// Keynote); only the HTML export is interactive. Any snapshot change must be
// explained in its PR.

const ASPECTS = { '16:9': { w: 16, h: 9 }, '4:3': { w: 4, h: 3 }, '16:10': { w: 16, h: 10 } };
const PAPERS = ['a4', 'letter', 'slide'] as const;
const PER_PAGE = [1, 2, 4, 6];

describe('pdfLayout golden plans (P0-06)', () => {
  for (const [arName, ar] of Object.entries(ASPECTS)) {
    it(`matches the golden page plans for ${arName}`, () => {
      const plans: Record<string, unknown> = {
        fullBleed: planPage(ar, { fullBleed: true }),
        default: planPage(ar, {}),
      };
      for (const paper of PAPERS) {
        for (const perPage of PER_PAGE) {
          plans[`${paper} ${perPage}-up`] = planPage(ar, { paper, perPage });
        }
        plans[`${paper} notes`] = planPage(ar, { paper, perPage: 1, notes: ['note'] });
      }
      expect(plans).toMatchSnapshot();
    });
  }

  it('maps out-of-range perPage values onto the same grids', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 9].map(nupCols)).toEqual([1, 1, 2, 2, 2, 3, 3, 3, 3]);
    const p3 = planPage(AR, { perPage: 3 });
    expect([p3.mode, p3.cols, p3.rows]).toEqual(['nup', 2, 2]);
  });
});

// ── Print document page structure ────────────────────────────────────────────

function slideEl(label: string, bg?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'slide-wrap';
  wrap.innerHTML = `<div class="slide-frame"${bg ? ` style="--sl-bg: ${bg};"` : ''}><h1>${label}</h1></div>`;
  return wrap;
}

/** Page/slot/notes skeleton of the print document: one line per page. */
function pageSkeleton(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.children).map((page) => {
    const content = page.firstElementChild!;
    const slots = Array.from(content.querySelectorAll(':scope > .kova-slot')).map((slot) => {
      const ok = slot.querySelector(':scope > .kova-frame > .kova-scale > .slide-wrap');
      return ok ? ok.textContent : '<malformed slot>';
    });
    const notes = content.querySelector(':scope > .kova-notes');
    return `${page.className} > ${content.className} [${slots.join(', ')}]` +
      (notes ? ` notes=${JSON.stringify(notes.innerHTML)}` : '');
  });
}

/** The generated print rules (everything after the caller's extracted CSS). */
function printCss(html: string): string {
  const style = new DOMParser().parseFromString(html, 'text/html').querySelector('style')!.textContent!;
  return style.slice(style.indexOf('@page'));
}

describe('buildPrintDocument golden structure (P0-06)', () => {
  const slides = () => ['S1', 'S2', 'S3', 'S4', 'S5'].map((l, i) => slideEl(l, i === 0 ? '#0a0b0c' : undefined));
  const notes = ['First <note> & more', '', '  padded  ', undefined, 'Last'];

  const cases: Array<[string, PdfExportOpts]> = [
    ['single A4', {}],
    ['2-up Letter', { perPage: 2, paper: 'letter' }],
    ['4-up A4', { perPage: 4 }],
    ['6-up A4', { perPage: 6 }],
    ['notes A4', { perPage: 1, notes }],
    ['slide paper', { paper: 'slide' }],
  ];

  it.each(cases)('matches the golden page structure and print CSS: %s', async (_name, opts) => {
    const html = await buildPrintDocument(slides(), AR, opts);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(pageSkeleton(html)).toMatchSnapshot('pages');
    expect(printCss(html)).toMatchSnapshot('print css');
  });

  it('is byte-identical across repeated runs', async () => {
    const opts: PdfExportOpts = { perPage: 1, notes };
    expect(await buildPrintDocument(slides(), AR, opts)).toBe(await buildPrintDocument(slides(), AR, opts));
  });

  it('flattens build steps: stepped items are emitted fully revealed with no navigation script', async () => {
    const el = slideEl('Steps');
    el.querySelector('.slide-frame')!.innerHTML += '<ul><li data-step="1">a</li><li data-step="2">b</li></ul>';
    const html = await buildPrintDocument([el], AR, {});
    expect(html).not.toContain('<script');
    expect(html).not.toContain('sl-step-item--pending');
    expect(html.match(/data-step=/g)?.length).toBe(2);
  });
});
