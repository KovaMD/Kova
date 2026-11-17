import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDocument } from '../../parser/markdownToSlides';
import type { SlideElement } from '../../types';

type TableElement = Extract<SlideElement, { type: 'table' }>;

// The example decks double as fixtures: if a slide there is broken, so is the
// feature. sheet-reference.md has an "Errors" slide that is *meant* to fail, so
// only the deliberate ones are allowed to.
function cells(file: string): string[] {
  const { slides } = parseDocument(readFileSync(`examples/${file}`, 'utf8'));
  return slides.flatMap((s) =>
    s.elements.filter((e): e is TableElement => e.type === 'table').flatMap((e) => e.rows.flat()),
  );
}

describe('example decks', () => {
  it('computes sheet-basics.md, with exactly one deliberate error', () => {
    const errs = cells('sheet-basics.md').filter((c) => c.includes('#ERR'));
    expect(errs).toHaveLength(1);                    // the "When a formula is wrong" slide
    expect(errs[0]).toContain("'untis'");
    expect(cells('sheet-basics.md')).toContain('25');   // 2 × 12.50
  });

  it('computes sheet-reference.md', () => {
    const all = cells('sheet-reference.md');
    expect(all).toContain('512');       // 2 ^ 3 ^ 2, right-associative
    expect(all).toContain('16');        // 10 + 2 * 3
    expect(all).toContain('36');        // (10 + 2) * 3
    expect(all).toContain('243');       // sum(score): 91 + 64 + 88
    expect(all).toContain('0.428571');  // 3 / 7 at precision=6
    // the Errors slide is meant to fail, all six of its cells
    expect(all.filter((c) => c.includes('#ERR'))).toHaveLength(6);
  });
});
