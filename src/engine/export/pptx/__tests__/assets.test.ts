// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AssetLoader } from '../../../ports';
import { DEFAULT_THEME, type Theme } from '../../../theme';
import type { Slide, SlideElement } from '../../../types';
import { mermaidSvgCache } from '../../mermaidSvgCache';
import { svgToPngDataUrl } from '../../svgToPng';
import {
  assetUrlToDataUrl,
  fetchUrlToDataUrl,
  resolveImageSrcForExport,
  resolveSlideImages,
  resolveThemeLogo,
  videoExtnFromDataUrl,
  videoUrlToDataUrl,
} from '../assets';

// jsdom has no canvas, so the SVG -> PNG step is replaced; the Mermaid cache
// lookup and the element substitution around it are what these tests cover.
vi.mock('../../svgToPng', () => ({ svgToPngDataUrl: vi.fn() }));

// jsdom's Image never decodes, so onload would never fire. Load synchronously
// with a fixed 2:1 size so measured aspect ratios are predictable.
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 200;
  naturalHeight = 100;
  set src(_v: string) { this.onload?.(); }
}
let OriginalImage: typeof Image;
beforeAll(() => { OriginalImage = global.Image; (global as unknown as { Image: unknown }).Image = StubImage; });
afterAll(() => { (global as unknown as { Image: unknown }).Image = OriginalImage; });

// In-memory AssetLoader fake: local files and remote URLs are looked up in
// maps; anything missing rejects, as the real Tauri commands do.
function fakeLoader(
  files: Record<string, string> = {},
  urls: Record<string, [string, string]> = {},
) {
  const readFileB64 = vi.fn(async (path: string) => {
    if (path in files) return files[path];
    throw new Error(`no such file: ${path}`);
  });
  const fetchUrlB64 = vi.fn(async (url: string) => {
    if (url in urls) return urls[url];
    throw new Error(`fetch failed: ${url}`);
  });
  const assets: AssetLoader = { readFileB64, fetchUrlB64 };
  return { assets, readFileB64, fetchUrlB64 };
}

function makeSlide(elements: SlideElement[], extra: Partial<Slide> = {}): Slide {
  return {
    index: 0, raw: '', title: 'T', titleLevel: 2,
    elements, speakerNotes: '', references: [], layout: 'title-content', hidden: false,
    ...extra,
  };
}

describe('assetUrlToDataUrl', () => {
  it('reads asset:// files through the loader with a decoded path and image MIME', async () => {
    const { assets, readFileB64 } = fakeLoader({ '/home/me/my pic.jpg': 'SlBH' });
    const out = await assetUrlToDataUrl('asset://localhost/home/me/my%20pic.jpg', assets);
    expect(readFileB64).toHaveBeenCalledWith('/home/me/my pic.jpg');
    expect(out).toBe('data:image/jpeg;base64,SlBH');
  });

  it('returns the original src when the loader rejects', async () => {
    const { assets } = fakeLoader();
    const src = 'asset://localhost/missing.png';
    expect(await assetUrlToDataUrl(src, assets)).toBe(src);
  });
});

describe('fetchUrlToDataUrl', () => {
  it('uses the MIME type reported by the loader', async () => {
    const { assets } = fakeLoader({}, { 'https://x.example/a': ['QUJD', 'image/webp'] });
    expect(await fetchUrlToDataUrl('https://x.example/a', assets)).toBe('data:image/webp;base64,QUJD');
  });

  it('returns the URL unchanged when the fetch fails', async () => {
    const { assets } = fakeLoader();
    expect(await fetchUrlToDataUrl('https://x.example/b', assets)).toBe('https://x.example/b');
  });
});

describe('resolveImageSrcForExport', () => {
  it('routes asset:// to a file read and https:// to a native fetch', async () => {
    const { assets, readFileB64, fetchUrlB64 } = fakeLoader(
      { '/a.gif': 'R0lG' },
      { 'https://x.example/c.png': ['UE5H', 'image/png'] },
    );
    expect(await resolveImageSrcForExport('asset://localhost/a.gif', assets)).toBe('data:image/gif;base64,R0lG');
    expect(await resolveImageSrcForExport('https://x.example/c.png', assets)).toBe('data:image/png;base64,UE5H');
    expect(readFileB64).toHaveBeenCalledTimes(1);
    expect(fetchUrlB64).toHaveBeenCalledTimes(1);
  });

  it('passes data: and relative sources through without touching the loader', async () => {
    const { assets, readFileB64, fetchUrlB64 } = fakeLoader();
    expect(await resolveImageSrcForExport('data:image/png;base64,AA', assets)).toBe('data:image/png;base64,AA');
    expect(await resolveImageSrcForExport('img/x.png', assets)).toBe('img/x.png');
    expect(readFileB64).not.toHaveBeenCalled();
    expect(fetchUrlB64).not.toHaveBeenCalled();
  });
});

