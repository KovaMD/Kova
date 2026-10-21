// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';

// Body text used to go out at a fixed 18pt with only PowerPoint's "shrink on
// overflow" flag, which PowerPoint applies on first edit rather than on open —
// so a dense slide opened with its text running off the bottom (issue #272).
// addElements now pre-scales the runs to fit. See fitRunsScale().

function makeSlide(elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: 'Icons', titleLevel: 2,
    elements, speakerNotes: '', references: [], layout: 'title-content', hidden: false,
  };
}

function list(n: number, text: (i: number) => string): SlideElement {
  return {
    type: 'list', ordered: false,
    items: Array.from({ length: n }, (_, i) => ({ html: text(i), text: text(i), children: [] })),
  } as unknown as SlideElement;
}

async function slideOut(slide: Slide): Promise<{ xml: string; warnings: string[] }> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return { xml, warnings: res.warnings };
}

/** Font sizes (pt) of the shape holding `marker`. */
function shapeFontSizes(xml: string, marker: string): number[] {
  const sp = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).find((s) => s.includes(marker));
  if (!sp) throw new Error(`no shape containing "${marker}"`);
  return [...sp.matchAll(/sz="(\d+)"/g)].map((m) => Number(m[1]) / 100);
}

describe('exportPptx body text auto-fit', () => {
  it('leaves a short list at full size', async () => {
    const { xml, warnings } = await slideOut(makeSlide([list(3, (i) => `Point ${i}`)]));
    expect(new Set(shapeFontSizes(xml, 'Point 0'))).toEqual(new Set([18]));
    expect(warnings).toEqual([]);
  });

  it('scales a dense list down so it fits the slide', async () => {
    const { xml, warnings } = await slideOut(
      makeSlide([list(16, (i) => `Item ${i}: a moderately long bullet that will wrap at full size`)]),
    );
    const sizes = shapeFontSizes(xml, 'Item 0');
    expect(Math.max(...sizes)).toBeLessThan(18);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9);
    expect(warnings).toEqual([]);
  });

  it('warns when even the minimum scale cannot fit', async () => {
    const { xml, warnings } = await slideOut(
      makeSlide([list(80, (i) => `Line ${i} with some text that keeps on going and going`)]),
    );
    expect(Math.min(...shapeFontSizes(xml, 'Line 0'))).toBe(9);
    expect(warnings.some((w) => w.startsWith('Text too long for the slide'))).toBe(true);
  });
});
