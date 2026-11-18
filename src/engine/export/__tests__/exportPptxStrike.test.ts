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
    index: 0, raw: '', title: 'Edits', titleLevel: 2,
    elements, speakerNotes: '', references: [], layout: 'title-content', hidden: false,
  };
}

async function slideXml(slide: Slide): Promise<string> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('exportPptx strikethrough (issue #177)', () => {
  it('emits strike formatting for <del> runs in slide1.xml', async () => {
    const xml = await slideXml(makeSlide([para('This is <del>old</del> and <strong>new</strong>.')]));
    // pptxgenjs encodes boolean strike as <a:strike val="sngStrike"/>.
    expect(xml).toContain('sngStrike');
    expect(xml).toContain('old');
  });

  it('emits strike formatting for <s> runs', async () => {
    const xml = await slideXml(makeSlide([para('use <s>legacy</s> API')]));
    expect(xml).toContain('sngStrike');
    expect(xml).toContain('legacy');
  });
});
