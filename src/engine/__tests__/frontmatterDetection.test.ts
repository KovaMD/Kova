import { describe, it, expect } from 'vitest';
import { extractFrontmatter, frontmatterBlockLength } from '../parser/frontmatter';
import { collectDiagnostics, type CheckContext } from '../parser/diagnostics';

// Characterisation of frontmatter block detection (refactor card P1-08, D12).
// extractFrontmatter (frontmatter.ts) and collectDiagnostics (diagnostics.ts)
// must agree on whether a document starts with a frontmatter block. Each case
// carries an unknown key `zz`: diagnostics only warns about it when it treats
// the block as frontmatter, and extractFrontmatter only returns it when it does.

const ctx: CheckContext = {
  docDir: '/deck',
  themeIds: ['light', 'dark'],
  fileExists: async () => true,
};

async function detection(content: string) {
  const { frontmatter, body } = extractFrontmatter(content);
  const diags = await collectDiagnostics(content, ctx);
  const unknownKey = diags.find((d) => d.message === "unknown frontmatter key 'zz'");
  return {
    extract: 'zz' in frontmatter,
    bodyUnchanged: body === content,
    blockLength: frontmatterBlockLength(content),
    diagnostics: unknownKey !== undefined,
    diagnosticsLine: unknownKey?.line,
    yamlError: diags.some((d) => d.message.startsWith('frontmatter YAML:')),
  };
}

describe('frontmatter detection: extractFrontmatter and diagnostics agree', () => {
  it('LF block: both detect', async () => {
    const doc = '---\ntitle: T\nzz: 1\n---\n# Slide\n';
    const r = await detection(doc);
    expect(r.extract).toBe(true);
    expect(r.diagnostics).toBe(true);
    expect(r.diagnosticsLine).toBe(3);
    expect(r.blockLength).toBe('---\ntitle: T\nzz: 1\n---\n'.length);
  });

  it('CRLF block: both detect', async () => {
    const doc = '---\r\ntitle: T\r\nzz: 1\r\n---\r\n# Slide\r\n';
    const r = await detection(doc);
    expect(r.extract).toBe(true);
    expect(r.diagnostics).toBe(true);
    expect(r.diagnosticsLine).toBe(3);
    expect(r.blockLength).toBe('---\r\ntitle: T\r\nzz: 1\r\n---\r\n'.length);
  });

  it('leading BOM: neither detects', async () => {
    const r = await detection('﻿---\ntitle: T\nzz: 1\n---\n# Slide\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.diagnostics).toBe(false);
    expect(r.blockLength).toBe(0);
  });

  it('unterminated block: neither detects', async () => {
    const r = await detection('---\ntitle: T\nzz: 1\n# Slide\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.diagnostics).toBe(false);
  });

  it('closing fence at EOF with no trailing newline: neither detects', async () => {
    const r = await detection('---\ntitle: T\nzz: 1\n---');
    expect(r.extract).toBe(false);
    expect(r.diagnostics).toBe(false);
  });

  it('leading blank lines: neither detects', async () => {
    const r = await detection('\n\n---\ntitle: T\nzz: 1\n---\n# Slide\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.diagnostics).toBe(false);
  });

  it('`---` block later in the document: neither detects', async () => {
    const r = await detection('# Slide\n\n---\nzz: 1\n---\n\n## Two\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.diagnostics).toBe(false);
  });

  it('empty frontmatter (blank line between fences): neither treats as frontmatter', async () => {
    const r = await detection('---\n\n---\n# Slide\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.blockLength).toBe(0);
    expect(r.yamlError).toBe(false);
  });

  it('adjacent fences `---\\n---\\n`: no block match in either', async () => {
    const r = await detection('---\n---\n# Slide\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.yamlError).toBe(false);
  });

  it('stray opening fence above a slide separator: neither treats as frontmatter', async () => {
    const r = await detection('---\n# Slide\n---\n## zz: 1\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.diagnostics).toBe(false);
    expect(r.yamlError).toBe(false);
  });

  it('YAML array block: neither treats as frontmatter', async () => {
    const r = await detection('---\n- zz\n- b\n---\n# Slide\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.diagnostics).toBe(false);
  });

  it('YAML syntax error: extract falls back to no frontmatter, diagnostics reports it', async () => {
    const r = await detection('---\nzz: [unclosed\n---\n# Slide\n');
    expect(r.extract).toBe(false);
    expect(r.bodyUnchanged).toBe(true);
    expect(r.yamlError).toBe(true);
  });

  // Not a block-detection difference: both find the same block, but parse its
  // YAML with different options (frontmatter.ts passes `json: true`, which
  // lets a later duplicate key win; diagnostics does not, so it errors).
  // Documented here as current behaviour; out of scope for P1-08.
  it('duplicate key: same block found, YAML parsed differently (current behaviour)', async () => {
    const doc = '---\nzz: 1\nzz: 2\n---\n# Slide\n';
    const r = await detection(doc);
    expect(extractFrontmatter(doc).frontmatter).toEqual({ zz: 2 });
    expect(r.extract).toBe(true);
    expect(r.yamlError).toBe(true);
    expect(r.diagnostics).toBe(false);
  });
});
