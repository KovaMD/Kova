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

  it('does not split on a --- line inside a fenced code block', () => {
    const md = doc([
      '# A',
      '',
      '```yaml',
      'title: Example',
      '---',
      'body: text',
      '```',
      '',
      'Some trailing text.',
      '',
      '---',
      '',
      '## B',
      '',
    ].join('\n'));
    const { slides } = parseDocument(md);
    expect(slides).toHaveLength(2);
    expect(slides[1].title).toBe('B');
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

  it('splits image from preceding text even without a blank line', () => {
    // CommonMark puts text + image in one paragraph when no blank line separates them.
    // The parser should split them so the layout engine can detect the image.
    const { slides } = parseDocument(doc('## Slide\n\nSome text\n![alt](img.png)\n'));
    const types = slides[0].elements.map((e) => e.type);
    expect(types).toContain('paragraph');
    expect(types).toContain('image');
  });

  it('mixed text+image triggers split layout without blank line', () => {
    const { slides } = parseDocument(doc('## Slide\n\nSome text\n![alt](img.png)\n'));
    expect(slides[0].layout).toBe('split');
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

  it('preserves list structure inside a blockquote (#116)', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> Intro\n> - first\n> - second\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    const html = bq?.type === 'blockquote' ? bq.html ?? '' : '';
    expect(html).toContain('<p>Intro</p>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
    expect(html).not.toContain('firstsecond'); // no run-on flattening
  });

  it('keeps inline formatting in an attributed blockquote (#116)', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> A **bold** point\n> — The Author\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.attribution).toBe('The Author');
    expect(bq?.type === 'blockquote' && bq.html).toContain('<strong>bold</strong>');
  });

  it('parses a callout with default title', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> [!warning]\n> Be careful here\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.calloutType).toBe('warning');
    expect(bq?.type === 'blockquote' && bq.title).toBe('Warning');
    expect(bq?.type === 'blockquote' && bq.text).toContain('Be careful here');
  });

  it('parses a callout with a custom title', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> [!tip] Pro move\n> Do this instead\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.calloutType).toBe('tip');
    expect(bq?.type === 'blockquote' && bq.title).toBe('Pro move');
  });

  it('resolves callout aliases to a canonical style', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> [!caution] Heads up\n> Watch out\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.calloutType).toBe('warning');
    expect(bq?.type === 'blockquote' && bq.title).toBe('Heads up');
  });

  it('falls back to note style for unknown callout types', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> [!custom]\n> Something else\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.calloutType).toBe('note');
    expect(bq?.type === 'blockquote' && bq.title).toBe('Custom');
  });

  it('does not treat a plain blockquote as a callout', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> Just a quote\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.calloutType).toBeUndefined();
  });

  it('parses GFM table', () => {
    const { slides } = parseDocument(doc('## Slide\n\n| A | B |\n|---|---|\n| 1 | 2 |\n'));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.headers).toEqual(['A', 'B']);
    expect(table?.type === 'table' && table.rows[0]).toEqual(['1', '2']);
  });

  it('preserves GFM table column alignments', () => {
    const { slides } = parseDocument(doc([
      '## Slide',
      '',
      '| Left | Center | Right |',
      '|:-----|:------:|------:|',
      '| a | b | c |',
    ].join('\n')));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.align).toEqual(['left', 'center', 'right']);
  });

  it('renders bold inline markdown in table cells', () => {
    const { slides } = parseDocument(doc([
      '## Slide',
      '',
      '| Label | Value |',
      '|-------|-------|',
      '| **Revenue** | $1M |',
    ].join('\n')));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.headers).toEqual(['Label', 'Value']);
    expect(table?.type === 'table' && table.rows[0][0]).toContain('<strong>Revenue</strong>');
    expect(table?.type === 'table' && table.rows[0][1]).toBe('$1M');
  });

  it('renders italic and link inline markdown in table cells', () => {
    const { slides } = parseDocument(doc([
      '## Slide',
      '',
      '| Text | Link |',
      '|------|------|',
      '| *emphasis* | [docs](https://example.com) |',
    ].join('\n')));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.rows[0][0]).toContain('<em>emphasis</em>');
    expect(table?.type === 'table' && table.rows[0][1]).toContain('<a href="https://example.com">docs</a>');
  });

  it('defaults a schemeless bare-domain link to https', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[link text](google.de)\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="https://google.de">link text</a>');
  });

  it('defaults a protocol-relative link to https', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[link text](//google.de)\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="https://google.de">link text</a>');
  });

  it('defaults a bare-domain link with a path to https', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[link text](google.de/page?x=1)\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="https://google.de/page?x=1">link text</a>');
  });

  it('leaves an explicit http scheme untouched', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[link text](http://google.de)\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="http://google.de">link text</a>');
  });

  it('still strips an unsafe/unrecognised link scheme to #', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[link text](javascript:alert(1))\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="#">link text</a>');
  });

  it('preserves mailto: links (issue #176)', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[Email me](mailto:ada@example.com)\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="mailto:ada@example.com">Email me</a>');
  });

  it('preserves tel: links (issue #176)', () => {
    const { slides } = parseDocument(doc('## Slide\n\n[Call](tel:+15551212)\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="tel:+15551212">Call</a>');
  });

  it('leaves plain table cell text unchanged', () => {
    const { slides } = parseDocument(doc([
      '## Slide',
      '',
      '| A | B |',
      '|---|---|',
      '| plain | text |',
    ].join('\n')));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.rows[0]).toEqual(['plain', 'text']);
  });

  it('renders inline formatting in table header cells', () => {
    const { slides } = parseDocument(doc([
      '## Slide',
      '',
      '| **Metric** | Count |',
      '|------------|-------|',
      '| Users | 42 |',
    ].join('\n')));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.headers[0]).toContain('<strong>Metric</strong>');
    expect(table?.type === 'table' && table.headers[1]).toBe('Count');
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

  it('preserves <u> underline tags from the editor (issue #175)', () => {
    const { slides } = parseDocument(doc('## Slide\n\nThis is <u>underlined</u> text.\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<u>underlined</u>');
  });

  it('strips non-allowlisted inline HTML tags', () => {
    const { slides } = parseDocument(doc('## Slide\n\nHello <span>world</span>.\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('world');
    expect(para?.type === 'paragraph' && para.html).not.toContain('<span>');
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

  it('escapes double quotes in an inline image alt attribute (table cell)', () => {
    // An image nested inside a table cell/list item/blockquote goes through
    // inlineToHtml and is later injected via dangerouslySetInnerHTML, so an
    // unescaped '"' in alt text would break out of the attribute and let an
    // attacker inject arbitrary attributes (e.g. onerror=) into the DOM.
    const { slides } = parseDocument(doc([
      '## Slide',
      '',
      '| Img |',
      '|-----|',
      '| ![a" onerror="alert(1)"](x.png) |',
    ].join('\n')));
    const table = slides[0].elements.find((e) => e.type === 'table');
    const cell = table?.type === 'table' ? table.rows[0][0] : '';
    // A real breakout would close the alt attribute with a raw '"' and open
    // a fresh onerror="..." attribute; escaped, that quote is '&quot;' instead.
    expect(cell).not.toMatch(/"\s*onerror\s*=\s*"/);
    expect(cell).toContain('&quot;');
  });
});

// ── Math (KaTeX / remark-math) ────────────────────────────────────────────────

describe('math parsing', () => {
  it('parses multiline block math as a display math element', () => {
    const { slides } = parseDocument(doc('## Slide\n\n$$\nE = mc^2\n$$\n'));
    const math = slides[0].elements.find((e) => e.type === 'math');
    expect(math?.type === 'math' && math.display).toBe(true);
    expect(math?.type === 'math' && math.value.trim()).toBe('E = mc^2');
  });

  it('normalises single-line $$...$$ into block math', () => {
    const { slides } = parseDocument(doc('## Slide\n\n$$E = mc^2$$\n'));
    const math = slides[0].elements.find((e) => e.type === 'math');
    expect(math?.type === 'math' && math.display).toBe(true);
    expect(math?.type === 'math' && math.value.trim()).toBe('E = mc^2');
  });

  it('renders inline math as KaTeX HTML inside a paragraph', () => {
    const { slides } = parseDocument(doc('## Slide\n\nThe equation $x^2$ is quadratic.\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(slides[0].elements.some((e) => e.type === 'math')).toBe(false);
    expect(para?.type === 'paragraph' && para.html).toContain('class="katex"');
    expect(para?.type === 'paragraph' && para.html).toContain('x^2');
  });

  it('supports block and inline math on the same slide', () => {
    const { slides } = parseDocument(doc('## Slide\n\n$$\nE = mc^2\n$$\n\nEnergy is $E$.\n'));
    const math = slides[0].elements.find((e) => e.type === 'math');
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(math?.type === 'math' && math.display).toBe(true);
    expect(para?.type === 'paragraph' && para.html).toContain('class="katex"');
  });

  it('does not parse math delimiters inside a code fence', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```\n$x^2$\n$$\nE=mc^2\n$$\n```\n'));
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(slides[0].elements.some((e) => e.type === 'math')).toBe(false);
    expect(code?.type === 'code' && code.value).toContain('$x^2$');
    expect(code?.type === 'code' && code.value).toContain('E=mc^2');
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

  it('parses !video', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!video[Clip](media/demo.mp4)\n'));
    const vid = slides[0].elements.find((e) => e.type === 'video');
    expect(vid?.type === 'video' && vid.label).toBe('Clip');
    expect(vid?.type === 'video' && vid.src).toBe('media/demo.mp4');
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

  it('treats a !youtube directive with no URL as plain text, not an embed', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!youtube[Demo]\n'));
    expect(slides[0].elements.some((e) => e.type === 'youtube')).toBe(false);
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.text).toContain('youtube');
  });

  it('treats a !progress directive with no value as plain text, not a bar', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!progress[Load]\n'));
    expect(slides[0].elements.some((e) => e.type === 'progress')).toBe(false);
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.text).toContain('progress');
  });

  it('does not treat a !progress directive with a non-numeric value as a bar', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!progress[Load](abc)\n'));
    expect(slides[0].elements.some((e) => e.type === 'progress')).toBe(false);
    // [Load](abc) becomes an ordinary markdown link once the directive regex
    // fails; the scheme-less URL is sanitised to "#".
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.html).toContain('<a href="#">Load</a>');
    expect(para?.type === 'paragraph' && para.text).toContain('progress');
  });
});

// ── Figure captions (!caption) ───────────────────────────────────────────────

describe('!caption', () => {
  it('attaches to the image it directly follows, without becoming its own element', () => {
    const { slides } = parseDocument(doc('## Slide\n\n![Arch](arch.png)\n!caption[Figure 1: architecture]\n'));
    expect(slides[0].elements).toHaveLength(1);
    const img = slides[0].elements.find((e) => e.type === 'image');
    expect(img?.type === 'image' && img.caption).toBe('Figure 1: architecture');
  });

  it('attaches to the Mermaid diagram it directly follows', () => {
    const input = doc('## Slide\n\n```mermaid\ngraph TD; A-->B;\n```\n!caption[Figure 2: flow]\n');
    const { slides } = parseDocument(input);
    expect(slides[0].elements).toHaveLength(1);
    const mer = slides[0].elements.find((e) => e.type === 'mermaid');
    expect(mer?.type === 'mermaid' && mer.caption).toBe('Figure 2: flow');
  });

  it('attaches to the math block it directly follows', () => {
    const input = doc('## Slide\n\n$$\nE = mc^2\n$$\n!caption[Equation 1: mass-energy equivalence]\n');
    const { slides } = parseDocument(input);
    expect(slides[0].elements).toHaveLength(1);
    const math = slides[0].elements.find((e) => e.type === 'math');
    expect(math?.type === 'math' && math.caption).toBe('Equation 1: mass-energy equivalence');
  });

  it('attaches only to the nearest preceding image, not an earlier one', () => {
    const input = doc('## Slide\n\n![A](a.png)\n\n![B](b.png)\n!caption[for B]\n');
    const { slides } = parseDocument(input);
    const imgs = slides[0].elements.filter((e) => e.type === 'image');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].type === 'image' && imgs[0].caption).toBeUndefined();
    expect(imgs[1].type === 'image' && imgs[1].caption).toBe('for B');
  });

  it('errors when not directly following an image, diagram, or formula', () => {
    const { slides } = parseDocument(doc('## Slide\n\nJust text.\n!caption[orphaned]\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph' && e.html.includes('#ERR'));
    expect(para?.type === 'paragraph' && para.html).toContain('!caption must directly follow');
  });

  it('errors when it is the first thing on a slide', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!caption[orphaned]\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph' && e.html.includes('#ERR'));
    expect(para).toBeDefined();
  });

  it('does not force a standalone captioned image into a split/column layout', () => {
    const { slides } = parseDocument(doc('## Slide\n\n![Arch](arch.png)\n!caption[Figure 1: architecture]\n'));
    expect(slides[0].layout).not.toBe('split');
    expect(slides[0].layout).not.toBe('two-column');
  });
});

