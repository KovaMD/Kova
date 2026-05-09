import { describe, it, expect } from 'vitest';
import { detectLayout } from '../layout/autoLayout';
import type { SlideElement } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const para:    SlideElement = { type: 'paragraph', text: 'Hello', html: 'Hello' };
const list:    SlideElement = { type: 'list', ordered: false, items: [{ text: 'A', html: 'A', children: [] }] };
const img:     SlideElement = { type: 'image', src: 'img.png', alt: 'alt' };
const code:    SlideElement = { type: 'code', lang: 'js', value: 'const x = 1' };
const mermaid: SlideElement = { type: 'mermaid', value: 'pie title T\n"A":1' };
const bq:      SlideElement = { type: 'blockquote', text: 'Quote' };
const table:   SlideElement = { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] };
const youtube: SlideElement = { type: 'youtube', label: 'Vid', url: 'https://youtu.be/abc' };
const poll:    SlideElement = { type: 'poll', label: 'Vote', url: 'https://poll.io' };
const progress: SlideElement = { type: 'progress', label: 'Done', value: 75 };
const colBreak: SlideElement = { type: 'column-break' };

// ── Title slides ──────────────────────────────────────────────────────────────

describe('title layout', () => {
  it('H1 with no body → title', () => {
    expect(detectLayout([], 1, true)).toBe('title');
  });

  it('H1 with paragraph body → still title (subtitle)', () => {
    expect(detectLayout([para], 1, true)).toBe('title');
  });

  it('H1 with any content → always title', () => {
    expect(detectLayout([list, img], 1, true)).toBe('title');
  });
});

// ── Section slides ────────────────────────────────────────────────────────────

describe('section layout', () => {
  it('H2 with no body → section', () => {
    expect(detectLayout([], 2, true)).toBe('section');
  });

  it('H2 with body → NOT section', () => {
    expect(detectLayout([para], 2, true)).not.toBe('section');
  });

  it('H3 with no body → NOT section', () => {
    expect(detectLayout([], 3, true)).not.toBe('section');
  });
});

// ── Media layout ──────────────────────────────────────────────────────────────

describe('media layout', () => {
  it('youtube element → media', () => {
    expect(detectLayout([youtube], 2, true)).toBe('media');
  });

  it('poll element → media', () => {
    expect(detectLayout([poll], 2, true)).toBe('media');
  });

  it('youtube + poll together → media', () => {
    expect(detectLayout([youtube, poll], 2, true)).toBe('media');
  });

  it('media takes priority over column-break', () => {
    expect(detectLayout([youtube, colBreak, para], 2, true)).toBe('media');
  });
});

// ── Two-column layout ─────────────────────────────────────────────────────────

describe('two-column layout', () => {
  it('column-break → two-column', () => {
    expect(detectLayout([para, colBreak, list], 2, true)).toBe('two-column');
  });

  it('two-column takes priority over bsp', () => {
    expect(detectLayout([code, colBreak, mermaid], 2, true)).toBe('two-column');
  });
});

// ── Code-only layout ──────────────────────────────────────────────────────────

describe('code layout', () => {
  it('single code block → code', () => {
    expect(detectLayout([code], 2, true)).toBe('code');
  });

  it('single mermaid → code', () => {
    expect(detectLayout([mermaid], 2, true)).toBe('code');
  });

  it('code + mermaid together → code', () => {
    expect(detectLayout([code, mermaid], 2, true)).toBe('code');
  });

  it('code + paragraph → NOT code (should be bsp)', () => {
    expect(detectLayout([code, para], 2, true)).not.toBe('code');
  });
});

// ── No-title layouts ──────────────────────────────────────────────────────────

describe('no-title layouts', () => {
  it('no title + single image → full-bleed', () => {
    expect(detectLayout([img], 0, false)).toBe('full-bleed');
  });

  it('no title + single blockquote → quote', () => {
    expect(detectLayout([bq], 0, false)).toBe('quote');
  });

  it('no title + no elements → title (empty fallback)', () => {
    expect(detectLayout([], 0, false)).toBe('title');
  });

  it('no title + paragraph → title-content (not full-bleed)', () => {
    expect(detectLayout([para], 0, false)).not.toBe('full-bleed');
  });
});

