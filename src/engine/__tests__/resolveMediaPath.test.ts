import { describe, it, expect } from 'vitest';
import { resolveImageSrc, resolveHtmlSrcs, localPathFromMediaSrc } from '../resolveMediaPath';

// The asset-URL converter is injected, so no Tauri mock is needed.
const toAssetUrl = (p: string) => `asset://localhost/${encodeURIComponent(p)}`;

describe('resolveImageSrc', () => {
  it('prefers a loaded data URL for local media', () => {
    const urls = new Map([['/docs/img/a.png', 'data:image/png;base64,AA']]);
    expect(resolveImageSrc('img/a.png', '/docs', urls, toAssetUrl)).toBe('data:image/png;base64,AA');
  });

  it('falls back to the injected asset URL while the load is in flight', () => {
    expect(resolveImageSrc('img/a.png', '/docs', new Map(), toAssetUrl))
      .toBe(toAssetUrl('/docs/img/a.png'));
  });

  it('normalises Windows separators before converting', () => {
    expect(resolveImageSrc('C:\\deck\\a.png', '', new Map(), toAssetUrl)).toBe(toAssetUrl('C:/deck/a.png'));
  });

  it('passes web and asset URLs through untouched', () => {
    expect(resolveImageSrc('https://x.test/a.png', '/docs', new Map(), toAssetUrl)).toBe('https://x.test/a.png');
    expect(resolveImageSrc('asset://localhost/a.png', '/docs', new Map(), toAssetUrl)).toBe('asset://localhost/a.png');
  });

  it('passes data: URLs through untouched (they have no //)', () => {
    const svg = 'data:image/svg+xml,%3Csvg%2F%3E';
    expect(resolveImageSrc(svg, '/docs', new Map(), toAssetUrl)).toBe(svg);
    expect(localPathFromMediaSrc('data:image/png;base64,AA', '/docs')).toBeNull();
  });

  it('returns a relative src as-is when there is no document dir', () => {
    expect(resolveImageSrc('notes.txt', '', new Map(), toAssetUrl)).toBe('notes.txt');
  });
});

describe('resolveHtmlSrcs', () => {
  it('rewrites every src attribute through the converter', () => {
    expect(resolveHtmlSrcs('<img src="a.png"><img src="https://x/b.png">', '/d', new Map(), toAssetUrl))
      .toBe(`<img src="${toAssetUrl('/d/a.png')}"><img src="https://x/b.png">`);
  });
});

describe('localPathFromMediaSrc', () => {
  it('ignores URLs and unsupported extensions, and strips query strings', () => {
    expect(localPathFromMediaSrc('asset://localhost/a.png', '/d')).toBeNull();
    expect(localPathFromMediaSrc('a.txt', '/d')).toBeNull();
    expect(localPathFromMediaSrc('a.png?x=1', '/d')).toBe('/d/a.png');
  });
});