// ── Build reveal (<!-- step -->) ─────────────────────────────────────────────

describe('<!-- step --> build reveal', () => {
  it('attaches a trailing marker to a top-level bullet, auto-incrementing', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- First\n- Second <!-- step -->\n- Third <!-- step -->\n'));
    const list = slides[0].elements.find((e) => e.type === 'list');
    if (list?.type !== 'list') throw new Error('expected a list');
    expect(list.items.map((i) => i.step)).toEqual([undefined, 1, 2]);
  });

  it('attaches a trailing marker to a nested sub-bullet, sharing the parent sequence', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Parent <!-- step -->\n  - Child <!-- step -->\n'));
    const list = slides[0].elements.find((e) => e.type === 'list');
    if (list?.type !== 'list') throw new Error('expected a list');
    expect(list.items[0].step).toBe(1);
    expect(list.items[0].children[0].step).toBe(2);
  });

  it('attaches a trailing marker to a plain paragraph', () => {
    const { slides } = parseDocument(doc('## Slide\n\nIntro paragraph. <!-- step -->\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.step).toBe(1);
  });

  it('does not leak the raw marker into text or html', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Second bullet <!-- step -->\n'));
    const list = slides[0].elements.find((e) => e.type === 'list');
    if (list?.type !== 'list') throw new Error('expected a list');
    expect(list.items[0].text).toBe('Second bullet');
    expect(list.items[0].html).not.toContain('step');
    expect(list.items[0].html).not.toContain('<!--');
  });

  it('groups elements onto the same click via an explicit number, and mixes with auto-increment', () => {
    // Trace from the design doc: step, step, step:2, step -> 1, 2, 2, 3
    // (nextAuto stays 3 after the explicit 2, since max(3, 3) = 3).
    const input = doc('## Slide\n\n- A <!-- step -->\n- B <!-- step -->\n- C <!-- step: 2 -->\n- D <!-- step -->\n');
    const { slides } = parseDocument(input);
    const list = slides[0].elements.find((e) => e.type === 'list');
    if (list?.type !== 'list') throw new Error('expected a list');
    expect(list.items.map((i) => i.step)).toEqual([1, 2, 2, 3]);
  });

  it('attaches an own-line marker to the image it directly follows', () => {
    const { slides } = parseDocument(doc('## Slide\n\n![Arch](arch.png)\n<!-- step -->\n'));
    expect(slides[0].elements).toHaveLength(1);
    const img = slides[0].elements.find((e) => e.type === 'image');
    expect(img?.type === 'image' && img.step).toBe(1);
  });

  it('attaches an own-line marker to a fenced code block', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```js\nconst x = 1;\n```\n<!-- step -->\n'));
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(code?.type === 'code' && code.step).toBe(1);
  });

  it('attaches an own-line marker to a table', () => {
    const { slides } = parseDocument(doc('## Slide\n\n| A | B |\n|---|---|\n| 1 | 2 |\n<!-- step -->\n'));
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table?.type === 'table' && table.step).toBe(1);
  });

  it('attaches an own-line marker to a math block', () => {
    const { slides } = parseDocument(doc('## Slide\n\n$$\nE = mc^2\n$$\n<!-- step -->\n'));
    const math = slides[0].elements.find((e) => e.type === 'math');
    expect(math?.type === 'math' && math.step).toBe(1);
  });

  it('attaches an own-line marker to a Mermaid diagram', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```mermaid\ngraph TD; A-->B;\n```\n<!-- step -->\n'));
    const mer = slides[0].elements.find((e) => e.type === 'mermaid');
    expect(mer?.type === 'mermaid' && mer.step).toBe(1);
  });

  it('attaches an own-line marker to a blockquote', () => {
    const { slides } = parseDocument(doc('## Slide\n\n> A quote\n<!-- step -->\n'));
    const bq = slides[0].elements.find((e) => e.type === 'blockquote');
    expect(bq?.type === 'blockquote' && bq.step).toBe(1);
  });

  it('gates a whole list as one unit via an own-line marker, clearing any per-item markers', () => {
    const input = doc('## Slide\n\n- First <!-- step -->\n- Second <!-- step -->\n<!-- step: 5 -->\n');
    const { slides } = parseDocument(input);
    const list = slides[0].elements.find((e) => e.type === 'list');
    if (list?.type !== 'list') throw new Error('expected a list');
    expect(list.step).toBe(5);
    expect(list.items.map((i) => i.step)).toEqual([undefined, undefined]);
  });

  it('tolerates a blank line between the block and its own-line marker', () => {
    const { slides } = parseDocument(doc('## Slide\n\n![Arch](arch.png)\n\n<!-- step -->\n'));
    const img = slides[0].elements.find((e) => e.type === 'image');
    expect(img?.type === 'image' && img.step).toBe(1);
  });

  it('errors when an own-line marker has no preceding element', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- step -->\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph' && e.html.includes('#ERR'));
    expect(para?.type === 'paragraph' && para.html).toContain('<!-- step --> must directly follow');
  });

  it('errors when an own-line marker follows a plain paragraph (must use the trailing form)', () => {
    const { slides } = parseDocument(doc('## Slide\n\nJust text.\n<!-- step -->\n'));
    const para = slides[0].elements.find((e) => e.type === 'paragraph' && e.html.includes('#ERR'));
    expect(para).toBeDefined();
  });

  it('errors on a duplicate own-line marker directly following an already-stepped element', () => {
    const input = doc('## Slide\n\n![Arch](arch.png)\n<!-- step -->\n<!-- step -->\n');
    const { slides } = parseDocument(input);
    const img = slides[0].elements.find((e) => e.type === 'image');
    expect(img?.type === 'image' && img.step).toBe(1);
    const err = slides[0].elements.find((e) => e.type === 'paragraph' && e.html.includes('#ERR'));
    expect(err?.type === 'paragraph' && err.html).toContain('duplicate');
  });

  it('resets numbering on every slide — steps never carry across a slide separator', () => {
    const input = doc('## First\n\n- A <!-- step -->\n\n---\n\n## Second\n\n- B <!-- step -->\n');
    const { slides } = parseDocument(input);
    const list0 = slides[0].elements.find((e) => e.type === 'list');
    const list1 = slides[1].elements.find((e) => e.type === 'list');
    expect(list0?.type === 'list' && list0.items[0].step).toBe(1);
    expect(list1?.type === 'list' && list1.items[0].step).toBe(1);
  });
});

