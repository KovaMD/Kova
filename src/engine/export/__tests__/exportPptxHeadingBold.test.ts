// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { DEFAULT_THEME, type Theme } from '../../theme';
import type { Slide, SlideElement } from '../../types';

// Deck-wide heading/bold colour (issue #146), layered on top of #143/#150's
// per-slide colour override. Verifies: (1) heading colour reaches the title
// text distinctly from the body, (2) bold colour reaches <strong> runs
// distinctly from plain body text, and (3) a per-slide override still wins
// over the deck-wide heading/bold colour, matching themeToVars' precedence.

const HEADING = '#FF00FF'; // -> FF00FF
const BOLD = '#00FFAA';    // -> 00FFAA
const DEFAULT_BODY = '1A1A1A'; // light theme text colour
const SLIDE_OVERRIDE = '#0000FF'; // -> 0000FF

function themed(extra: Partial<Theme['colors']>): Theme {
  return { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, ...extra } };
}

function para(html: string, text = html.replace(/<[^>]+>/g, '')): SlideElement {
  return { type: 'paragraph', text, html };
}

function makeSlide(layout: Slide['layout'], elements: SlideElement[], extra: Partial<Slide> = {}): Slide {
  return {
    index: 0, raw: '', title: 'Heading', titleLevel: 2,
    elements, speakerNotes: '', references: [], layout, hidden: false,
    ...extra,
  };
}

async function slideXml(slide: Slide, theme: Theme): Promise<string> {
  const res = await exportToPptx([slide], {}, theme, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return xml;
}

function hasColor(xml: string, hex: string): boolean {
  return xml.includes(`<a:srgbClr val="${hex}"/>`);
}

describe('exportPptx heading/bold theme colour', () => {
  const layouts: Slide['layout'][] = ['title-content', 'split', 'two-column', 'three-column', 'bsp', 'grid'];

  for (const layout of layouts) {
    it(`colours the title distinctly from the body in ${layout}`, async () => {
      const xml = await slideXml(
        makeSlide(layout, [para('body text')]),
        themed({ heading: HEADING }),
      );
      expect(hasColor(xml, 'FF00FF')).toBe(true); // title
      expect(hasColor(xml, DEFAULT_BODY)).toBe(true); // body still plain text colour
    });
  }

  it('falls back to the text colour when theme.colors.heading is unset', async () => {
    const xml = await slideXml(makeSlide('title-content', [para('body text')]), DEFAULT_THEME);
    expect(hasColor(xml, DEFAULT_BODY)).toBe(true);
    expect(hasColor(xml, 'FF00FF')).toBe(false);
  });

  it('colours <strong>/<b> runs distinctly from plain body text', async () => {
    const xml = await slideXml(
      makeSlide('title-content', [para('plain <strong>bold</strong> and <b>also bold</b>')]),
      themed({ bold: BOLD }),
    );
    expect(hasColor(xml, '00FFAA')).toBe(true); // bold runs
    expect(hasColor(xml, DEFAULT_BODY)).toBe(true); // "plain"/"and" runs stay body colour
  });

  it('colours bold text inside list items', async () => {
    const xml = await slideXml(
      makeSlide('title-content', [{ type: 'list', ordered: false, items: [
        { html: 'a <strong>bold</strong> item', text: 'a bold item', children: [] },
      ] }]),
      themed({ bold: BOLD }),
    );
    expect(hasColor(xml, '00FFAA')).toBe(true);
  });

  it('link colour wins over bold colour for a bolded link', async () => {
    const xml = await slideXml(
      makeSlide('title-content', [para('<strong><a href="https://x.example">bold link</a></strong>')]),
      themed({ bold: BOLD }),
    );
    expect(hasColor(xml, '2563EB')).toBe(true); // theme accent colour, not BOLD
    expect(hasColor(xml, '00FFAA')).toBe(false);
  });

  it('link colour wins over bold colour for bold nested inside a link', async () => {
    const xml = await slideXml(
      makeSlide('title-content', [para('<a href="https://x.example"><strong>bold link</strong></a>')]),
      themed({ bold: BOLD }),
    );
    expect(hasColor(xml, '2563EB')).toBe(true);
    expect(hasColor(xml, '00FFAA')).toBe(false);
  });

  it('a per-slide invert wins over the theme heading/bold colour', async () => {
    const xml = await slideXml(
      makeSlide('title-content', [para('plain <strong>bold</strong>')], { invert: true }),
      themed({ heading: HEADING, bold: BOLD }),
    );
    // invert -> theme.title_text (FFFFFF for the light theme), not HEADING/BOLD
    expect(hasColor(xml, 'FFFFFF')).toBe(true);
    expect(hasColor(xml, 'FF00FF')).toBe(false);
    expect(hasColor(xml, '00FFAA')).toBe(false);
  });

  it('a per-slide explicit color wins over the theme heading/bold colour', async () => {
    const xml = await slideXml(
      makeSlide('title-content', [para('plain <strong>bold</strong>')], { textColor: SLIDE_OVERRIDE }),
      themed({ heading: HEADING, bold: BOLD }),
    );
    expect(hasColor(xml, '0000FF')).toBe(true);
    expect(hasColor(xml, 'FF00FF')).toBe(false);
    expect(hasColor(xml, '00FFAA')).toBe(false);
  });
});
