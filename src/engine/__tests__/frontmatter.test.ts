import { describe, it, expect } from 'vitest';
import { extractFrontmatter, patchFrontmatter, frontmatterBlockLength } from '../parser/frontmatter';

describe('extractFrontmatter', () => {
  it('parses scalar frontmatter and returns the body', () => {
    const { frontmatter, body } = extractFrontmatter('---\ntitle: Hello\nauthor: Ada\n---\n\n# Slide\n');
    expect(frontmatter.title).toBe('Hello');
    expect(frontmatter.author).toBe('Ada');
    expect(body).toBe('\n# Slide\n');
  });

  it('returns the full content as body when no frontmatter block exists', () => {
    const input = '# Just a slide\n\n- item';
    const { frontmatter, body } = extractFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });

  it('handles CRLF line endings in the delimiter', () => {
    const { frontmatter, body } = extractFrontmatter('---\r\ntitle: CRLF\r\n---\r\n\r\n# Slide\r\n');
    expect(frontmatter.title).toBe('CRLF');
    expect(body).toBe('\r\n# Slide\r\n');
  });

  it('returns empty frontmatter on malformed YAML', () => {
    const input = '---\n: bad: yaml:\n---\n\n# Slide\n';
    const { frontmatter, body } = extractFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });

  it('preserves boolean and number scalar types', () => {
    const { frontmatter } = extractFrontmatter('---\npaginate: true\ndate: 2024\n---\n\n# Slide\n');
    expect(frontmatter['paginate']).toBe(true);
    expect(frontmatter['date']).toBe(2024);
  });

  it('returns an empty body when nothing follows the closing ---', () => {
    const { frontmatter, body } = extractFrontmatter('---\ntitle: X\n---\n');
    expect(frontmatter.title).toBe('X');
    expect(body).toBe('');
  });

  it('returns the full content as body when frontmatter YAML is malformed', () => {
    const input = '---\n: bad: yaml:\n---\n\n# Slide\n';
    const { frontmatter, body } = extractFrontmatter(input);
    expect(frontmatter).toEqual({});
    // Body retains the entire document so a downstream parse still sees the heading.
    expect(body).toBe(input);
    expect(body).toContain('# Slide');
  });

  it('extracts a partial theme_overrides map with only colors', () => {
    const input = [
      '---',
      'theme_overrides:',
      '  colors:',
      '    primary: "#FF0000"',
      '---',
      '',
      '# Slide',
    ].join('\n');
    const { frontmatter } = extractFrontmatter(input);
    expect(frontmatter.theme_overrides).toEqual({ colors: { primary: '#FF0000' } });
  });

  it('parses nested theme_overrides maps', () => {
    const input = [
      '---',
      'theme_overrides:',
      '  footer:',
      '    text: "Page {title}"',
      '    show_slide_number: true',
      '---',
      '',
      '# Slide',
    ].join('\n');
    const { frontmatter } = extractFrontmatter(input);
    expect(frontmatter.theme_overrides).toEqual({
      footer: { text: 'Page {title}', show_slide_number: true },
    });
  });

  it('does not treat a stray opening --- + a slide separator as frontmatter (issue #246)', () => {
    // What's left after deleting the frontmatter's contents but not its closing
    // fence: a dangling `---`, then the real closing `---` is actually slide 1's
    // separator. The old regex captured "# My Presentation" as YAML and dropped
    // it, deleting the title slide.
    const input = '---\n\n# My Presentation\n\n---\n\n## First Slide\n';
    const { frontmatter, body } = extractFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
    expect(body).toContain('# My Presentation');
  });

  it('ignores a comment-only / empty frontmatter block', () => {
    const input = '---\n# just a comment\n---\n\n# Slide\n';
    const { frontmatter, body } = extractFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });
});

describe('frontmatterBlockLength', () => {
  it('is the length of a real frontmatter block', () => {
    const input = '---\ntitle: X\n---\n# Slide\n';
    expect(frontmatterBlockLength(input)).toBe('---\ntitle: X\n---\n'.length);
  });

  it('is 0 when there is no frontmatter', () => {
    expect(frontmatterBlockLength('# Slide\n\n---\n\n# Two\n')).toBe(0);
  });

  it('is 0 for a dangling opening fence followed by a slide separator', () => {
    expect(frontmatterBlockLength('---\n\n# One\n\n---\n\n# Two\n')).toBe(0);
  });
});

