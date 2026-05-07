import { describe, it, expect } from 'vitest';
import { parseDocument } from '../parser/markdownToSlides';

// ── Helpers ───────────────────────────────────────────────────────────────────

function doc(body: string) {
  return `---\ntitle: Test\n---\n\n${body}`;
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

describe('frontmatter', () => {
  it('extracts title and author', () => {
    const { frontmatter } = parseDocument('---\ntitle: Hello\nauthor: Ross\n---\n\n# Slide\n');
    expect(frontmatter.title).toBe('Hello');
    expect(frontmatter.author).toBe('Ross');
  });

  it('returns empty frontmatter when absent', () => {
    const { frontmatter } = parseDocument('# Just a slide\n');
    expect(frontmatter).toEqual({});
  });

  it('parses aspect_ratio', () => {
    const { frontmatter } = parseDocument('---\naspect_ratio: "4:3"\n---\n\n# Slide\n');
    expect(frontmatter.aspect_ratio).toBe('4:3');
  });

  it('handles malformed YAML gracefully', () => {
    const { frontmatter } = parseDocument('---\n: bad: yaml:\n---\n\n# Slide\n');
    expect(frontmatter).toEqual({});
  });
});

// ── CRLF normalisation ────────────────────────────────────────────────────────

describe('CRLF normalisation', () => {
  it('splits slides correctly with CRLF line endings', () => {
    const raw = '---\r\ntitle: Test\r\n---\r\n\r\n# Slide 1\r\n\r\n---\r\n\r\n## Slide 2\r\n';
    const { slides } = parseDocument(raw);
    expect(slides).toHaveLength(2);
    expect(slides[0].title).toBe('Slide 1');
    expect(slides[1].title).toBe('Slide 2');
  });
});

// ── Slide splitting ───────────────────────────────────────────────────────────

describe('slide splitting', () => {
  it('produces one slide per --- separator', () => {
    const { slides } = parseDocument(doc('# A\n\n---\n\n## B\n\n---\n\n## C\n'));
    expect(slides).toHaveLength(3);
  });

  it('ignores the frontmatter --- delimiters', () => {
    const { slides } = parseDocument('---\ntitle: T\n---\n\n# Only one slide\n');
    expect(slides).toHaveLength(1);
  });

  it('filters out empty slide chunks', () => {
    const { slides } = parseDocument(doc('# A\n\n---\n\n---\n\n## B\n'));
    // the empty segment between the two --- is filtered
    expect(slides.every((s) => s.title !== '')).toBe(true);
  });
});

// ── Slide titles ──────────────────────────────────────────────────────────────

describe('slide titles', () => {
  it('captures H1 as title with level 1', () => {
    const { slides } = parseDocument('# Hero Title\n');
    expect(slides[0].title).toBe('Hero Title');
    expect(slides[0].titleLevel).toBe(1);
  });

  it('captures H2 as title with level 2', () => {
    const { slides } = parseDocument('## Section\n');
    expect(slides[0].title).toBe('Section');
    expect(slides[0].titleLevel).toBe(2);
  });

  it('returns empty title for a slide with no heading', () => {
    const { slides } = parseDocument('Just a paragraph\n');
    expect(slides[0].title).toBe('');
    expect(slides[0].titleLevel).toBe(0);
  });

  it('treats second heading as a paragraph element', () => {
    const { slides } = parseDocument('## Main\n\n### Sub\n\nBody text\n');
    const elTypes = slides[0].elements.map((e) => e.type);
    expect(elTypes).toContain('paragraph');
  });
});

// ── Element types ─────────────────────────────────────────────────────────────

describe('element parsing', () => {
  it('parses bullet list', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Alpha\n- Beta\n- Gamma\n'));
    const list = slides[0].elements.find((e) => e.type === 'list');
    expect(list).toBeTruthy();
    if (list?.type === 'list') {
      expect(list.items).toHaveLength(3);
      expect(list.items[0].text).toBe('Alpha');
    }
  });

  it('parses ordered list', () => {
    const { slides } = parseDocument(doc('## Slide\n\n1. First\n2. Second\n'));
    const list = slides[0].elements.find((e) => e.type === 'list');
    expect(list?.type === 'list' && list.ordered).toBe(true);
  });

  it('parses nested list items', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Parent\n  - Child\n'));
    const list = slides[0].elements.find((e) => e.type === 'list');
    if (list?.type === 'list') {
      expect(list.items[0].children).toHaveLength(1);
      expect(list.items[0].children[0].text).toBe('Child');
    }
  });

  it('parses standalone image', () => {
    const { slides } = parseDocument(doc('## Slide\n\n![alt](img.png)\n'));
    const img = slides[0].elements.find((e) => e.type === 'image');
    expect(img?.type === 'image' && img.src).toBe('img.png');
    expect(img?.type === 'image' && img.alt).toBe('alt');
  });

  it('parses fenced code block', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```python\nprint("hi")\n```\n'));
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(code?.type === 'code' && code.lang).toBe('python');
    expect(code?.type === 'code' && code.value).toContain('print');
  });

  it('parses mermaid block as mermaid element (not code)', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```mermaid\npie title T\n  "A" : 50\n```\n'));
    const mermaid = slides[0].elements.find((e) => e.type === 'mermaid');
    expect(mermaid).toBeTruthy();
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(code).toBeUndefined();
  });

  it('parses blockquote', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> Great words here\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.text).toContain('Great words');
  });

  it('parses blockquote with attribution', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> The quote text\n> — The Author\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.attribution).toBe('The Author');
  });

  it('parses GFM table', () => {
    const { slides } = parseDocument(doc('## Slide\n\n| A | B |\n|---|---|\n| 1 | 2 |\n'));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.headers).toEqual(['A', 'B']);
    expect(table?.type === 'table' && table.rows[0]).toEqual(['1', '2']);
  });

  it('discards whitespace-only paragraphs', () => {
    const { slides } = parseDocument(doc('## Slide\n\n   \n\n- Item\n'));
    const paras = slides[0].elements.filter((e) => e.type === 'paragraph');
    expect(paras).toHaveLength(0);
  });
});

