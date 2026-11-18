// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { parseDocument } from '../../parser/markdownToSlides';
import { DEFAULT_THEME } from '../../theme';

// Regression for issue #170: KaTeX inline HTML has MathML + visual layers;
// walking both text nodes used to garble PPTX runs (e.g. "x2x^2x2").

async function slide1Text(md: string): Promise<string> {
  const { slides } = parseDocument(md);
  const res = await exportToPptx(slides, {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  // Concatenate all <a:t>…</a:t> text runs in document order.
  return [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
}

describe('exportPptx inline KaTeX (issue #170)', () => {
  it('exports a single TeX fragment, not duplicated MathML+HTML text', async () => {
    const text = await slide1Text(
      '---\ntitle: Inline math\n---\n\n## Quadratic\n\nThe equation $x^2$ is quadratic.\n',
    );
    expect(text).toContain('x^2');
    expect(text).toContain('The equation');
    expect(text).toContain('is quadratic');
    // The classic garble pattern from walking both KaTeX layers.
    expect(text).not.toMatch(/x2x\^2x2/);
    expect(text).not.toMatch(/x2x2/);
  });

  it('handles multiple inline formulas in one paragraph', async () => {
    const text = await slide1Text(
      '## Slide\n\nCompare $a$ and $b^2$ carefully.\n',
    );
    expect(text).toContain('a');
    expect(text).toContain('b^2');
    expect(text).toContain('Compare');
    expect(text).not.toMatch(/aab\^2/);
  });

  it('does not garble inline math in table cells (stripHtml path)', async () => {
    const text = await slide1Text(
      '## Table\n\n| formula |\n|--------|\n| $x^2$ |\n',
    );
    expect(text).toContain('x^2');
    expect(text).not.toMatch(/x2x\^2x2/);
    expect(text).not.toMatch(/x2x2/);
  });

  it('does not garble inline math in list items', async () => {
    const text = await slide1Text(
      '## List\n\n- The term $x^2$ appears here\n',
    );
    expect(text).toContain('x^2');
    expect(text).toContain('The term');
    expect(text).not.toMatch(/x2x\^2x2/);
  });

  it('does not garble inline math in a blockquote', async () => {
    const text = await slide1Text(
      '## Quote\n\n> Energy is $E=mc^2$ roughly\n',
    );
    expect(text).toContain('E=mc^2');
    expect(text).not.toMatch(/Emc2E=mc\^2/);
  });
});
