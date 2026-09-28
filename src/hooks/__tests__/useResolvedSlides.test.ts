// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const invokeMock = vi.fn(async (cmd: string, args?: { path?: string }) => {
  if (cmd === 'read_file_b64') return `base64-${args?.path}`;
  return null;
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: { path?: string }) => invokeMock(cmd, args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

const { useResolvedSlides } = await import('../useResolvedSlides');
import type { Slide } from '../../engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSlide(index: number, imageSrc: string | null): Slide {
  return {
    index,
    raw: `slide ${index}`,
    title: '',
    titleLevel: 0,
    elements: imageSrc ? [{ type: 'image', src: imageSrc, alt: '' }] : [],
    speakerNotes: '',
    references: [],
    layout: 'title-content',
    hidden: false,
  };
}

let container: HTMLDivElement;
let root: Root;
let latest: Slide[] | undefined;

function Harness({ rawSlides, docDir }: { rawSlides: Slide[]; docDir: string }) {
  latest = useResolvedSlides(rawSlides, docDir);
  return null;
}

function render(rawSlides: Slide[], docDir = '/docs') {
  act(() => { root.render(createElement(Harness, { rawSlides, docDir })); });
}

async function flush() {
  // Let the effect's invoke() promise and its .then() state update settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  invokeMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  latest = undefined;
});

describe('useResolvedSlides', () => {
  it('fetches a referenced local image once and resolves its src to the data URL', async () => {
    render([makeSlide(0, 'pic.png')]);
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('read_file_b64', { path: '/docs/pic.png' });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const img = latest![0].elements[0];
    expect(img).toMatchObject({ type: 'image', src: 'data:image/png;base64,base64-/docs/pic.png' });
  });

  it('does not re-fetch an already-resolved path on a re-render with a fresh array (simulating a keystroke)', async () => {
    render([makeSlide(0, 'pic.png')]);
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Fresh Slide objects, same content — exactly what parseDocument produces
    // on every keystroke even when nothing media-related changed.
    render([makeSlide(0, 'pic.png')]);
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('only fetches the newly-added path when a second image is introduced', async () => {
    render([makeSlide(0, 'pic.png')]);
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    render([makeSlide(0, 'pic.png'), makeSlide(1, 'other.png')]);
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('read_file_b64', { path: '/docs/other.png' });
    // The first slide's image is still resolved correctly from cache.
    expect(latest![0].elements[0]).toMatchObject({ src: 'data:image/png;base64,base64-/docs/pic.png' });
  });

  it('a path dropping to zero references and coming back refetches just that one path, not everything', async () => {
    render([makeSlide(0, 'pic.png')]);
    await flush();
    render([makeSlide(0, null)]); // image removed — the document has zero local media for a moment
    await flush();
    render([makeSlide(0, 'pic.png')]); // same path referenced again
    await flush();
    // One refetch when it comes back (the whole-document-has-no-media case
    // resets the cache, rather than tracking per-path survival across zero
    // references) — still just the one path, not a full-document re-scan.
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('read_file_b64', { path: '/docs/pic.png' });
  });
});
