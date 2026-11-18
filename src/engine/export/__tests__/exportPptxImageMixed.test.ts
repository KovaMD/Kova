// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';

// jsdom's Image never actually decodes pixel data, so `new Image().onload`
// never fires — both getImageAspectRatio (exportPptx.ts) and pptxgenjs's own
// internal image handling wait on it, hanging forever under the default test
// environment. Stub a synchronously-loading Image for this file only so a
// real data: URL can be exercised end to end.
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 100;
  naturalHeight = 100;
  width = 100;
  height = 100;
  set src(_v: string) { this.onload?.(); }
}
let OriginalImage: typeof Image;
beforeAll(() => { OriginalImage = global.Image; (global as unknown as { Image: unknown }).Image = StubImage; });
afterAll(() => { (global as unknown as { Image: unknown }).Image = OriginalImage; });

// Regression guard: an image mixed with other content on a slide (a table, or
// any element via an explicit ||| column break) was silently dropped on
// export. addElements' lone-image fast path only covers elements.length===1;
// for any other combination the switch in its main loop has no 'image' case,
// so the image fell through to `default: break` with nothing downstream to
// catch it, unlike a table or progress bars. The live preview (elements.tsx)
// renders images inline regardless of what else is on the slide, so this was
// an export-only WYSIWYG regression. See exportPptxYoutubeMixed.test.ts for
// the same bug class against youtube elements (issue #192).

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function image(): SlideElement {
  return { type: 'image', src: PNG_DATA_URL, alt: 'x' };
}

function makeSlide(layout: Slide['layout'], elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: 'Title', titleLevel: 2,
    elements, speakerNotes: '', references: [], layout, hidden: false,
  };
}

async function exportSlide(slide: Slide) {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return { res, xml };
}

describe('exportPptx image in mixed-content slides', () => {
  it('embeds an image that shares a title-content slide with a table', async () => {
    const els: SlideElement[] = [
      image(),
      { type: 'table', headers: ['A'], rows: [['1']] },
    ];
    const { res, xml } = await exportSlide(makeSlide('title-content', els));
    expect(xml).toContain('<p:pic>');
    expect(res.warnings.some((w) => w.includes('skipped'))).toBe(false);
  });

  it('embeds an image that shares a title-content slide with a paragraph and list', async () => {
    const els: SlideElement[] = [
      { type: 'paragraph', text: 'intro', html: 'intro' },
      image(),
      { type: 'list', ordered: false, items: [{ text: 'one', html: 'one', children: [] }] },
    ];
    const { res, xml } = await exportSlide(makeSlide('title-content', els));
    expect(xml).toContain('<p:pic>');
    expect(res.warnings.some((w) => w.includes('skipped'))).toBe(false);
  });

  it('embeds an image sharing a column with other content via an explicit ||| break', async () => {
    const els: SlideElement[] = [
      image(),
      { type: 'paragraph', text: 'caption text', html: 'caption text' },
      { type: 'column-break' },
      { type: 'paragraph', text: 'other column', html: 'other column' },
    ];
    const { res, xml } = await exportSlide(makeSlide('two-column', els));
    expect(xml).toContain('<p:pic>');
    expect(res.warnings.some((w) => w.includes('skipped'))).toBe(false);
  });

  it('still renders a lone image at full size (control against a regression in the fast path)', async () => {
    const { res, xml } = await exportSlide(makeSlide('title-content', [image()]));
    expect(xml).toContain('<p:pic>');
    expect(res.warnings.some((w) => w.includes('skipped'))).toBe(false);
  });
});
