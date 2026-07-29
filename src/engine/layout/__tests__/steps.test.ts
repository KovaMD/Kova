import { describe, it, expect } from 'vitest';
import { getSlideStepValues, getSlideStepCount } from '../steps';
import type { Slide, SlideElement, ListItem } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlide(elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0, elements,
    speakerNotes: '', references: [], layout: 'title-content', hidden: false,
  };
}

function item(text: string, step?: number, children: ListItem[] = []): ListItem {
  return { text, html: text, step, children };
}

// ── getSlideStepValues / getSlideStepCount ───────────────────────────────────

describe('getSlideStepValues', () => {
  it('returns an empty array when nothing on the slide has a step', () => {
    const slide = makeSlide([{ type: 'paragraph', text: 'Hi', html: 'Hi' }]);
    expect(getSlideStepValues(slide)).toEqual([]);
  });

  it('collects distinct values from top-level elements, ascending', () => {
    const slide = makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 2 },
      { type: 'image', src: 'x.png', alt: '', step: 1 },
    ]);
    expect(getSlideStepValues(slide)).toEqual([1, 2]);
  });

  it('is a count of distinct values, not a dense range — sparse explicit numbers do not force phantom clicks', () => {
    const slide = makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 9 },
      { type: 'paragraph', text: 'B', html: 'B', step: 2 },
      { type: 'paragraph', text: 'C', html: 'C', step: 5 },
    ]);
    expect(getSlideStepValues(slide)).toEqual([2, 5, 9]);
    expect(getSlideStepCount(slide)).toBe(3);
  });

  it('deduplicates a value used by multiple elements (explicit grouping)', () => {
    const slide = makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 1 },
      { type: 'paragraph', text: 'B', html: 'B', step: 1 },
    ]);
    expect(getSlideStepValues(slide)).toEqual([1]);
    expect(getSlideStepCount(slide)).toBe(1);
  });

  it('walks list items, including nested children', () => {
    const slide = makeSlide([
      { type: 'list', ordered: false, items: [
        item('Parent', 1, [item('Child', 2)]),
        item('Sibling', undefined),
      ] },
    ]);
    expect(getSlideStepValues(slide)).toEqual([1, 2]);
  });

  it('ignores a column-break, which never carries a step', () => {
    const slide = makeSlide([
      { type: 'paragraph', text: 'A', html: 'A', step: 1 },
      { type: 'column-break' },
    ]);
    expect(getSlideStepValues(slide)).toEqual([1]);
  });
});
