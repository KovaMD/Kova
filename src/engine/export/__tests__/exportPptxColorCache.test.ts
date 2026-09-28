// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';

// cssColorToHex resolves each distinct colour string via a DOM
// append/getComputedStyle/remove round trip — a forced style recalc that's
// pure waste when the same 2-3 theme colours repeat across every slide in a
// deck. This is a fresh module instance for this test file (Vitest isolates
// modules per file), so the cache starts cold here regardless of what ran
// in other export test files.
function para(text: string): SlideElement {
  return { type: 'paragraph', text, html: text };
}

function makeSlide(index: number): Slide {
  return {
    index, raw: '', title: '', titleLevel: 0,
    elements: [para('body text')], speakerNotes: '', references: [],
    layout: 'title-content', hidden: false,
  };
}

describe('cssColorToHex caching', () => {
  it('resolves each distinct colour via getComputedStyle only once across a whole deck', async () => {
    const spy = vi.spyOn(window, 'getComputedStyle');
    // 12 slides, none with a per-slide colour override — every one resolves
    // the same theme text/heading/bold colours (3 distinct strings, or
    // fewer if some coincide). Without caching this call count scales with
    // slide count; with caching it's bounded by the distinct-colour count.
    const slides = Array.from({ length: 12 }, (_, i) => makeSlide(i));
    await exportToPptx(slides, {}, DEFAULT_THEME, 'en');

    const colorCalls = spy.mock.calls.length;
    expect(colorCalls).toBeGreaterThan(0); // sanity — the DOM path is actually exercised
    expect(colorCalls).toBeLessThan(12); // must not scale with slide count
    spy.mockRestore();
  });
});
