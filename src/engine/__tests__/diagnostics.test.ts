import { describe, it, expect } from 'vitest';
import { collectDiagnostics, formatCheckReport, type CheckContext } from '../parser/diagnostics';

const ctx = (overrides: Partial<CheckContext> = {}): CheckContext => ({
  docDir: '/deck',
  themeIds: ['light', 'dark', 'firefly'],
  fileExists: async () => true,
  ...overrides,
});

const CLEAN = `---
title: Test Deck
theme: dark
---

# Title Slide

---

## Second

- point
`;

describe('collectDiagnostics', () => {
  it('reports nothing for a clean document', async () => {
    const diags = await collectDiagnostics(CLEAN, ctx());
    expect(diags).toEqual([]);
  });

  it('reports frontmatter YAML parse errors with a document line', async () => {
    const doc = `---\ntitle: ok\nbad: [unclosed\n---\n\n# Slide\n`;
    const diags = await collectDiagnostics(doc, ctx());
    const yamlErr = diags.find((d) => d.message.startsWith('frontmatter YAML:'));
    expect(yamlErr).toBeDefined();
    expect(yamlErr!.severity).toBe('error');
    expect(yamlErr!.line).toBeGreaterThanOrEqual(2);
  });

  it('warns on unknown frontmatter keys with their line', async () => {
    const doc = `---\ntitle: ok\npaginate: true\n---\n\n# Slide\n`;
    const diags = await collectDiagnostics(doc, ctx());
    expect(diags).toEqual([
      { line: 3, severity: 'warning', message: "unknown frontmatter key 'paginate'" },
    ]);
  });

  it('warns on an unknown theme, errors nothing else', async () => {
    const doc = `---\ntheme: nonexistent\n---\n\n# Slide\n`;
    const diags = await collectDiagnostics(doc, ctx());
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain("unknown theme 'nonexistent'");
    expect(diags[0].line).toBe(2);
  });

  it('accepts a known community theme id', async () => {
    const doc = `---\ntheme: firefly\n---\n\n# Slide\n`;
    expect(await collectDiagnostics(doc, ctx())).toEqual([]);
  });

  it('errors on unknown layout names with their line', async () => {
    const doc = `# Slide\n\n<!-- layout: sideways -->\n`;
    const diags = await collectDiagnostics(doc, ctx());
    expect(diags).toEqual([
      { line: 3, severity: 'error', message: "unknown layout 'sideways'" },
    ]);
  });

  it('accepts every real layout name', async () => {
    const doc = `# Slide\n\n<!-- layout: three-column -->\n`;
    expect(await collectDiagnostics(doc, ctx())).toEqual([]);
  });

  it('errors on unknown bang-directives', async () => {
    const doc = `# Slide\n\n!sparkle[hello](5)\n`;
    const diags = await collectDiagnostics(doc, ctx());
    expect(diags).toEqual([
      { line: 3, severity: 'error', message: "unknown directive '!sparkle'" },
    ]);
  });

  it('accepts known directives and reserved words', async () => {
    const doc = `# Slide\n\n!progress[Done](80)\n\n!toc\n\n!ref[Some citation]\n`;
    expect(await collectDiagnostics(doc, ctx())).toEqual([]);
  });

  it('ignores directive-like lines inside fenced code blocks', async () => {
    const doc = '# Slide\n\n```sh\n!notreal[x](1)\n<!-- layout: bogus -->\n```\n';
    expect(await collectDiagnostics(doc, ctx())).toEqual([]);
  });

  it('does not mistake image syntax for a directive', async () => {
    const doc = `# Slide\n\n![alt text](pic.png)\n`;
    expect(await collectDiagnostics(doc, ctx())).toEqual([]);
  });

  it('errors on a deck with no visible slides', async () => {
    const doc = `# Only\n<!-- hidden -->\n\ncontent\n`;
    const diags = await collectDiagnostics(doc, ctx());
    expect(diags).toEqual([
      { line: 0, severity: 'error', message: 'document contains no visible slides' },
    ]);
  });

  it('errors on missing local media with the source line', async () => {
    const doc = `# Slide\n\n![alt](missing.png)\n`;
    const diags = await collectDiagnostics(doc, ctx({ fileExists: async () => false }));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      severity: 'error',
      message: "media file not found: 'missing.png'",
    });
    expect(diags[0].line).toBe(3);
  });

  it('skips media on hidden slides and remote URLs', async () => {
    const doc = [
      '# Visible',
      '',
      '![ok](https://example.com/pic.png)',
      '',
      '---',
      '',
      '# Hidden',
      '<!-- hidden -->',
      '',
      '![gone](nope.png)',
      '',
    ].join('\n');
    const diags = await collectDiagnostics(doc, ctx({ fileExists: async () => false }));
    expect(diags).toEqual([]);
  });

  it('warns when a visible remote media URL is not reachable', async () => {
    const doc = `# Slide\n\n![alt](https://random-url.abc.png)\n`;
    const diags = await collectDiagnostics(doc, ctx({
      urlReachable: async () => 'fetch failed: HTTP 404 Not Found',
    }));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      line: 3,
      severity: 'warning',
    });
    expect(diags[0].message).toContain("remote media URL not reachable: 'https://random-url.abc.png'");
    expect(diags[0].message).toContain('HTTP 404');
  });

  it('dedupes repeated remote URL checks across slides', async () => {
    const doc = [
      '# One',
      '',
      '![a](https://example.com/img.png)',
      '',
      '---',
      '',
      '# Two',
      '',
      '![b](https://example.com/img.png)',
      '',
    ].join('\n');
    let probes = 0;
    const diags = await collectDiagnostics(doc, ctx({
      urlReachable: async () => {
        probes += 1;
        return null;
      },
    }));
    expect(diags).toEqual([]);
    expect(probes).toBe(1);
  });

  it('dedupes a missing file referenced on multiple slides', async () => {
    const doc = `# One\n\n![a](shared.png)\n\n---\n\n# Two\n\n![b](shared.png)\n`;
    const diags = await collectDiagnostics(doc, ctx({ fileExists: async () => false }));
    expect(diags.filter((d) => d.message.includes('shared.png'))).toHaveLength(1);
  });
  it('warns on invalid <!-- color: … --> values (issue #199)', async () => {
    const doc = `---\ntitle: T\n---\n\n<!-- color: not-a-color -->\n\n## Slide\nHi\n`;
    const diags = await collectDiagnostics(doc, ctx());
    const w = diags.find((d) => d.message.includes('invalid color'));
    expect(w).toBeDefined();
    expect(w!.severity).toBe('warning');
    expect(w!.line).toBe(5);
  });

  it('does not warn on valid color directives', async () => {
    const doc = `---\ntitle: T\n---\n\n<!-- color: #fff -->\n\n## Slide\nHi\n`;
    const diags = await collectDiagnostics(doc, ctx());
    expect(diags.filter((d) => d.message.includes('invalid color'))).toEqual([]);
  });
});

describe('formatCheckReport', () => {
  it('formats sorted lines with a summary', () => {
    const { report, errors, warnings } = formatCheckReport('/deck/talk.md', [
      { line: 9, severity: 'error', message: 'b' },
      { line: 2, severity: 'warning', message: 'a' },
    ]);
    expect(report).toBe(
      '/deck/talk.md:2: warning: a\n/deck/talk.md:9: error: b\n1 error(s), 1 warning(s)',
    );
    expect(errors).toBe(1);
    expect(warnings).toBe(1);
  });

  it('reports a clean summary for no diagnostics', () => {
    const { report, errors, warnings } = formatCheckReport('t.md', []);
    expect(report).toBe('0 error(s), 0 warning(s)');
    expect(errors).toBe(0);
    expect(warnings).toBe(0);
  });
});
