// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import { parseDocument } from '../../parser/markdownToSlides';

// PptxGenJS table cells can't hold shapes, so a `!progress` bar in a table
// cell exports as a text meter instead of the block bar's rects. The bug it
// guards against is stripHtml() flattening the bar to run-together "Done70%".

async function slideXml(md: string): Promise<string> {
  const { slides, frontmatter } = parseDocument(md);
  const res = await exportToPptx(slides, frontmatter, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

const tableXml = (xml: string) => xml.match(/<a:tbl>[\s\S]*<\/a:tbl>/)?.[0] ?? '';

describe('exportPptx progress bar in a table cell', () => {
  it('renders a literal !progress cell as a text meter, keeping label and percent apart', async () => {
    const xml = tableXml(await slideXml([
      '## Status',
      '',
      '| Feature | Progress |',
      '|---------|----------|',
      '| Preview | !progress[Done](70) |',
    ].join('\n')));

    expect(xml).toContain('Done');
    expect(xml).toContain('70%');
    expect(xml).not.toContain('Done70%');
    expect(xml).toMatch(/[█░]/);
  });

  it('renders a computed !sheet !progress cell as a text meter', async () => {
    const xml = tableXml(await slideXml([
      '## Status',
      '',
      '!sheet',
      '| item | qty | unit | done |',
      '|------|----:|-----:|-----:|',
      '| a | 3 | 10 | =qty * unit |',
      '| !Total | | | !progress[Total](=sum(done)) |',
    ].join('\n')));

    expect(xml).toContain('Total');
    expect(xml).toContain('30%');
    expect(xml).not.toContain('Total30%');
  });
});
