// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import type { ListItem, Slide, SlideElement } from '../../types';

// Progressive-reveal (`<!-- step -->`, issue #92) native PPTX click-animations.
// Mirrors exportPptxColor.test.ts's JSZip-unzip helper style.

// jsdom's Image never actually decodes pixel data (see exportPptxImageMixed.test.ts) —
// stub a synchronously-loading one so the lone-image test doesn't hang forever.
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

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function item(text: string, step?: number, children: ListItem[] = []): ListItem {
  return { text, html: text, step, children };
}

function makeSlide(elements: SlideElement[], extra: Partial<Slide> = {}): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0,
    elements, speakerNotes: '', references: [], layout: 'title-content', hidden: false,
    ...extra,
  };
}

async function slideXml(slide: Slide): Promise<string> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('exportPptx native build animations', () => {
  it('emits no <p:timing> at all when nothing on the slide has a step', async () => {
    const xml = await slideXml(makeSlide([{ type: 'paragraph', text: 'Hi', html: 'Hi' }]));
    expect(xml).not.toContain('<p:timing>');
  });

  it('never leaks the internal kova:step-* placeholder name into the final XML', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'list', ordered: false, items: [item('A', 1), item('B')] },
    ]));
    expect(xml).not.toContain('kova:step');
  });

  it('targets a paragraph range on the shared text-box shape for a stepped bullet', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'list', ordered: false, items: [item('A'), item('B', 1), item('C', 2)] },
    ]));
    expect(xml).toContain('<p:timing>');
    // A: paragraph 0, always visible, not in any click.
    // B: paragraph 1 -> step 1. C: paragraph 2 -> step 2.
    expect(xml).toContain('<p:pRg st="1" end="1"/>');
    expect(xml).toContain('<p:pRg st="2" end="2"/>');
    // Two distinct clicks (one per step value).
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(2);
  });

  it('registers a <p:bldP> for a shape with a per-paragraph build', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'list', ordered: false, items: [item('A', 1)] },
    ]));
    expect(xml).toMatch(/<p:bldLst><p:bldP spid="\d+" grpId="0"\/><\/p:bldLst>/);
  });

  it('groups an explicit `step: N` onto one click even when the paragraphs are non-contiguous', async () => {
    // A(step 1), B(no step), C(step 1) -> paragraphs 0 and 2 share step 1.
    const xml = await slideXml(makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 1 },
      { type: 'paragraph', text: 'B', html: 'B' },
      { type: 'paragraph', text: 'C', html: 'C', step: 1 },
    ]));
    // One click (one clickEffect), but two disjoint <p:pRg> targets inside it.
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(1);
    expect(xml).toContain('<p:pRg st="0" end="0"/>');
    expect(xml).toContain('<p:pRg st="2" end="2"/>');
  });

  it('merges contiguous stepped paragraphs into a single range', async () => {
    // Two adjacent bullets sharing an explicit step group into one <p:pRg>.
    const xml = await slideXml(makeSlide([
      { type: 'list', ordered: false, items: [item('A', 2), item('B', 2)] },
    ]));
    expect(xml).toContain('<p:pRg st="0" end="1"/>');
    expect(xml.match(/<p:pRg/g)?.length).toBe(1);
  });

  it('orders clicks by ascending step value regardless of source order', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 3 },
      { type: 'paragraph', text: 'B', html: 'B', step: 1 },
    ]));
    const firstClickIdx = xml.indexOf('<p:pRg st="1" end="1"/>');
    const secondClickIdx = xml.indexOf('<p:pRg st="0" end="0"/>'); // A is paragraph 0, step 3
    expect(firstClickIdx).toBeGreaterThan(-1);
    expect(secondClickIdx).toBeGreaterThan(firstClickIdx);
  });

  it('animates a stepped lone image as a whole shape (no paragraph range, no build-list entry)', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'image', src: PNG_DATA_URL, alt: '', step: 1 },
    ]));
    expect(xml).toContain('<p:timing>');
    expect(xml).toMatch(/<p:spTgt spid="\d+"\/>/); // whole-shape target, no <p:txEl>
    expect(xml).not.toContain('<p:pRg');
    expect(xml).not.toContain('<p:bldLst>'); // only text-box builds register here
  });

  it('does not animate a stepped lone code block or callout (multi-shape composites — see scope note)', async () => {
    const codeXml = await slideXml(makeSlide([
      { type: 'code', lang: 'js', value: 'const x = 1;', step: 1 },
    ]));
    expect(codeXml).not.toContain('<p:timing>');

    const calloutXml = await slideXml(makeSlide([
      { type: 'blockquote', text: 'Careful', calloutType: 'warning', title: 'Warning', step: 1 },
    ]));
    expect(calloutXml).not.toContain('<p:timing>');
  });

  it('keeps the existing fade slide-transition intact alongside the new timing tree', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 1 },
    ]));
    expect(xml).toContain('<p:transition');
    expect(xml).toContain('<p:timing>');
  });
});
