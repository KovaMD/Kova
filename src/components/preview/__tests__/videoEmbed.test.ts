// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { VideoEmbed } from '../elements';
import { SlideCtx } from '../slideContext';
import { resolveVideoPlaceholders } from '../../../engine/export/exportPdfNative';

// Regression guard for issue #253: WebKitGTK builds its GStreamer pipeline as
// soon as a <video> with a src mounts, regardless of preload, and crashes the
// whole web process on systems missing an audio sink. So rendering a !video
// slide must never mount a <video>; only an explicit click on play may.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const embed = { type: 'video' as const, src: 'asset://localhost/demo.mp4', label: 'Demo' };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ctx: Record<string, unknown>, e = embed) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(SlideCtx.Provider, { value: ctx as never }, createElement(VideoEmbed, { embed: e })));
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('VideoEmbed (issue #253)', () => {
  it('renders a placeholder, not a <video>, until play is clicked', () => {
    const el = render({ isThumbnail: false });
    expect(el.querySelector('video')).toBeNull();
    const ph = el.querySelector<HTMLButtonElement>('.sl-video__placeholder')!;
    expect(ph.dataset.videoSrc).toBe(embed.src);

    act(() => ph.click());
    const vid = el.querySelector('video')!;
    expect(vid.getAttribute('src')).toBe(embed.src);
    expect(el.querySelector('.sl-video__placeholder')).toBeNull();
  });

  it('never mounts a <video> in a thumbnail', () => {
    const el = render({ isThumbnail: true });
    const ph = el.querySelector<HTMLButtonElement>('.sl-video__placeholder')!;
    expect(ph.disabled).toBe(true);
    act(() => ph.click());
    expect(el.querySelector('video')).toBeNull();
  });

  it('drops back to the placeholder when the src changes', () => {
    const el = render({ isThumbnail: false });
    act(() => el.querySelector<HTMLButtonElement>('.sl-video__placeholder')!.click());
    act(() => {
      root!.render(createElement(SlideCtx.Provider, { value: { isThumbnail: false } as never },
        createElement(VideoEmbed, { embed: { ...embed, src: 'asset://localhost/other.mp4' } })));
    });
    expect(el.querySelector('video')).toBeNull();
  });
});

describe('resolveVideoPlaceholders', () => {
  it('swaps each placeholder for a real player for the interactive HTML deck', () => {
    const el = document.createElement('div');
    el.innerHTML = `<div class="sl-video"><button class="sl-video__placeholder" data-video-src="${embed.src}"></button></div>`;
    resolveVideoPlaceholders(el);
    expect(el.querySelector('.sl-video__placeholder')).toBeNull();
    const vid = el.querySelector('video')!;
    expect(vid.className).toBe('sl-video__player');
    expect(vid.getAttribute('src')).toBe(embed.src);
    expect(vid.hasAttribute('controls')).toBe(true);
  });
});
