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

  it('never widens a <p:pRg> across more than one paragraph, even for adjacent same-step bullets', async () => {
    // Real-world testing found PowerPoint only reliably reveals the *first*
    // paragraph of a wide <p:pRg st=X end=Y> (Y>X) — the rest stay visible
    // from the start. Two adjacent bullets sharing an explicit step must
    // therefore get two separate single-paragraph <p:set> behaviours (still
    // inside the same clickEffect, so they still fire on the same click).
    const xml = await slideXml(makeSlide([
      { type: 'list', ordered: false, items: [item('A', 2), item('B', 2)] },
    ]));
    expect(xml).toContain('<p:pRg st="0" end="0"/>');
    expect(xml).toContain('<p:pRg st="1" end="1"/>');
    expect(xml.match(/<p:pRg/g)?.length).toBe(2);
    // Both still fire on the same (only) click.
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(1);
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

  it('animates a stepped lone code block as a batch of whole-shape targets on one click', async () => {
    // Regression: a code/callout block that ends up alone in a grid/bsp cell
    // (routine — groupProgressRuns puts every non-progress element in its own
    // cell) hits this exact "lone" fast path, not the shared-text-box path
    // above. It used to render fully visible regardless of step because
    // addCodeBlock never registered any of its 3-4 shapes with stepTargets.
    const xml = await slideXml(makeSlide([
      { type: 'code', lang: 'js', value: 'const x = 1;', step: 1 },
    ]));
    expect(xml).toContain('<p:timing>');
    expect(xml).not.toContain('<p:pRg'); // whole-shape targets, not paragraph ranges
    expect(xml).not.toContain('kova:step');
    // Outer rect + inner rect + lang badge + code text, all on the one click.
    const setCount = xml.match(/<p:set>/g)?.length ?? 0;
    expect(setCount).toBe(4);
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(1);
  });

  it('animates a stepped lone callout as a batch of whole-shape targets on one click', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'blockquote', text: 'Careful', calloutType: 'warning', title: 'Warning', step: 1 },
    ]));
    expect(xml).toContain('<p:timing>');
    expect(xml).not.toContain('<p:pRg');
    // Background + accent bar + title + body, all on the one click.
    const setCount = xml.match(/<p:set>/g)?.length ?? 0;
    expect(setCount).toBe(4);
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(1);
  });

  it('does not animate a lone callout with no body text (only 3 shapes, still one click)', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'blockquote', text: '', calloutType: 'note', title: 'Heads up', step: 1 },
    ]));
    expect(xml).toContain('<p:timing>');
    const setCount = xml.match(/<p:set>/g)?.length ?? 0;
    expect(setCount).toBe(3); // no body text -> no 4th shape
  });

  it('animates a stepped code block on a real grid-layout slide (the exact reported repro)', async () => {
    // groupProgressRuns puts every non-progress element in its own grid cell,
    // so a code block sharing a slide with paragraphs still lands *alone* in
    // addElements() once grid/bsp auto-layout picks it — this is the actual
    // shape of the originally-reported "code block reveal does not work" bug.
    const xml = await slideXml(makeSlide([
      { type: 'paragraph', text: 'Always visible — the setup:', html: 'Always visible — the setup:' },
      { type: 'code', lang: 'js', value: 'function greet(name) {}' },
      { type: 'paragraph', text: 'Revealed on the next click — the payoff:', html: 'Revealed on the next click — the payoff:' },
      { type: 'code', lang: 'js', value: "console.log(greet('Kova'));", step: 1 },
    ], { layout: 'grid' }));
    expect(xml).toContain('<p:timing>');
  });

  it('animates a stepped table sharing its area with other content as a whole shape', async () => {
    // Previously never wired to stepTargets at all — a stepped table rendered
    // fully visible regardless of step, since addTable had no objectName param.
    const xml = await slideXml(makeSlide([
      { type: 'paragraph', text: 'Intro', html: 'Intro' },
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], step: 1 },
    ]));
    expect(xml).toContain('<p:timing>');
    expect(xml).toMatch(/<p:spTgt spid="\d+"\/>/); // whole-shape target, no <p:txEl>
    expect(xml).not.toContain('kova:step');
  });

  it('animates a stepped image sharing its area with a table as a whole shape', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
      { type: 'image', src: PNG_DATA_URL, alt: '', step: 1 },
    ]));
    expect(xml).toContain('<p:timing>');
    expect(xml).toMatch(/<p:spTgt spid="\d+"\/>/);
  });

  it('animates a stepped callout that shares its shape with other paragraphs (not the lone-callout fast path)', async () => {
    // Regression: title (first paragraph of the callout) animated in but the
    // body (second paragraph, same stepped element) stayed visible — the
    // <p:pRg> wide-range bug, now fixed by never widening a range.
    const xml = await slideXml(makeSlide([
      { type: 'paragraph', text: 'Setting the scene', html: 'Setting the scene' },
      { type: 'blockquote', text: 'Body text', calloutType: 'tip', title: 'Tip', step: 1 },
    ]));
    // Title -> paragraph 1, body -> paragraph 2 (paragraph 0 is the intro).
    expect(xml).toContain('<p:pRg st="1" end="1"/>');
    expect(xml).toContain('<p:pRg st="2" end="2"/>');
    expect(xml.match(/<p:pRg/g)?.length).toBe(2);
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(1);
  });

  it('animates a stepped image on a title-image layout (pulled out of addElements entirely)', async () => {
    // Regression: addTitleImageSlide never received stepTargets at all, so
    // its image rendered fully visible regardless of step.
    const xml = await slideXml(makeSlide(
      [{ type: 'image', src: PNG_DATA_URL, alt: '', step: 1 }],
      { layout: 'title-image' },
    ));
    expect(xml).toContain('<p:timing>');
    expect(xml).toMatch(/<p:spTgt spid="\d+"\/>/);
  });

  it('animates a stepped image on a split layout, on both sides of the split', async () => {
    // Regression: addSplitSlide threaded stepTargets through for its text
    // side (addElements) but never wired its own tryAddImage call for the
    // image side, on either side of the split.
    const imageOnRight = await slideXml(makeSlide(
      [
        { type: 'paragraph', text: 'Text first', html: 'Text first' },
        { type: 'image', src: PNG_DATA_URL, alt: '', step: 1 },
      ],
      { layout: 'split' },
    ));
    expect(imageOnRight).toContain('<p:timing>');
    expect(imageOnRight).toMatch(/<p:spTgt spid="\d+"\/>/);

    const imageOnLeft = await slideXml(makeSlide(
      [
        { type: 'image', src: PNG_DATA_URL, alt: '', step: 1 },
        { type: 'paragraph', text: 'Text second', html: 'Text second' },
      ],
      { layout: 'split' },
    ));
    expect(imageOnLeft).toContain('<p:timing>');
    expect(imageOnLeft).toMatch(/<p:spTgt spid="\d+"\/>/);
  });

  it('animates a stepped code block on a dedicated code layout', async () => {
    // Regression: addCodeSlide never passed step/stepTargets to addCodeBlock
    // even though addCodeBlock has fully supported both since the lone-code
    // fast path in addElements was extended.
    const xml = await slideXml(makeSlide(
      [{ type: 'code', lang: 'js', value: 'const x = 1;', step: 1 }],
      { layout: 'code' },
    ));
    expect(xml).toContain('<p:timing>');
  });

  it('keeps the existing fade slide-transition intact alongside the new timing tree', async () => {
    const xml = await slideXml(makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 1 },
    ]));
    expect(xml).toContain('<p:transition');
    expect(xml).toContain('<p:timing>');
  });

  // jsdom can't rasterise KaTeX/Mermaid to an image (no real canvas), so
  // resolveSlideImages' mermaidToDataUrl/mathToDataUrl always take the
  // "render failed" fallback branch here — which is exactly the branch these
  // two regressions live in.
  describe('math/mermaid render-failure fallback (jsdom cannot rasterise either)', () => {
    it('still animates a stepped display-math block via its plain-text fallback', async () => {
      // Regression: display math and Mermaid are pre-converted to `image`
      // elements when rasterisation succeeds, but that conversion dropped
      // `.step` entirely — a stepped formula/diagram would silently un-gate
      // itself the moment it became an image. Here rasterisation fails (jsdom),
      // so this instead exercises the *other* half of the same code path: the
      // original element's own `.step` must still flow into `startParagraph`.
      const xml = await slideXml(makeSlide([
        { type: 'math', value: 'E = mc^2', display: true, step: 1 },
      ]));
      expect(xml).toContain('<p:timing>');
      expect(xml).toContain('<p:pRg st="0" end="0"/>');
    });

    it('renders a Mermaid diagram as plain-text fallback instead of vanishing, and still animates it', async () => {
      // Regression: there was no `case 'mermaid'` in addElements' runs switch
      // at all — a diagram sharing a shape with other content silently
      // disappeared with nothing in its place whenever rasterisation failed,
      // unlike code/math's existing plain-text fallback.
      const xml = await slideXml(makeSlide([
        { type: 'paragraph', text: 'Intro', html: 'Intro' },
        { type: 'mermaid', value: 'flowchart LR\n  A --> B', step: 1 },
      ]));
      expect(xml).toContain('flowchart LR');
      expect(xml).toContain('<p:timing>');
      expect(xml).toContain('<p:pRg st="1" end="1"/>');
    });
  });
});
