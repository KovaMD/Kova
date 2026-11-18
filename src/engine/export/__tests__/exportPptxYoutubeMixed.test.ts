// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';

// Regression guard for issue #192: a YouTube element mixed with other content
// on a slide was silently dropped on export. detectLayout() normally routes
// any slide containing a youtube element straight to the 'media' layout
// (which already renders it correctly), so this bug is only reachable when an
// explicit `<!-- layout: ... -->` override forces a non-media layout — hence
// setting `layout` directly on the fixture rather than relying on detection.
//
// Issue #219 upgraded placeholders to real addMedia embeds; these tests now
// assert the relationship Target instead of text runs.

function para(text: string): SlideElement {
  return { type: 'paragraph', text, html: text };
}

function makeSlide(layout: Slide['layout'], elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0,
    elements, speakerNotes: '', references: [], layout, hidden: false,
  };
}

async function slideRels(slide: Slide): Promise<string> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
}

const TINY_MP4 =
  'data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAA';

describe('exportPptx youtube in mixed-content slides', () => {
  it('embeds youtube when it shares a slide with other content', async () => {
    const els: SlideElement[] = [para('intro'), { type: 'youtube', label: 'Demo', url: 'https://youtu.be/xyz' }];
    const rels = await slideRels(makeSlide('title-content', els));
    expect(rels).toContain('https://www.youtube.com/embed/xyz');
  });

  it('embeds youtube when the label is empty', async () => {
    const els: SlideElement[] = [para('intro'), { type: 'youtube', label: '', url: 'https://youtu.be/xyz' }];
    const rels = await slideRels(makeSlide('title-content', els));
    expect(rels).toContain('https://www.youtube.com/embed/xyz');
  });

  it('still embeds the video case correctly (control against a copy/paste mistake)', async () => {
    const els: SlideElement[] = [para('intro'), { type: 'video', label: 'Clip', src: TINY_MP4 }];
    const res = await exportToPptx([makeSlide('title-content', els)], {}, DEFAULT_THEME, 'en');
    const zip = await JSZip.loadAsync(res.base64, { base64: true });
    const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && f.endsWith('.mp4'));
    expect(media.length).toBeGreaterThanOrEqual(1);
  });
});
