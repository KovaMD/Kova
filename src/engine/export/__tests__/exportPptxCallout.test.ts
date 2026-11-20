// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME, type Theme } from '../../theme';
import type { CalloutColors } from '../../calloutColors';
import type { Slide, SlideElement } from '../../types';

// Callout title/body colours in the PPTX export (issue #283) must match the
// preview's CSS color-mix: default title = callout colour, body = text colour.

const callout: SlideElement = { type: 'blockquote', calloutType: 'warning', title: 'Warning', text: 'Body text', html: '<p>Body text</p>' };
const para: SlideElement = { type: 'paragraph', text: 'Intro', html: 'Intro' };

function makeSlide(elements: SlideElement[], extra: Partial<Slide> = {}): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0,
    elements, speakerNotes: '', references: [], layout: 'content', hidden: false,
    ...extra,
  };
}

function themeWith(cc?: CalloutColors): Theme {
  return { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, ...(cc ? { callout_colors: cc } : {}) } };
}

async function slideXml(slide: Slide, theme: Theme): Promise<string> {
  const res = await exportToPptx([slide], {}, theme, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

const has = (xml: string, hex: string) => xml.includes(`<a:srgbClr val="${hex}"/>`);

// Light theme text is #1A1A1A; warning is #FF9100; 70% mix = BA6D08.
const cases: Array<[string, SlideElement[]]> = [
  ['standalone box', [callout]],
  ['mixed with other content', [para, callout]],
];

for (const [label, elements] of cases) {
  describe(`PPTX callout colours: ${label}`, () => {
    it('keeps the defaults when callout_colors is unset', async () => {
      const xml = await slideXml(makeSlide(elements), themeWith());
      expect(has(xml, 'FF9100')).toBe(true);
      expect(has(xml, '1A1A1A')).toBe(true);
      expect(has(xml, 'BA6D08')).toBe(false);
    });

    it('mixes the body with "callout 70%"', async () => {
      const xml = await slideXml(makeSlide(elements), themeWith({ body_text: 'callout 70%' }));
      expect(has(xml, 'BA6D08')).toBe(true);
    });

    it('uses a per-type colour override', async () => {
      const xml = await slideXml(makeSlide(elements), themeWith({ warning: '#e11d48' }));
      expect(has(xml, 'E11D48')).toBe(true);
      expect(has(xml, 'FF9100')).toBe(false);
    });

    it('accepts a plain colour for title_text', async () => {
      const xml = await slideXml(makeSlide(elements), themeWith({ title_text: '#123456' }));
      expect(has(xml, '123456')).toBe(true);
    });

    it('mixes against the per-slide text colour', async () => {
      // 50% of FF9100 with 000000 = 80 49 00 (rounding 127.5 -> 128, 72.5 -> 73)
      const xml = await slideXml(makeSlide(elements, { textColor: '#000000' }), themeWith({ body_text: 'callout 50%' }));
      expect(has(xml, '804900')).toBe(true);
    });
  });
}
