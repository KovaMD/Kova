// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';
import type { AssetLoader } from '../../ports';

// Tiny valid-enough data URL so pptxgenjs accepts addMedia(type: 'video').
const TINY_MP4 =
  'data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAA';

function makeSlide(layout: Slide['layout'], elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0,
    elements, speakerNotes: '', references: [], layout, hidden: false,
  };
}

async function loadZip(slide: Slide): Promise<JSZip> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  return JSZip.loadAsync(res.base64, { base64: true });
}

describe('exportPptx real media embeds (issue #219)', () => {
  it('embeds YouTube as an online media relationship on a media slide', async () => {
    const slide = makeSlide('media', [
      { type: 'youtube', label: 'Talk', url: 'https://youtu.be/dQw4w9WgXcQ' },
    ]);
    const zip = await loadZip(slide);
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(rels).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(rels).toContain('TargetMode="External"');
  });

  it('embeds YouTube when mixed with other content under a layout override', async () => {
    const slide = makeSlide('title-content', [
      { type: 'paragraph', text: 'intro', html: 'intro' },
      { type: 'youtube', label: 'Demo', url: 'https://www.youtube.com/watch?v=abc123XYZ_-' },
    ]);
    const zip = await loadZip(slide);
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(rels).toContain('https://www.youtube.com/embed/abc123XYZ_-');
  });

  it('embeds a data: video into ppt/media', async () => {
    const slide = makeSlide('media', [
      { type: 'video', label: 'Clip', src: TINY_MP4 },
    ]);
    const zip = await loadZip(slide);
    const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && f.endsWith('.mp4'));
    expect(media.length).toBeGreaterThanOrEqual(1);
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(rels).toMatch(/relationships\/video/);
  });

  it('embeds a local asset:// video read through the injected AssetLoader', async () => {
    // In-memory fake: no Tauri, no installed ports.
    const reads: string[] = [];
    const assets: AssetLoader = {
      readFileB64: async (path) => { reads.push(path); return TINY_MP4.split(',')[1]; },
      fetchUrlB64: async () => { throw new Error('unexpected fetch'); },
    };
    const slide = makeSlide('media', [
      { type: 'video', label: 'Local', src: 'asset://localhost/clips/demo%20one.mp4' },
    ]);
    const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en', assets);
    expect(reads).toEqual(['/clips/demo one.mp4']);
    expect(res.warnings).toEqual([]);
    const zip = await JSZip.loadAsync(res.base64, { base64: true });
    const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && f.endsWith('.mp4'));
    expect(media.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to a text placeholder when the YouTube URL has no id', async () => {
    const slide = makeSlide('media', [
      { type: 'youtube', label: 'Broken', url: 'https://example.com/not-youtube' },
    ]);
    const zip = await loadZip(slide);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('Broken');
    expect(xml).toContain('example.com/not-youtube');
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(rels).not.toContain('youtube.com/embed');
  });
});
