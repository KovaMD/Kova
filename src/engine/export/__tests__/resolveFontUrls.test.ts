// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn(async () => 'QUJD');
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...(args as [])) }));

import { resolveFontUrls } from '../exportPdfNative';

// Icons (and bundled theme fonts) went missing from Windows HTML/PDF exports
// because only tauri:// URLs were inlined (issue #272).
describe('resolveFontUrls', () => {
  // A jsdom Blob, which jsdom's FileReader can read (a Node Response's can't).
  const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['font'], { type: 'font/woff2' }) }));

  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockClear(); invoke.mockClear(); });

  const face = (url: string) => `@font-face { font-family: "Kova Icons"; src: url("${url}") format("woff2"); }`;

  it.each([
    ['macOS/Linux', 'tauri://localhost'],
    ['Windows', 'http://tauri.localhost'],
  ])('inlines the app\'s own fonts on %s', async (_platform, origin) => {
    const out = await resolveFontUrls(face(`${origin}/fonts/kova-icons.woff2`), origin);
    expect(fetchMock).toHaveBeenCalledWith(`${origin}/fonts/kova-icons.woff2`);
    expect(out).toContain('url("data:font/woff2;base64,');
    expect(out).not.toContain('/fonts/kova-icons.woff2');
  });

  it.each([
    ['macOS/Linux', 'asset://localhost/%2Fhome%2Fu%2Ffont.woff2', '//home/u/font.woff2'],
    ['Windows', 'http://asset.localhost/C%3A%5CUsers%5Cu%5Cfont.woff2', 'C:\\Users\\u\\font.woff2'],
  ])('reads cached theme fonts from disk on %s', async (_platform, url, path) => {
    const out = await resolveFontUrls(face(url), 'tauri://localhost');
    expect(invoke).toHaveBeenCalledWith('read_file_b64', { path });
    expect(out).toContain('url("data:font/woff2;base64,QUJD")');
  });

  it('leaves remote font URLs alone', async () => {
    const css = face('https://fonts.example.com/a.woff2');
    expect(await resolveFontUrls(css, 'http://tauri.localhost')).toBe(css);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