describe('videoUrlToDataUrl', () => {
  it('reads asset:// videos with a video MIME type', async () => {
    const { assets } = fakeLoader({ '/v/clip.webm': 'V0VC' });
    expect(await videoUrlToDataUrl('asset://localhost/v/clip.webm', assets)).toBe('data:video/webm;base64,V0VC');
  });

  it('fetches remote videos natively', async () => {
    const { assets } = fakeLoader({}, { 'https://x.example/v.mp4': ['TVA0', 'video/mp4'] });
    expect(await videoUrlToDataUrl('https://x.example/v.mp4', assets)).toBe('data:video/mp4;base64,TVA0');
  });

  it('leaves data: URLs, unknown schemes and failed reads unchanged', async () => {
    const { assets } = fakeLoader();
    expect(await videoUrlToDataUrl('data:video/mp4;base64,AA', assets)).toBe('data:video/mp4;base64,AA');
    expect(await videoUrlToDataUrl('clip.mp4', assets)).toBe('clip.mp4');
    expect(await videoUrlToDataUrl('asset://localhost/gone.mp4', assets)).toBe('asset://localhost/gone.mp4');
  });
});

describe('videoExtnFromDataUrl', () => {
  it.each([
    ['data:video/webm;base64,AA', 'webm'],
    ['data:video/quicktime;base64,AA', 'mov'],
    ['data:video/ogg;base64,AA', 'ogv'],
    ['data:video/x-m4v;base64,AA', 'm4v'],
    ['data:video/x-matroska;base64,AA', 'mkv'],
    ['data:video/mp4;base64,AA', 'mp4'],
    ['not-a-data-url', 'mp4'],
  ])('%s -> %s', (url, extn) => {
    expect(videoExtnFromDataUrl(url)).toBe(extn);
  });
});

describe('resolveThemeLogo', () => {
  it('resolves a local logo and measures its aspect ratio', async () => {
    const { assets } = fakeLoader({ '/logo.png': 'TE9H' });
    const theme: Theme = { ...DEFAULT_THEME, logo: 'asset://localhost/logo.png' };
    expect(await resolveThemeLogo(theme, assets)).toEqual({ logoDataUrl: 'data:image/png;base64,TE9H', logoAr: 2 });
  });

  it('yields no logo when the theme has none or it cannot be read', async () => {
    const { assets } = fakeLoader();
    expect(await resolveThemeLogo({ ...DEFAULT_THEME, logo: undefined }, assets)).toEqual({ logoDataUrl: null, logoAr: null });
    expect(await resolveThemeLogo({ ...DEFAULT_THEME, logo: 'asset://localhost/x.png' }, assets))
      .toEqual({ logoDataUrl: null, logoAr: null });
  });
});

describe('resolveSlideImages', () => {
  beforeEach(() => { vi.mocked(svgToPngDataUrl).mockReset(); });

  it('resolves image, video and background sources through the loader', async () => {
    const { assets } = fakeLoader(
      { '/i.png': 'SU1H', '/v.mov': 'TU9W', '/bg.jpg': 'Qkc=' },
    );
    const slide = makeSlide(
      [
        { type: 'image', src: 'asset://localhost/i.png', alt: 'i' },
        { type: 'video', label: 'v', src: 'asset://localhost/v.mov' },
      ],
      { backgroundImage: { src: 'asset://localhost/bg.jpg', size: 'contain' } as Slide['backgroundImage'] },
    );
    const warnings: string[] = [];
    const [out] = await resolveSlideImages([slide], DEFAULT_THEME, warnings, assets);
    expect(out.elements[0]).toMatchObject({ type: 'image', src: 'data:image/png;base64,SU1H', title: '2' });
    expect(out.elements[1]).toMatchObject({ type: 'video', src: 'data:video/quicktime;base64,TU9W' });
    expect(out.backgroundImage).toMatchObject({ src: 'data:image/jpeg;base64,Qkc=', aspectRatio: 2 });
    expect(warnings).toEqual([]);
  });

  it('keeps the original image src and title when the loader fails', async () => {
    const { assets } = fakeLoader();
    const el: SlideElement = { type: 'image', src: 'asset://localhost/gone.png', alt: 'g', title: 'kept' };
    const [out] = await resolveSlideImages([makeSlide([el])], DEFAULT_THEME, [], assets);
    expect(out.elements[0]).toEqual(el);
  });

  it('swaps a cached Mermaid diagram for an image, carrying step and caption', async () => {
    const { assets } = fakeLoader();
    const source = 'graph LR; assets-test-a-->b';
    mermaidSvgCache.set(source, '<svg/>');
    vi.mocked(svgToPngDataUrl).mockResolvedValue({ dataUrl: 'data:image/png;base64,TUVS', aspectRatio: 1.5 });
    const el = { type: 'mermaid', value: source, caption: 'Flow', step: 2 } as SlideElement;
    const [out] = await resolveSlideImages([makeSlide([el])], DEFAULT_THEME, [], assets);
    expect(out.elements[0]).toEqual({
      type: 'image', src: 'data:image/png;base64,TUVS', alt: 'Diagram', title: '1.5', caption: 'Flow', step: 2,
    });
  });

  it('warns and keeps the Mermaid element when rendering fails', async () => {
    const { assets } = fakeLoader();
    const source = 'graph LR; assets-test-c-->d';
    mermaidSvgCache.set(source, '<svg/>');
    vi.mocked(svgToPngDataUrl).mockRejectedValue(new Error('no canvas'));
    const el = { type: 'mermaid', value: source } as SlideElement;
    const warnings: string[] = [];
    const [out] = await resolveSlideImages([makeSlide([el])], DEFAULT_THEME, warnings, assets);
    expect(out.elements[0]).toBe(el);
    expect(warnings).toEqual(['Mermaid diagram could not be rendered and was skipped (slide: "T")']);
  });
});
