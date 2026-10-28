import { describe, it, expect } from 'vitest';
import { parseDocument } from '../parser/markdownToSlides';
import { buildTocEntries } from '../toc';

const entriesFor = (md: string, tocIndex = 0) => buildTocEntries(parseDocument(md).slides, tocIndex);

describe('buildTocEntries', () => {
  it('lists every heading on a slide, not just its title (issue #278)', () => {
    const md = '!toc\n---\n## Section 1\n\n### Section 1.1\nlorem ipsum\n---\n### Section 1.2\nlorem ipsum\n';
    expect(entriesFor(md)).toEqual([
      { title: 'Section 1', index: 1, depth: 0 },
      { title: 'Section 1.1', index: 1, depth: 1 },
      { title: 'Section 1.2', index: 2, depth: 1 },
    ]);
  });

  it('keeps the gap for a skipped level, counting from the shallowest present (issue #277)', () => {
    const md = '!toc\n---\n## A\n---\n#### A.1\n---\n## B\n';
    expect(entriesFor(md).map((e) => e.depth)).toEqual([0, 2, 0]);
  });

  it('keeps a flat TOC at depth 0', () => {
    const md = '!toc\n---\n## A\n---\n## B\n';
    expect(entriesFor(md).map((e) => e.depth)).toEqual([0, 0]);
  });

  it('excludes the cover, hidden slides and the TOC slide itself', () => {
    const md = '# Cover\n\n## Subtitle\n---\n## Agenda\n\n!toc\n---\n<!-- hidden -->\n## Draft\n---\n### Only\n';
    // `## Agenda` is on the TOC slide, so it must not push `### Only` to depth 1.
    expect(entriesFor(md, 1)).toEqual([{ title: 'Only', index: 3, depth: 0 }]);
  });

  it('drops a trailing step marker from a subheading', () => {
    const md = '!toc\n---\n## A\n\n### B <!-- step -->\n';
    expect(entriesFor(md).map((e) => e.title)).toEqual(['A', 'B']);
  });
});
