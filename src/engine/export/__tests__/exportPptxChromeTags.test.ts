// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement, Theme } from '../../types';

// Regression guard for issue #192: Kova's own header/footer/slide-number bars
// are tagged with a 'kova:'-prefixed pptxgenjs objectName so the importer can
// recognise and skip them on round-trip instead of duplicating them as slide
// content. Verifies the tag lands in the exported OOXML (p:cNvPr@name).

function para(text: string): SlideElement {
  return { type: 'paragraph', text, html: text };
}

function makeSlide(elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0,
    elements, speakerNotes: '', references: [], layout: 'title-content', hidden: false,
  };
}

async function slideXml(theme: Theme): Promise<string> {
  const slide = makeSlide([para('body text')]);
  // header/footer text templates default to '{title}' — without a title they
  // resolve to '' and addBarText is skipped entirely, so give the doc a title.
  const res = await exportToPptx([slide], { title: 'My Deck' }, theme, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

function hasObjectName(xml: string, name: string): boolean {
  return xml.includes(`name="${name}"`);
}

describe('exportPptx chrome tagging', () => {
  it('tags the header bar text with kova:header-text', async () => {
    const theme: Theme = { ...DEFAULT_THEME, header: { show: true, text: '{title}' } };
    const xml = await slideXml(theme);
    expect(hasObjectName(xml, 'kova:header-text')).toBe(true);
  });

  it('tags the footer bar text and slide number with kova:footer-text / kova:slidenum', async () => {
    const theme: Theme = { ...DEFAULT_THEME, footer: { show: true, text: '{title}', show_slide_number: true } };
    const xml = await slideXml(theme);
    expect(hasObjectName(xml, 'kova:footer-text')).toBe(true);
    expect(hasObjectName(xml, 'kova:slidenum')).toBe(true);
  });

  it('does not tag ordinary body content with a kova: name (control)', async () => {
    const theme: Theme = {
      ...DEFAULT_THEME,
      header: { show: true, text: '{title}' },
      footer: { show: true, text: '{title}', show_slide_number: true },
    };
    const xml = await slideXml(theme);
    // Every shape name in the doc should be accounted for by the chrome tags
    // or pptxgenjs's own generic defaults — none should carry a 'kova:' prefix
    // other than the three chrome tags asserted above.
    const names = Array.from(xml.matchAll(/name="([^"]*)"/g)).map((m) => m[1]);
    const kovaNames = names.filter((n) => n.startsWith('kova:'));
    expect(new Set(kovaNames)).toEqual(new Set(['kova:header-text', 'kova:footer-text', 'kova:slidenum']));
  });
});
