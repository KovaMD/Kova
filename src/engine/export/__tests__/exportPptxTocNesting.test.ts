// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import { parseDocument } from '../../parser/markdownToSlides';
import { buildTocEntries } from '../../toc';

// Nested `!toc` entries (issue #277): top-level bold, deeper levels indented
// with no visible marker. pptxgenjs drops marL on unbulleted paragraphs, so
// sub-entries carry an invisible no-break-space bullet to keep their indent.

async function tocSlideXml(md: string, numbered = false): Promise<string> {
  const { slides, frontmatter } = parseDocument(md);
  // Export receives resolved slides in the app; fill the toc the same way.
  const tocSlide = slides[0];
  const entries = buildTocEntries(slides, tocSlide.index);
  tocSlide.elements = tocSlide.elements.map((el) =>
    el.type === 'toc' ? { ...el, entries, nested: entries.some((e) => e.depth) } : el);
  const theme = { ...DEFAULT_THEME, toc: { ...DEFAULT_THEME.toc, numbered } };
  const res = await exportToPptx(slides, frontmatter, theme, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

const paragraphWith = (xml: string, text: string) =>
  xml.match(new RegExp(`<a:p>(?:(?!<a:p>)[\\s\\S])*?${text}[\\s\\S]*?</a:p>`))?.[0] ?? '';

const MD = '!toc\n---\n## Section 1\n\n### Section 1.1\n---\n## Section 2\n';

describe('exportPptx nested toc', () => {
  it('bolds top-level entries and indents sub-entries 2em without a visible marker', async () => {
    const xml = await tocSlideXml(MD);
    expect(paragraphWith(xml, 'Section 1<')).toMatch(/b="1"/);
    const sub = paragraphWith(xml, 'Section 1\\.1');
    expect(sub).toMatch(/<a:buChar char="&#x00A0;"\/>/);
    expect(sub).toMatch(/marL="457200"/); // 36pt = 2em at 18pt
  });

  it('numbers only top-level entries, consecutively', async () => {
    const xml = await tocSlideXml(MD, true);
    expect(paragraphWith(xml, 'Section 1<')).toMatch(/startAt="1"/);
    const sub = paragraphWith(xml, 'Section 1\\.1');
    expect(sub).not.toMatch(/buAutoNum/);
    // Indented past the numbered text, not just level with the numbers.
    const marL = (p: string) => Number(p.match(/marL="(\d+)"/)?.[1]);
    expect(marL(sub)).toBeGreaterThan(marL(paragraphWith(xml, 'Section 1<')));
    expect(paragraphWith(xml, 'Section 2')).toMatch(/startAt="2"/);
  });
});
