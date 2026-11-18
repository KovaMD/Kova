// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';

function para(html: string, text = html.replace(/<[^>]+>/g, '')): SlideElement {
  return { type: 'paragraph', text, html };
}

function makeSlide(elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: 'Title', titleLevel: 2,
    elements, speakerNotes: '', references: [], layout: 'title-content', hidden: false,
  };
}

async function slideXml(slide: Slide): Promise<string> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('exportPptx underline (issue #175)', () => {
  it('emits underline formatting for <u> runs in slide1.xml', async () => {
    const xml = await slideXml(makeSlide([para('This is <u>underlined</u> text.')]));
    // pptxgenjs encodes underline: { style: 'sng' } as u="sng" on <a:rPr>.
    expect(xml).toMatch(/\bu="sng"/);
    expect(xml).toContain('underlined');
  });
});
