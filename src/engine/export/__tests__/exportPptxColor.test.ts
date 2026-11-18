// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';

// Per-slide text colour / invert must thread through to the body runs of every
// content layout in the PPTX export (regression guard for issue #143 review:
// split / two-column / bsp / grid were only recolouring the title, not the body).
// CSS colour parsing itself is unit-tested in pptx/__tests__/colour.test.ts.

const OVERRIDE = '#ff0000'; // -> FF0000
const NAMED = 'red';       // Marp `_color: red` -> FF0000 (no collision with light theme)
const HSL_GREEN = 'hsl(120, 100%, 25%)'; // -> 008000 (dark green, DOM-resolves to rgb(0,128,0))
const INVERT = 'FFFFFF';   // light "text on dark" = theme title_text -> FFFFFF
const DEFAULT_BODY = '1A1A1A'; // light theme text colour

function para(text: string): SlideElement {
  return { type: 'paragraph', text, html: text };
}
function progress(label: string, value: number): SlideElement {
  return { type: 'progress', label, value };
}

function makeSlide(layout: Slide['layout'], elements: SlideElement[], extra: Partial<Slide> = {}): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0,
    elements, speakerNotes: '', references: [], layout, hidden: false,
    ...extra,
  };
}

async function slideXml(slide: Slide): Promise<string> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return xml;
}

function hasColor(xml: string, hex: string): boolean {
  return xml.includes(`<a:srgbClr val="${hex}"/>`);
}

describe('exportPptx per-slide text colour', () => {
  // Each affected layout with NO title: the only coloured runs are the body,
  // so a hit on OVERRIDE proves the override reaches body text (not just title).
  const layouts: Slide['layout'][] = ['split', 'two-column', 'three-column', 'bsp', 'grid'];

  for (const layout of layouts) {
    it(`applies explicit color to body in ${layout}`, async () => {
      const xml = await slideXml(makeSlide(layout, [para('body text')], { textColor: OVERRIDE }));
      expect(hasColor(xml, 'FF0000')).toBe(true);
      // Without the override the body would be the theme default, so a default-only
      // slide must NOT contain the override colour.
      const control = await slideXml(makeSlide(layout, [para('body text')]));
      expect(hasColor(control, 'FF0000')).toBe(false);
      expect(hasColor(control, DEFAULT_BODY)).toBe(true);
    });

    it(`applies invert to body in ${layout}`, async () => {
      const xml = await slideXml(makeSlide(layout, [para('body text')], { invert: true }));
      expect(hasColor(xml, INVERT)).toBe(true);
    });
  }

  it('two-column colours both columns via column-break', async () => {
    const els: SlideElement[] = [para('left'), { type: 'column-break' }, para('right')];
    const xml = await slideXml(makeSlide('two-column', els, { textColor: OVERRIDE }));
    // Two paragraphs => two runs, both should be FF0000 (body of each column).
    const matches = xml.match(/<a:srgbClr val="FF0000"\/>/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('three-column colours all three columns via 2 column-breaks', async () => {
    const els: SlideElement[] = [
      para('left'), { type: 'column-break' },
      para('middle'), { type: 'column-break' },
      para('right'),
    ];
    const xml = await slideXml(makeSlide('three-column', els, { textColor: OVERRIDE }));
    // Three paragraphs => three runs, all should be FF0000 (body of each column).
    const matches = xml.match(/<a:srgbClr val="FF0000"\/>/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('bsp colours body in the progress-bar grouped path', async () => {
    const els: SlideElement[] = [
      para('intro'),
      progress('A', 40),
      progress('B', 60),
    ];
    const xml = await slideXml(makeSlide('bsp', els, { textColor: OVERRIDE }));
    expect(hasColor(xml, 'FF0000')).toBe(true);
  });

  it('media placeholders honour per-slide color', async () => {
    const els: SlideElement[] = [{ type: 'youtube', label: 'Vid', url: 'https://example.com' }];
    const xml = await slideXml(makeSlide('media', els, { textColor: OVERRIDE }));
    expect(hasColor(xml, 'FF0000')).toBe(true);
  });

  it('hsl() color threads through split body', async () => {
    const xml = await slideXml(makeSlide('split', [para('body text')], { textColor: HSL_GREEN }));
    expect(hasColor(xml, '008000')).toBe(true);
  });

  it('named color threads through split body', async () => {
    const xml = await slideXml(makeSlide('split', [para('body text')], { textColor: NAMED }));
    expect(hasColor(xml, 'FF0000')).toBe(true);
  });
});
