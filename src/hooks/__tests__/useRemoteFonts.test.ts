// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { RemoteFont } from '../../engine/theme';

// ── Fakes ────────────────────────────────────────────────────────────────────

const ipc = vi.hoisted(() => ({
  downloadAndCacheFont: vi.fn<(url: string, sha256: string) => Promise<string>>(),
}));
vi.mock('../../platform/ipc', () => ipc);

const core = vi.hoisted(() => ({ convertFileSrc: vi.fn((p: string) => `asset://${p}`) }));
vi.mock('@tauri-apps/api/core', () => core);

const fonts = vi.hoisted(() => ({ registerCachedFont: vi.fn() }));
vi.mock('../../engine/bundledFonts', () => fonts);

import { useRemoteFonts } from '../useRemoteFonts';

const inter: RemoteFont = { family: 'Inter', url: 'https://f.test/inter.woff2', sha256: 'aa', weight: '400', style: 'normal' } as RemoteFont;
const mono: RemoteFont = { family: 'Mono', url: 'https://f.test/mono.woff2', sha256: 'bb' } as RemoteFont;

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  ipc.downloadAndCacheFont.mockImplementation(async (url) => `/cache/${url.split('/').pop()}`);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('useRemoteFonts', () => {
  it('downloads and registers every remote font', async () => {
    renderHook(() => useRemoteFonts([inter, mono]));
    await waitFor(() => expect(fonts.registerCachedFont).toHaveBeenCalledTimes(2));
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledWith(inter.url, 'aa');
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledWith(mono.url, 'bb');
    expect(fonts.registerCachedFont).toHaveBeenCalledWith(
      'Inter', '/cache/inter.woff2', '400', 'normal', 'aa', core.convertFileSrc,
    );
  });

  it('does nothing for a theme without remote fonts', () => {
    renderHook(() => useRemoteFonts(undefined));
    renderHook(() => useRemoteFonts([]));
    expect(ipc.downloadAndCacheFont).not.toHaveBeenCalled();
  });

  it('downloads once while the fonts array is unchanged (AudienceApp default)', () => {
    const list = [inter];
    const { rerender } = renderHook(({ f }) => useRemoteFonts(f), { initialProps: { f: list } });
    rerender({ f: list });
    rerender({ f: list });
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledTimes(1);
    // A new array (a fresh present:init payload) re-runs the download.
    rerender({ f: [inter] });
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledTimes(2);
  });

  it('with rerunKey, downloads once per key even when the array identity changes (App)', () => {
    const { rerender } = renderHook(
      ({ f, k }) => useRemoteFonts(f, { rerunKey: k }),
      { initialProps: { f: [inter], k: 'theme-a' } },
    );
    rerender({ f: [inter], k: 'theme-a' });
    rerender({ f: [inter], k: 'theme-a' });
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledTimes(1);
    rerender({ f: [mono], k: 'theme-b' });
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledTimes(2);
    expect(ipc.downloadAndCacheFont).toHaveBeenLastCalledWith(mono.url, 'bb');
  });

  it('logs a failed download and still registers the others', async () => {
    ipc.downloadAndCacheFont.mockImplementation(async (url) => {
      if (url === inter.url) throw new Error('hash mismatch');
      return '/cache/mono.woff2';
    });
    renderHook(() => useRemoteFonts([inter, mono]));
    await waitFor(() => expect(warnSpy).toHaveBeenCalledWith('[kova] remote font "Inter" failed: Error: hash mismatch'));
    await waitFor(() => expect(fonts.registerCachedFont).toHaveBeenCalledTimes(1));
    expect(fonts.registerCachedFont.mock.calls[0][0]).toBe('Mono');
  });
});
