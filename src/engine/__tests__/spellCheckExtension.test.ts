import { describe, it, expect } from 'vitest';
import { extractWords } from '../spellcheck/spellCheckExtension';

function words(doc: string): string[] {
  return extractWords(doc).map((w) => w.word);
}

describe('extractWords', () => {
  it('extracts plain words with correct document offsets', () => {
    const doc = 'Hello world';
    const ranges = extractWords(doc);
    expect(ranges).toEqual([
      { from: 0, to: 5, word: 'Hello' },
      { from: 6, to: 11, word: 'world' },
    ]);
  });

  it('skips single-character tokens', () => {
    expect(words('A big cat')).toEqual(['big', 'cat']);
  });

  it('trims trailing apostrophes and hyphens but keeps internal apostrophes', () => {
    expect(words("don't walk- word'")).toEqual(["don't", 'walk', 'word']);
  });

  it('skips YAML frontmatter', () => {
    const doc = [
      '---',
      'title: My Deck',
      'author: Ada',
      '---',
      '',
      'Hello slide',
    ].join('\n');
    expect(words(doc)).toEqual(['Hello', 'slide']);
  });

  it('skips words inside fenced code blocks', () => {
    const doc = [
      'Intro text',
      '```',
      'const hello = 1',
      'function world() {}',
      '```',
      'After code',
    ].join('\n');
    expect(words(doc)).toEqual(['Intro', 'text', 'After', 'code']);
  });

  it('skips inline code spans', () => {
    expect(words('Use `helloWorld` here')).toEqual(['Use', 'here']);
  });

  it('skips URLs and markdown link destinations', () => {
    const doc = 'Visit https://example.com or [click](https://other.test/path) now';
    // Link label text is still extracted; only the URL portion is skipped.
    expect(words(doc)).toEqual(['Visit', 'or', 'click', 'now']);
  });

  it('skips image alt text in markdown links', () => {
    expect(words('See ![diagram label](assets/img.png) below')).toEqual(['See', 'below']);
  });

  it('skips HTML tag tokens but not text between tags', () => {
    expect(words('Hello <strong>world</strong> there')).toEqual(['Hello', 'world', 'there']);
  });

  it('tracks offsets across multiple lines', () => {
    const doc = 'Line one\nLine two';
    const ranges = extractWords(doc);
    expect(ranges[0]).toEqual({ from: 0, to: 4, word: 'Line' });
    expect(ranges[ranges.length - 1]).toEqual({ from: 14, to: 17, word: 'two' });
  });
});