describe('patchFrontmatter', () => {
  it('updates an existing key without touching the body', () => {
    const input = '---\ntitle: Old\n---\n\n# Slide\n';
    const out = patchFrontmatter(input, { title: 'New' });
    expect(out).toMatch(/title: "?New"?/);
    expect(out).toContain('# Slide');
    expect(out).not.toContain('Old');
  });

  it('creates a frontmatter block when absent', () => {
    const out = patchFrontmatter('# Slide\n', { title: 'Created' });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toMatch(/title: "?Created"?/);
    expect(out).toContain('# Slide\n');
  });

  it('removes keys when patch value is null or undefined', () => {
    const input = '---\ntitle: Keep\nauthor: Drop\ndate: 2024\n---\n\n# Slide\n';
    const out = patchFrontmatter(input, { author: null, date: undefined });
    expect(out).toMatch(/title: "?Keep"?/);
    expect(out).not.toMatch(/^author:/m);
    expect(out).not.toMatch(/^date:/m);
  });

  it('merges multiple keys in one patch', () => {
    const input = '---\ntitle: Old\n---\n\n# Slide\n';
    const out = patchFrontmatter(input, { title: 'New', author: 'Ada' });
    expect(out).toMatch(/title: "?New"?/);
    expect(out).toMatch(/author: "?Ada"?/);
  });

  it('preserves body content after the frontmatter block', () => {
    const input = '---\ntitle: T\n---\n\n# One\n\n---\n\n# Two\n';
    const out = patchFrontmatter(input, { title: 'Updated' });
    expect(out).toContain('# One');
    expect(out).toContain('# Two');
  });

  it('patches a key when the body starts immediately after the closing ---', () => {
    const input = '---\ntitle: Old\n---\n# Slide\n';
    const out = patchFrontmatter(input, { title: 'New' });
    expect(out).toMatch(/title: "?New"?/);
    expect(out).toContain('---\n');
    expect(out.endsWith('# Slide\n')).toBe(true);
    expect(out).not.toContain('\n\n# Slide');
  });

  it('preserves sibling keys inside theme_overrides when the patch carries the merged map', () => {
    const input = [
      '---',
      'theme_overrides:',
      '  footer:',
      '    text: "Old"',
      '    show_slide_number: true',
      '  colors:',
      '    primary: "#111"',
      '---',
      '# Slide',
    ].join('\n');
    const out = patchFrontmatter(input, {
      theme_overrides: {
        footer: { text: 'New', show_slide_number: true },
        colors: { primary: '#111' },
      },
    });
    expect(out).toMatch(/text: "?New"?/);
    expect(out).toMatch(/primary: "?#111"?/);
    expect(out).toContain('# Slide');
  });

  it('preserves CRLF line endings in the body on patch (frontmatter is re-serialised as LF)', () => {
    const input = '---\r\ntitle: Old\r\n---\r\n# Slide\r\n';
    const out = patchFrontmatter(input, { title: 'New' });
    expect(out).toMatch(/title: "?New"?/);
    expect(out.endsWith('# Slide\r\n')).toBe(true);
    // yaml.dump always emits LF; only the body retains the original CRLF endings
    expect(out.startsWith('---\r\n')).toBe(false);
  });

  it('creates frontmatter with multiple keys when none existed', () => {
    const out = patchFrontmatter('# Slide\n', { title: 'Deck', author: 'Ada', date: 2024 });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toMatch(/title: "?Deck"?/);
    expect(out).toMatch(/author: "?Ada"?/);
    expect(out).toMatch(/date: 2024/);
    expect(out.endsWith('# Slide\n')).toBe(true);
  });

  it('drops the whole block (no empty "--- {} ---") when the merge empties it', () => {
    const out = patchFrontmatter('---\ntheme_overrides:\n  colors:\n    primary: "#111"\n---\n\n# Slide\n', {
      theme_overrides: null,
    });
    expect(out).toBe('\n# Slide\n');
    expect(out).not.toContain('---');
  });

  it('replaces a real fence whose YAML has a genuine syntax error, without stacking a duplicate block', () => {
    const input = '---\n: bad: yaml:\n---\n\n# Slide\n';
    const out = patchFrontmatter(input, { title: 'New Title' });
    expect(out).toMatch(/title: "?New Title"?/);
    expect(out).toContain('# Slide');
    // Exactly one frontmatter fence pair — not the old block stacked in front.
    expect(out.match(/^---$/gm)?.length).toBe(2);
    expect(out).not.toContain('bad: yaml');
  });

  it('does not resurrect deleted frontmatter or eat slide 1 (issue #246)', () => {
    // User deleted the frontmatter body but left a stray `---`; save re-runs
    // patchFrontmatter with nothing to add.
    const mangled = '---\n\n# My Presentation\n\n---\n\n## First Slide\n';
    const out = patchFrontmatter(mangled, { theme_overrides: null });
    expect(out).toBe(mangled);
    expect(out).toContain('# My Presentation');
  });
});