// ── Table of contents (!toc) ────────────────────────────────────────────────

describe('!toc table of contents', () => {
  it('parses a standalone !toc line as a toc element', () => {
    const { slides } = parseDocument(doc('## Agenda\n\n!toc\n'));
    const toc = slides[0].elements.find((e) => e.type === 'toc');
    expect(toc?.type === 'toc' && toc.entries).toEqual([]);
  });

  it('does not parse !toc inside a code fence', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```\n!toc\n```\n'));
    expect(slides[0].elements.some((e) => e.type === 'toc')).toBe(false);
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(code?.type === 'code' && code.value).toContain('!toc');
  });

  it('treats a malformed !toc variant as plain text', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!toc[Agenda]\n'));
    expect(slides[0].elements.some((e) => e.type === 'toc')).toBe(false);
    const para = slides[0].elements.find((e) => e.type === 'paragraph');
    expect(para?.type === 'paragraph' && para.text).toContain('!toc');
  });
});

// ── Academic references (!ref) ────────────────────────────────────────────────

describe('!ref academic references', () => {
  it('collects a single reference on the slide', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!ref[Smith, A. (2022). Journal of Results.]\n'));
    expect(slides[0].references).toEqual(['Smith, A. (2022). Journal of Results.']);
  });

  it('collects multiple references in order', () => {
    const input = doc('## Slide\n\n!ref[First ref]\n!ref[Second ref]\n');
    const { slides } = parseDocument(input);
    expect(slides[0].references).toEqual(['First ref', 'Second ref']);
  });

  it('ignores empty !ref[] lines', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!ref[]\n!ref[Real ref]\n'));
    expect(slides[0].references).toEqual(['Real ref']);
  });

  it('does not emit !ref lines as visible elements', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Bullet\n\n!ref[Citation text]\n'));
    const texts = slides[0].elements.flatMap((e) =>
      e.type === 'paragraph' ? [e.text] : e.type === 'list' ? e.items.map((i) => i.text) : [],
    );
    expect(texts.every((t) => !t.includes('Citation text'))).toBe(true);
  });

  it('does not treat !ref inside a code fence as a reference', () => {
    const input = doc('## Slide\n\n```\n!ref[Not a citation]\n```\n\n!ref[Real citation]\n');
    const { slides } = parseDocument(input);
    expect(slides[0].references).toEqual(['Real citation']);
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(code?.type === 'code' && code.value).toContain('!ref[Not a citation]');
  });

  it('keeps references scoped to their slide', () => {
    const { slides } = parseDocument(doc(
      '## Alpha\n\n!ref[Alpha citation]\n\n---\n\n## Beta\n\n!ref[Beta citation]\n',
    ));
    expect(slides).toHaveLength(2);
    expect(slides[0].references).toEqual(['Alpha citation']);
    expect(slides[1].references).toEqual(['Beta citation']);
  });

  it('italicises journal names written with asterisks', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!ref[Smith, A. (2022). *Journal of Results*, 4(1).]\n'));
    expect(slides[0].references).toEqual(['Smith, A. (2022). <em>Journal of Results</em>, 4(1).']);
  });

  it('bolds double-asterisk text and formats inline code in references', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!ref[**Vol. 4** — see `doi:10.1000/xyz`]\n'));
    expect(slides[0].references).toEqual(['<strong>Vol. 4</strong> — see <code>doi:10.1000/xyz</code>']);
  });

  it('leaves underscores in DOIs/URLs untouched', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!ref[10.1000/journal_name_2020]\n'));
    expect(slides[0].references).toEqual(['10.1000/journal_name_2020']);
  });

  it('escapes HTML-significant characters in references', () => {
    const { slides } = parseDocument(doc('## Slide\n\n!ref[Smith & Jones <2022>]\n'));
    expect(slides[0].references).toEqual(['Smith &amp; Jones &lt;2022&gt;']);
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

  it('preserves order of content and multiple column-breaks', () => {
    const { slides } = parseDocument(doc('## Slide\n\nA\n\n|||\n\nB\n\n|||\n\nC\n'));
    const types = slides[0].elements.map((e) => e.type);
    expect(types).toEqual(['paragraph', 'column-break', 'paragraph', 'column-break', 'paragraph']);
    expect(slides[0].layout).toBe('three-column');
  });

  it('two column-breaks trigger three-column layout', () => {
    const { slides } = parseDocument(doc('## Slide\n\nLeft\n\n|||\n\nMiddle\n\n|||\n\nRight\n'));
    expect(slides[0].layout).toBe('three-column');
  });

  it('does not treat an unpadded all-empty table row (|||) as a column break', () => {
    const md = doc('## Slide\n\n| A | B |\n|---|---|\n| 1 | 2 |\n|||\n| 3 | 4 |\n');
    const { slides } = parseDocument(md);
    const cb = slides[0].elements.find((e) => e.type === 'column-break');
    expect(cb).toBeUndefined();
    const table = slides[0].elements.find((e) => e.type === 'table');
    expect(table).toBeTruthy();
    if (table && table.type === 'table') {
      expect(table.rows).toHaveLength(3);
    }
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

describe('hidden slide marker', () => {
  it('<!-- hidden --> sets hidden true and is not a visible element', () => {
    const { slides } = parseDocument(doc('## A\n\n---\n\n<!-- hidden -->\n\n## B\n\n- Item\n'));
    expect(slides.map((s) => s.hidden)).toEqual([false, true]);
    const paras = slides[1].elements.filter((e) => e.type === 'paragraph');
    expect(paras.every((p) => p.type === 'paragraph' && !p.text.includes('hidden'))).toBe(true);
  });
});

// ── Per-slide text colour (issue #143) ───────────────────────────────────────

describe('per-slide text colour', () => {
  it('<!-- color: #fff --> sets textColor', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- color: #ffffff -->\n\n- Item\n'));
    expect(slides[0].textColor).toBe('#ffffff');
    expect(slides[0].invert).toBeFalsy();
  });

  it('Marp <!-- _color: white --> sets textColor (case-insensitive)', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- _COLOR: white -->\n\n- Item\n'));
    expect(slides[0].textColor).toBe('white');
  });

  it('named and functional colour values are accepted', () => {
    const { slides } = parseDocument(doc('<!-- color: rgb(255,0,0) -->\n\n## Slide\n'));
    expect(slides[0].textColor).toBe('rgb(255,0,0)');
  });

  it('functional colour with spaces inside parens is accepted', () => {
    const { slides } = parseDocument(doc('<!-- color: rgb(255, 0, 0) -->\n\n## Slide\n'));
    expect(slides[0].textColor).toBe('rgb(255, 0, 0)');
  });

  it('functional colour containing CSS metacharacters is rejected', () => {
    // The validator must anchor the full value, not just the prefix, so a
    // value like `rgb(0); color:red` can't inject extra declarations.
    const { slides } = parseDocument(doc('<!-- color: rgb(0); color:red -->\n\n## Slide\n'));
    expect(slides[0].textColor).toBeUndefined();
  });

  it('colour directive is not emitted as a visible element', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- color: #fff -->\n\n- Item\n'));
    const paras = slides[0].elements.filter((e) => e.type === 'paragraph');
    expect(paras.every((p) => p.type === 'paragraph' && !p.text.includes('color'))).toBe(true);
  });

  it('<!-- _class: invert --> sets invert', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- _class: invert -->\n\n- Item\n'));
    expect(slides[0].invert).toBe(true);
  });

  it('_class with other tokens is not treated as invert', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- _class: lead -->\n\n- Item\n'));
    expect(slides[0].invert).toBeFalsy();
  });

  it('_class: invert directive is not emitted as a visible element', () => {
    const { slides } = parseDocument(doc('## Slide\n\n<!-- _class: invert -->\n\n- Item\n'));
    const paras = slides[0].elements.filter((e) => e.type === 'paragraph');
    expect(paras.every((p) => p.type === 'paragraph' && !p.text.includes('invert'))).toBe(true);
  });

  it('absent colour/invert leave fields undefined', () => {
    const { slides } = parseDocument(doc('## Slide\n\n- Item\n'));
    expect(slides[0].textColor).toBeUndefined();
    expect(slides[0].invert).toBeFalsy();
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

// ── Marp-style slide backgrounds (![bg]) ─────────────────────────────────────

describe('![bg] slide backgrounds', () => {
  it('image-only ![bg] → full-bleed layout', () => {
    const { slides } = parseDocument(doc('![bg](hero.jpg)'));
    expect(slides[0].layout).toBe('full-bleed');
    expect(slides[0].elements).toEqual([{ type: 'image', src: 'hero.jpg', alt: '' }]);
    expect(slides[0].backgroundImage).toBeUndefined();
  });

  it('![bg left] + title → split with image first', () => {
    const { slides } = parseDocument(doc('![bg left](side.jpg)\n\n## Title\n\n- one'));
    expect(slides[0].layout).toBe('split');
    expect(slides[0].elements[0]).toEqual({ type: 'image', src: 'side.jpg', alt: '' });
    expect(slides[0].backgroundImage).toBeUndefined();
  });

  it('![bg right] + content → split with image last', () => {
    const { slides } = parseDocument(doc('## Title\n\n- one\n\n![bg right](side.jpg)'));
    expect(slides[0].layout).toBe('split');
    const last = slides[0].elements[slides[0].elements.length - 1];
    expect(last).toEqual({ type: 'image', src: 'side.jpg', alt: '' });
  });

  it('![bg] with body content → backgroundImage overlay', () => {
    const { slides } = parseDocument(doc('![bg](backdrop.jpg)\n\n## Welcome\n\nHello world'));
    expect(slides[0].backgroundImage).toEqual({ src: 'backdrop.jpg', size: 'cover' });
    expect(slides[0].elements.some((e) => e.type === 'image')).toBe(false);
    expect(slides[0].layout).toBe('title-content');
  });

  it('![bg] with layout override → full-bleed wins over section', () => {
    const { slides } = parseDocument(doc('<!-- layout:section -->\n\n![bg](hero.jpg)'));
    expect(slides[0].layout).toBe('full-bleed');
    expect(slides[0].elements[0]).toEqual({ type: 'image', src: 'hero.jpg', alt: '' });
  });

  it('does not treat ![bg] inside a code fence as a background', () => {
    const { slides } = parseDocument(doc('## Slide\n\n```\n![bg](x.jpg)\n```\n'));
    expect(slides[0].backgroundImage).toBeUndefined();
    const code = slides[0].elements.find((e) => e.type === 'code');
    expect(code?.type === 'code' && code.value).toContain('![bg]');
  });
});

// ── Sheet tables (!sheet) ────────────────────────────────────────────────────

describe('sheet tables', () => {
  it('counts a line item whose label starts with an escaped !', () => {
    const { slides } = parseDocument(doc(
      '!sheet\n' +
      '| item           | price       |\n' +
      '|----------------|------------:|\n' +
      '| motor          |          30 |\n' +
      '| \\!brand widget |          30 |\n' +
      '| ESC            |          35 |\n' +
      '| !Total         | =sum(price) |\n'
    ));
    const table = slides[0].elements.find((e) => e.type === 'table') as any;
    expect(table.rows[3][1]).toBe('95');            // not 65 — the row is not a footer
    expect(table.rows[1][0]).toBe('!brand widget'); // the escape does not survive into the cell
  });

  it('computes row formulas and footer aggregates', () => {
    const { slides } = parseDocument(doc(
      '!let vat = 0.255\n\n' +
      '!sheet bom\n' +
      '| item  | qty | unit  | total       |\n' +
      '|-------|----:|------:|------------:|\n' +
      '| motor |   2 | 12.50 | =qty * unit |\n' +
      '| ESC   |   2 |  8.00 | =qty * unit |\n' +
      '| !**Total** |  |    | =sum(total) * (1 + vat) |\n'
    ));
    const table = slides[0].elements.find((e) => e.type === 'table') as any;
    expect(table.rows[0][3]).toBe('25');
    expect(table.rows[1][3]).toBe('16');
    // 41 * 1.255 is 51.454999… as a double, but render() rounds away the float
    // artifact so this reads as the correct decimal value, 51.46.
    expect(table.rows[2][3]).toBe('51.46');
    // the footer marker is consumed, the bold survives
    expect(table.rows[2][0]).toBe('<strong>Total</strong>');
  });

  it('reads the formula from the raw source, so * is not parsed as emphasis', () => {
    const { slides } = parseDocument(doc(
      '!sheet t\n' +
      '| a | b | c | out   |\n' +
      '|--:|--:|--:|------:|\n' +
      '| 2 | 3 | 4 | =a*b*c |\n'
    ));
    const table = slides[0].elements.find((e) => e.type === 'table') as any;
    expect(table.rows[0][3]).toBe('24');
  });

  it('leaves a table with no !sheet line completely alone', () => {
    const { slides } = parseDocument(doc(
      '| key      | value       |\n' +
      '|----------|-------------|\n' +
      '| formula? | =qty * unit |\n'
    ));
    const table = slides[0].elements.find((e) => e.type === 'table') as any;
    expect(table.rows[0][1]).toBe('=qty * unit');
  });

  it('renders a broken cell as #ERR without killing the slide', () => {
    const { slides } = parseDocument(doc(
      '# Title\n\n' +
      '!sheet t\n' +
      '| qty | unit  | total        |\n' +
      '|----:|------:|-------------:|\n' +
      '|   2 | 12.50 | =qty * untis |\n'
    ));
    const table = slides[0].elements.find((e) => e.type === 'table') as any;
    expect(slides[0].title).toBe('Title');
    expect(table.rows[0][2]).toContain('#ERR');
  });

  it('errors when !sheet is not followed by a table', () => {
    const { slides } = parseDocument(doc('!sheet t\n\njust a paragraph\n'));
    const html = slides[0].elements.map((e: any) => e.html ?? '').join(' ');
    expect(html).toContain('#ERR');
  });

  it('errors when a !sheet is the last block on the slide', () => {
    const { slides } = parseDocument(doc('# t\n\n!sheet\n'));
    const html = slides[0].elements.map((e: any) => e.html ?? '').join(' ');
    expect(html).toContain('#ERR');
  });

  it('never throws on hostile or half-typed sheet input', () => {
    const hostile = [
      // a prototype-chain function name in a footer cell
      '!sheet t\n| qty |\n|----:|\n| 1 |\n| !=valueOf(qty) |\n',
      // a ragged row
      '!sheet t\n| a | b | c |\n|--:|--:|--:|\n| 1 |\n| 1 | 2 | 3 | 4 |\n',
      // an empty header cell
      '!sheet t\n| a |  |\n|--:|--:|\n| 1 | =a + 1 |\n',
      // a half-typed directive, mid-slide and as the last line
      '!sheet\n\ntext after\n',
      '# t\n\n!sheet\n',
      // a header that slugifies to the empty string
      '!sheet t\n| €€ | b |\n|--:|--:|\n| 1 | =1 + 1 |\n',
    ];
    for (const body of hostile) {
      expect(() => parseDocument(doc(body))).not.toThrow();
    }
  });

  it('HTML-escapes a computed value and an #ERR message', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { slides } = parseDocument(doc(
      '!sheet t\n' +
      '| val | out | msg |\n' +
      '|-----|-----|-----|\n' +
      `| ${payload} | =val + 1 | =concat("${payload}") |\n`
    ));
    const table = slides[0].elements.find((e) => e.type === 'table') as any;
    expect(table.rows[0][1]).toContain('#ERR');
    expect(table.rows[0][1]).toContain('&lt;img');
    expect(table.rows[0][1]).not.toContain('<img');
    expect(table.rows[0][2]).toContain('&lt;img');
    expect(table.rows[0][2]).not.toContain('<img');
  });

  it('errors on a reserved directive', () => {
    const { slides } = parseDocument(doc('!code python\n'));
    const html = slides[0].elements.map((e: any) => e.html ?? '').join(' ');
    expect(html).toContain('reserved');
  });

  it('does not render the !let line', () => {
    const { slides } = parseDocument(doc('!let vat = 0.255\n\ntext\n'));
    const texts = slides[0].elements.map((e: any) => e.text ?? '');
    expect(texts.join(' ')).not.toContain('!let');
  });

  it('re-renders a later slide when a constant on an earlier slide changes', () => {
    const body = (vat: string) =>
      `!let vat = ${vat}\n\n---\n\n!sheet t\n| net | gross |\n|----:|------:|\n| 100 | =net * (1 + vat) |\n`;
    const first = parseDocument(doc(body('0.10'))).slides[1].elements.find((e) => e.type === 'table') as any;
    // 100 * 1.1 is 110.00000000000001 as a double, but render() rounds away the
    // float artifact so this still renders as the bare integer 110.
    expect(first.rows[0][1]).toBe('110');
    // same slide 2 text, different constant — the cache must not serve the stale slide
    const second = parseDocument(doc(body('0.20'))).slides[1].elements.find((e) => e.type === 'table') as any;
    expect(second.rows[0][1]).toBe('120');
  });
});