// ── Image combination layouts ─────────────────────────────────────────────────

describe('image layouts', () => {
  it('title + single image → title-image', () => {
    expect(detectLayout([img], 2, true)).toBe('title-image');
  });

  it('title + image + list → split', () => {
    expect(detectLayout([img, list], 2, true)).toBe('split');
  });

  it('title + image + paragraph → split', () => {
    expect(detectLayout([img, para], 2, true)).toBe('split');
  });

  it('title + image + code → bsp (not split — code is not pure text)', () => {
    expect(detectLayout([img, code], 2, true)).toBe('bsp');
  });

  it('title + two images → bsp', () => {
    expect(detectLayout([img, img], 2, true)).toBe('bsp');
  });
});

// ── BSP layout ────────────────────────────────────────────────────────────────

describe('bsp layout', () => {
  it('mermaid + list → bsp', () => {
    expect(detectLayout([mermaid, list], 2, true)).toBe('bsp');
  });

  it('code + paragraph → bsp', () => {
    expect(detectLayout([code, para], 2, true)).toBe('bsp');
  });

  it('mermaid + list + code → bsp (3 diverse elements)', () => {
    expect(detectLayout([mermaid, list, code], 2, true)).toBe('bsp');
  });

  it('all-text (para + list) → NOT bsp', () => {
    expect(detectLayout([para, list], 2, true)).not.toBe('bsp');
  });

  it('table → NOT bsp (too wide)', () => {
    expect(detectLayout([table, para], 2, true)).not.toBe('bsp');
  });

  it('progress bars → NOT bsp (counted as pure text)', () => {
    expect(detectLayout([progress, progress], 2, true)).not.toBe('bsp');
  });

  it('4 diverse elements → NOT bsp (grid instead)', () => {
    expect(detectLayout([code, para, list, mermaid], 2, true)).not.toBe('bsp');
  });
});

// ── Grid layout ───────────────────────────────────────────────────────────────

describe('grid layout', () => {
  it('4 elements → grid', () => {
    expect(detectLayout([para, list, code, mermaid], 2, true)).toBe('grid');
  });

  it('5 elements → grid', () => {
    expect(detectLayout([para, list, code, mermaid, img], 2, true)).toBe('grid');
  });
});

// ── Default / title-content ───────────────────────────────────────────────────

describe('title-content layout (default)', () => {
  it('title + single paragraph → title-content', () => {
    expect(detectLayout([para], 2, true)).toBe('title-content');
  });

  it('title + list → title-content', () => {
    expect(detectLayout([list], 2, true)).toBe('title-content');
  });

  it('title + paragraph + list → title-content', () => {
    expect(detectLayout([para, list], 2, true)).toBe('title-content');
  });

  it('title + table → title-content', () => {
    expect(detectLayout([table], 2, true)).toBe('title-content');
  });

  it('title + table + para → title-content (table blocks bsp)', () => {
    expect(detectLayout([table, para], 2, true)).toBe('title-content');
  });
});

// ── Overflow guard ────────────────────────────────────────────────────────────

function makeList(count: number): SlideElement {
  return {
    type: 'list', ordered: false,
    items: Array.from({ length: count }, (_, i) => ({ text: `Item ${i + 1}`, html: `Item ${i + 1}`, children: [] })),
  };
}

describe('overflow guard', () => {
  it('short list stays title-content', () => {
    expect(detectLayout([makeList(5)], 2, true)).toBe('title-content');
  });

  it('long list (9 items) triggers two-column', () => {
    expect(detectLayout([makeList(9)], 2, true)).toBe('two-column');
  });

  it('long list (15 items) triggers two-column', () => {
    expect(detectLayout([makeList(15)], 2, true)).toBe('two-column');
  });

  it('long list without title also triggers two-column', () => {
    expect(detectLayout([makeList(12)], 0, false)).toBe('two-column');
  });

  it('table with many rows stays title-content (not pure text)', () => {
    expect(detectLayout([table], 2, true)).toBe('title-content');
  });
});