// ── Inline formatting ─────────────────────────────────────────────────────────

describe('inline HTML generation', () => {
  it('converts bold to <strong>', () => {
    const { slides } = parseDocument(doc('## Slide\n\nThis is **bold** text.\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<strong>bold</strong>');
  });

  it('converts italic to <em>', () => {
    const { slides } = parseDocument(doc('## Slide\n\nThis is *italic* text.\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<em>italic</em>');
  });

  it('escapes HTML entities in text nodes', () => {
    const { slides } = parseDocument(doc('## Slide\n\n1 < 2 & 3 > 0\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('&lt;');
    expect(para?.type === 'paragraph' && para.html).toContain('&amp;');
  });

  it('blocks javascript: URLs', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[click](javascript:alert(1))\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('href="#"');
  });

  it('blocks vbscript: URLs', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[click](vbscript:evil())\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('href="#"');
  });

  it('allows normal https URLs', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[site](https://example.com)\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('https://example.com');
  });

  it('renders soft line breaks as <br>', () => {
    const { slides } = parseDocument(doc('## Slide\n\nLine one\nLine two\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<br>');
  });
});

// ── Custom syntax ─────────────────────────────────────────────────────────────

describe('custom syntax pre-processor', () => {
  it('parses !youtube', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!youtube[My Video](https://youtu.be/abc123)\n'));
    const yt = slides[0].elements.find((e) => e.type === 'youtube');
    expect(yt?.type === 'youtube' && yt.label).toBe('My Video');
    expect(yt?.type === 'youtube' && yt.url).toBe('https://youtu.be/abc123');
  });

  it('parses !poll', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!poll[Vote here](https://pollev.com/xyz)\n'));
    const poll = slides[0].elements.find((e) => e.type === 'poll');
    expect(poll?.type === 'poll' && poll.label).toBe('Vote here');
  });

  it('parses !progress with integer value', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!progress[Done](75)\n'));
    const prog = slides[0].elements.find((e) => e.type === 'progress');
    expect(prog?.type === 'progress' && prog.value).toBe(75);
    expect(prog?.type === 'progress' && prog.label).toBe('Done');
  });

  it('parses !progress with decimal value', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!progress[Partial](33.5)\n'));
    const prog = slides[0].elements.find((e) => e.type === 'progress');
    expect(prog?.type === 'progress' && prog.value).toBe(33.5);
  });

  it('preserves element order with mixed custom syntax and markdown', () => {
    const input = doc('## Slide\n\n- Item one\n\n!progress[Done](50)\n\n- Item two\n');
    const { slides } = parseDocument(input);
    const types = slides[0].elements.map((e) => e.type);
    expect(types.indexOf('list')).toBeLessThan(types.indexOf('progress'));
  });

  it('parses multiple progress bars in order', () => {
    const input = doc('## Slide\n\n!progress[A](10)\n!progress[B](50)\n!progress[C](90)\n');
    const { slides } = parseDocument(input);
    const bars = slides[0].elements.filter((e) => e.type === 'progress');
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.type === 'progress' && b.label)).toEqual(['A', 'B', 'C']);
  });
});

