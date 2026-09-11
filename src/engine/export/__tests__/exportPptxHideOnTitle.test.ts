// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME, type Theme } from '../../theme';
import type { Slide } from '../../types';

// Issue #254 — a header/footer enabled in the theme can be suppressed on
// just the title slide via header.hide_on_title / footer.hide_on_title.

function makeSlide(layout: Slide['layout']): Slide {
  return {
    index: 0, raw: '', title: 'Heading', titleLevel: 1,
    elements: [], speakerNotes: '', references: [], layout, hidden: false,
  };
}

async function slideXml(slide: Slide, theme: Theme): Promise<string> {
  const res = await exportToPptx([slide], {}, theme, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return xml;
}

const THEME_HIDE_BOTH: Theme = {
  ...DEFAULT_THEME,
  header: { show: true, text: 'Header text', hide_on_title: true },
  footer: { show: true, text: 'Footer text', show_slide_number: false, hide_on_title: true },
};

describe('exportPptx header/footer hide_on_title', () => {
  it('omits the header and footer on the title slide when hide_on_title is set', async () => {
    const xml = await slideXml(makeSlide('title'), THEME_HIDE_BOTH);
    expect(xml).not.toContain('kova:header-text');
    expect(xml).not.toContain('kova:footer-text');
  });

  it('still renders the header and footer on a non-title slide', async () => {
    const xml = await slideXml(makeSlide('title-content'), THEME_HIDE_BOTH);
    expect(xml).toContain('kova:header-text');
    expect(xml).toContain('kova:footer-text');
  });

  it('leaves the title slide header/footer alone when hide_on_title is unset', async () => {
    const theme: Theme = {
      ...DEFAULT_THEME,
      header: { show: true, text: 'Header text' },
      footer: { show: true, text: 'Footer text', show_slide_number: false },
    };
    const xml = await slideXml(makeSlide('title'), theme);
    expect(xml).toContain('kova:header-text');
    expect(xml).toContain('kova:footer-text');
  });
});
