// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide } from '../../types';

// B1: the preview, PDF and presenter honour `aspect_ratio: 16:10` via
// parseAspectRatio, so the PPTX export must too (10 in x 6.25 in).

function makeSlide(): Slide {
  return {
    index: 0, raw: '', title: 'Aspect', titleLevel: 2,
    elements: [{ type: 'paragraph', text: 'Body', html: 'Body' }],
    speakerNotes: '', references: [], layout: 'title-content', hidden: false,
  };
}

async function slideSize(aspect_ratio?: string): Promise<{ cx: string; cy: string }> {
  const res = await exportToPptx([makeSlide()], aspect_ratio ? { aspect_ratio } : {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/presentation.xml')!.async('string');
  const m = xml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  expect(m).not.toBeNull();
  return { cx: m![1], cy: m![2] };
}

describe('exportPptx slide size per aspect ratio (B1)', () => {
  it('exports a 16:10 deck at 10 x 6.25 in', async () => {
    expect(await slideSize('16:10')).toEqual({ cx: '9144000', cy: '5715000' });
  });

  it('exports a 16:9 deck at 10 x 5.625 in', async () => {
    expect(await slideSize('16:9')).toEqual({ cx: '9144000', cy: '5143500' });
    expect(await slideSize()).toEqual({ cx: '9144000', cy: '5143500' });
  });

  it('exports a 4:3 deck at 10 x 7.5 in', async () => {
    expect(await slideSize('4:3')).toEqual({ cx: '9144000', cy: '6858000' });
  });
});