// ── Column breaks ─────────────────────────────────────────────────────────────

describe('column breaks', () => {
  it('inserts a column-break element for |||', () => {
    const { slides } = parseDocument(doc('## Slide\n\nLeft content\n\n|||\n\nRight content\n'));
    const cb = slides[0].elements.find((e) => e.type === 'column-break');
    expect(cb).toBeTruthy();
  });

  it('column-break triggers two-column layout', () => {
    const { slides } = parseDocument(doc('## Slide\n\nLeft\n\n|||\n\nRight\n'));
    expect(slides[0].layout).toBe('two-column');
  });
});

// ── Speaker notes ─────────────────────────────────────────────────────────────

describe('speaker notes', () => {
  it('splits on ???', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Bullet\n\n???\n\nThese are notes\n'));
    expect(slides[0].speakerNotes).toBe('These are notes');
  });

  it('??? inside a code fence is not treated as separator', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```\n???\n```\n\n???\n\nReal notes\n'));
    expect(slides[0].speakerNotes).toBe('Real notes');
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(code?.type === 'code' && code.value).toBe('???');
  });

  it('returns empty notes when no ??? present', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Bullet\n'));
    expect(slides[0].speakerNotes).toBe('');
  });
});

// ── Layout override ───────────────────────────────────────────────────────────

describe('layout override comment', () => {
  it('<!-- layout:bsp --> overrides detected layout', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- layout:bsp -->\n\n- Only one element\n'));
    expect(slides[0].layout).toBe('bsp');
    expect(slides[0].layoutOverride).toBe('bsp');
  });

  it('<!-- layout:grid --> overrides on a simple slide', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- layout:grid -->\n\n- Item\n'));
    expect(slides[0].layout).toBe('grid');
  });

  it('layout override comment is not emitted as a visible element', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- layout:bsp -->\n\n- Item\n'));
    const paras = slides[0].elements.filter((e) => e.type === 'paragraph');
    expect(paras.every((p) => p.type === 'paragraph' && !p.text.includes('layout'))).toBe(true);
  });
});

// ── Full document round-trip ──────────────────────────────────────────────────

describe('full document', () => {
  it('parses a realistic presentation correctly', () => {
    const md = `---
title: My Talk
author: Ross
theme: dark
---

# My Talk

Ross Millen · 2026

---

## Introduction

- Background
- Motivation
- Goals

---

## Results

!progress[Complete](80)
!progress[In Review](50)

???

These are speaker notes for the results slide.
`;
    const { slides, frontmatter } = parseDocument(md);
    expect(frontmatter.title).toBe('My Talk');
    expect(frontmatter.author).toBe('Ross');
    expect(slides).toHaveLength(3);

    expect(slides[0].layout).toBe('title');
    expect(slides[0].title).toBe('My Talk');

    expect(slides[1].layout).toBe('title-content');
    const list = slides[1].elements.find((e) => e.type === 'list');
    expect(list?.type === 'list' && list.items).toHaveLength(3);

    expect(slides[2].speakerNotes).toContain('speaker notes for the results slide');
    const bars = slides[2].elements.filter((e) => e.type === 'progress');
    expect(bars).toHaveLength(2);
  });
});
