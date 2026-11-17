import { describe, it, expect } from 'vitest';
import { basename, dirname, stem, isLocalRelative, segments, toForwardSlashes } from '../paths';

// [input, basename, dirname, stem]
const TABLE: Array<[string, string, string, string]> = [
  // POSIX
  ['/docs/talk.md', 'talk.md', '/docs', 'talk'],
  ['/docs/sub/deck.tar.gz', 'deck.tar.gz', '/docs/sub', 'deck.tar'],
  ['/talk.md', 'talk.md', '', 'talk'],
  ['talk.md', 'talk.md', '', 'talk'],
  ['rel/dir/x.png', 'x.png', 'rel/dir', 'x'],
  ['/docs/.hidden', '.hidden', '/docs', ''],
  ['/docs/noext', 'noext', '/docs', 'noext'],
  ['/docs/trailing.', 'trailing.', '/docs', 'trailing.'],
  ['', '', '', ''],
  // Windows drive letters and backslashes
  ['C:\\Users\\me\\talk.md', 'talk.md', 'C:\\Users\\me', 'talk'],
  ['C:\\talk.md', 'talk.md', 'C:', 'talk'],
  ['C:talk.md', 'C:talk.md', '', 'C:talk'],
  // Mixed separators
  ['C:\\Users/me\\deck/slides.md', 'slides.md', 'C:\\Users/me\\deck', 'slides'],
  ['/home/me\\odd.md', 'odd.md', '/home/me', 'odd'],
  // UNC
  ['\\\\server\\share\\talks\\deck.md', 'deck.md', '\\\\server\\share\\talks', 'deck'],
  ['\\\\server\\share', 'share', '\\\\server', 'share'],
  // Trailing separators
  ['/docs/talks/', '', '/docs/talks', ''],
  ['C:\\docs\\', '', 'C:\\docs', ''],
  ['/', '', '', ''],
];

describe('basename / dirname / stem', () => {
  it.each(TABLE)('%j', (input, base, dir, st) => {
    expect(basename(input)).toBe(base);
    expect(dirname(input)).toBe(dir);
    expect(stem(input)).toBe(st);
  });

  it('dirname returns the fallback only when there is no separator', () => {
    expect(dirname('talk.md', undefined)).toBeUndefined();
    expect(dirname('talk.md', '/import')).toBe('/import');
    expect(dirname('/talk.md', '/import')).toBe('');
    expect(dirname('/docs/talk.md', '/import')).toBe('/docs');
  });
});

describe('segments / toForwardSlashes', () => {
  it('splits on either separator and keeps empty segments', () => {
    expect(segments('C:\\a/b\\c')).toEqual(['C:', 'a', 'b', 'c']);
    expect(segments('/a/b/')).toEqual(['', 'a', 'b', '']);
    expect(segments('x')).toEqual(['x']);
  });
  it('replaces every backslash', () => {
    expect(toForwardSlashes('\\\\srv\\share\\a/b')).toBe('//srv/share/a/b');
  });
});

describe('isLocalRelative', () => {
  it.each<[string, boolean]>([
    ['img/x.png', true],
    ['./x.png', true],
    ['assets\\x.png', true],
    ['/abs/x.png', false],
    ['../x.png', false],
    ['img/../../x.png', false],
    ['img\\..\\x.png', false],
    ['a..b/x.png', true],
    // Matches the original inline check: only a leading `/` counts as rooted.
    ['C:\\abs\\x.png', true],
    ['\\\\srv\\share\\x.png', true],
  ])('%j -> %s', (ref, expected) => {
    expect(isLocalRelative(ref)).toBe(expected);
  });
});

// Characterisation: each call site's original inline expression, copied
// verbatim, must agree with the helper-based replacement on every input.
describe('call-site characterisation', () => {
  const inputs = [...TABLE.map((r) => r[0]), 'deck.pptx', 'C:\\x\\Deck.PPTX', '/a/b.pptx/', '../up/x.png'];

  it('split(/[\\\\/]/).pop() equals basename (App title, doctitle, ImportPptxModal)', () => {
    for (const p of inputs) expect(basename(p)).toBe(p.split(/[\\/]/).pop());
  });

  it('recentFileBasename `|| path` fallback', () => {
    for (const p of inputs) expect(basename(p) || p).toBe(p.split(/[\\/]/).pop() || p);
  });

  it('forward-slash-then-split equals segments (recentFileMenuLabel, InspectorPanel shortPath)', () => {
    for (const p of inputs) expect(segments(p)).toEqual(p.replace(/\\/g, '/').split('/'));
  });

  it('App dirOf equals dirname', () => {
    const dirOf = (p: string) => {
      const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      return i >= 0 ? p.slice(0, i) : '';
    };
    for (const p of inputs) expect(dirname(p)).toBe(dirOf(p));
  });

  it('substring(0, max(lastIndexOf)) equals dirname (useMediaPaste, mediaSnippet)', () => {
    for (const p of inputs) {
      expect(dirname(p)).toBe(p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))));
    }
  });

  it('App docDir memo falls back to importDir only without a separator', () => {
    const importDir = '/imported';
    for (const p of inputs) {
      const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      const legacy = lastSlash >= 0 ? p.substring(0, lastSlash) : importDir;
      expect(dirname(p, importDir)).toBe(legacy);
    }
  });

  it('App theme-path base/dir on the forward-slashed path', () => {
    for (const raw of inputs) {
      const n = raw.replace(/\\/g, '/');
      const lastSlash = n.lastIndexOf('/');
      const legacyBase = lastSlash === -1 ? n : n.slice(lastSlash + 1);
      const legacyDir = lastSlash === -1 ? undefined : n.slice(0, lastSlash);
      const fwd = toForwardSlashes(raw);
      expect(basename(fwd)).toBe(legacyBase);
      expect(dirname(fwd, undefined)).toBe(legacyDir);
    }
  });

  it('mediaSnippet label equals stem', () => {
    for (const p of inputs) {
      expect(stem(p)).toBe(p.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'media');
    }
  });

  it('App isLocalRelativeRef equals isLocalRelative', () => {
    for (const p of inputs) {
      expect(isLocalRelative(p)).toBe(!p.startsWith('/') && !p.split(/[/\\]/).includes('..'));
    }
  });
});
