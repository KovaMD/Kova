// @vitest-environment jsdom
// Cross-checks the pure slide model (slideModel.ts) against what the two real
// consumers produce today: the live preview (SlideRenderer, rendered in jsdom)
// and the PPTX export (exportToPptx, unzipped). Same table of theme x slide
// cases for both. Where the consumers disagree with each other the test pins
// each consumer's own current behaviour separately and says so, rather than
// picking a winner (refactor card P2-01: disagreements are raised, not fixed).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { resolveSlideFrame, resolveDeckMeta, type DeckMeta, type SlideFrame } from '../slideModel';
import { DEFAULT_THEME, type Theme } from '../../theme';
import { parseDocument } from '../../parser/markdownToSlides';
import { exportToPptx } from '../../export/pptx';
import { SlideRenderer } from '../../../components/preview/SlideRenderer';
import type { Slide } from '../../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.reject(new Error('no Tauri backend in tests'))),
  convertFileSrc: (p: string) => p,
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom never decodes images; load synchronously with a fixed 2:1 ratio.
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 200; naturalHeight = 100; width = 200; height = 100;
  set src(_v: string) { this.onload?.(); }
}
// Layout measurement APIs jsdom lacks (layouts.tsx text-fit); sizes are
// irrelevant to the frame rules checked here.
class StubResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= StubResizeObserver;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }) as DOMRect;
}
let OriginalImage: typeof Image;
beforeAll(() => { OriginalImage = global.Image; (global as unknown as { Image: unknown }).Image = StubImage; });
afterAll(() => { (global as unknown as { Image: unknown }).Image = OriginalImage; });

// 1x1 transparent PNG.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const META: DeckMeta = { title: 'Deck', author: 'Ada', date: '2026-01-02' };
const TOTAL = 2;

const DECK = `# Cover

---

## Heading

plain **boldword**

\`\`\`js
let x = 1;
\`\`\`
`;
const [TITLE_SLIDE, PARSED_CONTENT] = parseDocument(DECK).slides;
// Paragraph + code auto-lays out as bsp; pin the plain single-flow layout.
const CONTENT_SLIDE: Slide = { ...PARSED_CONTENT, layout: 'title-content' };
// addElements only draws the filled code-block shapes for a lone code element
// (mixed with text it becomes runs), so code backgrounds are checked on this.
const CODE_ONLY_SLIDE: Slide = { ...CONTENT_SLIDE, elements: CONTENT_SLIDE.elements.filter((e) => e.type === 'code') };

type Pos = Theme['logo_position'];
interface Case { header: boolean; headerHide: boolean; footer: boolean; footerHide: boolean; logo: boolean; pos: Pos }

function themeFor(c: Case): Theme {
  return {
    ...DEFAULT_THEME,
    logo: c.logo ? LOGO : undefined,
    logo_position: c.pos,
    logo_opacity: 1,
    header: { show: c.header, text: 'HeadL | {title}', hide_on_title: c.headerHide },
    footer: { show: c.footer, text: 'Foot {author}', show_slide_number: true, hide_on_title: c.footerHide },
  };
}

const CASES: Case[] = [];
for (const header of [false, true]) for (const headerHide of [false, true])
  for (const footer of [false, true]) for (const footerHide of [false, true])
    for (const pos of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as Pos[])
      CASES.push({ header, headerHide, footer, footerHide, logo: true, pos });
CASES.push({ header: true, headerHide: false, footer: true, footerHide: false, logo: false, pos: 'top-left' });
CASES.push({ header: false, headerHide: false, footer: false, footerHide: false, logo: false, pos: 'bottom-right' });

const label = (c: Case) =>
  `hdr=${c.header}${c.headerHide ? '/hide' : ''} ftr=${c.footer}${c.footerHide ? '/hide' : ''} logo=${c.logo ? c.pos : 'none'}`;

// ── Preview side ─────────────────────────────────────────────────────────────

interface Observed {
  header: boolean;
  footer: boolean;
  headerText: string | null;
  footerText: string | null;
  slideNum: string | null;
  logo: 'header' | 'footer' | 'floating' | 'hidden';
  vars: { text: string; heading: string; bold: string; codeBg: string };
}

function renderPreview(slide: Slide, theme: Theme, slideNumber?: number): Observed {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(SlideRenderer, {
      slide, theme, slideNumber, totalSlides: TOTAL,
      docTitle: META.title, docAuthor: META.author, docDate: META.date,
    }));
  });
  const q = (sel: string) => host.querySelector(sel);
  const frame = q('.slide-frame') as HTMLElement;
  const v = (n: string) => frame.style.getPropertyValue(n);
  const obs: Observed = {
    header: !!q('.sl-header-bar'),
    footer: !!q('.sl-footer-bar'),
    headerText: q('.sl-header-text')?.textContent ?? null,
    footerText: q('.sl-footer-text')?.textContent ?? null,
    slideNum: q('.sl-slide-num')?.textContent ?? null,
    logo: q('.sl-header-bar img.sl-logo') ? 'header'
      : q('.sl-footer-bar img.sl-logo-footer') ? 'footer'
        : q('img.sl-logo-float') ? 'floating' : 'hidden',
    vars: { text: v('--sl-text'), heading: v('--sl-heading-text'), bold: v('--sl-bold-text'), codeBg: v('--sl-code-bg') },
  };
  act(() => root.unmount());
  host.remove();
  return obs;
}

// ── PPTX side ────────────────────────────────────────────────────────────────

async function exportSlides(slides: Slide[], theme: Theme): Promise<string[]> {
  const res = await exportToPptx(slides, { title: META.title, author: META.author, date: META.date }, theme, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return Promise.all(slides.map((_, i) => zip.file(`ppt/slides/slide${i + 1}.xml`)!.async('string')));
}

/** Every <p:sp>/<p:pic> element whose cNvPr is named `name`. */
function shapes(xml: string, name: string): string[] {
  const out: string[] = [];
  let at = xml.indexOf(`name="${name}"`);
  while (at !== -1) {
    const start = Math.max(xml.lastIndexOf('<p:sp>', at), xml.lastIndexOf('<p:pic>', at));
    const endTag = xml.startsWith('<p:pic>', start) ? '</p:pic>' : '</p:sp>';
    out.push(xml.slice(start, xml.indexOf(endTag, at) + endTag.length));
    at = xml.indexOf(`name="${name}"`, at + 1);
  }
  return out;
}
const shape = (xml: string, name: string): string | null => shapes(xml, name)[0] ?? null;
/** Text of all shapes named `name`, joined with |, or null when there are none. */
const texts = (xml: string, name: string): string | null => {
  const els = shapes(xml, name);
  return els.length ? els.map((el) => [...el.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).join('|') : null;
};

/** Which corner the logo picture sits in, from its EMU offset. */
function logoCorner(xml: string, slideH: number): Pos | null {
  const pic = shape(xml, 'kova:logo');
  if (!pic) return null;
  const m = pic.match(/<a:off x="(\d+)" y="(\d+)"/)!;
  const x = Number(m[1]) / 914400;
  const y = Number(m[2]) / 914400;
  return `${y < slideH / 2 ? 'top' : 'bottom'}-${x < 5 ? 'left' : 'right'}` as Pos;
}

/** srgbClr of the first run whose text is exactly `t`. */
function runColour(xml: string, t: string): string | null {
  for (const run of xml.split('</a:r>')) {
    if (run.endsWith(`<a:t>${t}</a:t>`)) {
      const r = run.slice(run.lastIndexOf('<a:r>'));
      return r.match(/<a:srgbClr val="([0-9A-F]{6})"/)?.[1] ?? null;
    }
  }
  return null;
}

/** Fill of the first solid-filled rect shape: the outer code-block rect on a
 *  code-only slide with no header/footer/decoration. */
function outerCodeFill(xml: string): string | null {
  return xml.match(/<a:prstGeom prst="rect">.*?<\/a:prstGeom><a:solidFill><a:srgbClr val="([0-9A-F]{6})"/)?.[1] ?? null;
}

const hexOf = (c: string) => c.replace('#', '').toUpperCase();

// ── The table ────────────────────────────────────────────────────────────────

describe('slide model vs SlideRenderer and PPTX: chrome (header, footer, logo)', () => {
  it('fixture deck parses to a title slide and a content slide', () => {
    expect(TITLE_SLIDE.layout).toBe('title');
    expect(CONTENT_SLIDE.elements.map((e) => e.type)).toEqual(['paragraph', 'code']);
  });

  describe.each(CASES)('$header $headerHide $footer $footerHide $logo $pos', (c) => {
    const theme = themeFor(c);
    let xmls: string[];
    beforeAll(async () => { xmls = await exportSlides([TITLE_SLIDE, CONTENT_SLIDE], theme); });

    it.each([[0, TITLE_SLIDE], [1, CONTENT_SLIDE]] as const)(`${label(c)}: slide %i`, (i, slide) => {
      const frame: SlideFrame = resolveSlideFrame(slide, theme, META, { slideNumber: i + 1, totalSlides: TOTAL });

      // Preview.
      const p = renderPreview(slide, theme, i + 1);
      expect(p.header).toBe(frame.header.visible);
      expect(p.footer).toBe(frame.footer.visible);
      expect(p.headerText).toBe(frame.header.hasText ? frame.header.segments.join('') : null);
      expect(p.footerText).toBe(frame.footer.hasText ? frame.footer.segments.join('') : null);
      expect(p.logo).toBe(frame.logo.placement);
      expect(p.slideNum !== null).toBe(frame.footer.showSlideNumber);

      // PPTX: same visibility; the logo is drawn at its corner whatever its
      // placement, and only omitted when the model hides it.
      const xml = xmls[i];
      expect(texts(xml, 'kova:header-text')).toBe(frame.header.hasText ? frame.header.segments.join('|') : null);
      expect(texts(xml, 'kova:footer-text')).toBe(frame.footer.hasText ? frame.footer.segments.join('|') : null);
      expect(logoCorner(xml, 5.625)).toBe(frame.logo.placement === 'hidden' ? null : c.pos);
      expect(shape(xml, 'kova:slidenum') !== null).toBe(frame.footer.showSlideNumber);
    });
  });
});

describe('slide number label: SlideRenderer and PPTX DISAGREE', () => {
  // Disagreement 1: the preview footer shows just the slide number ("2"),
  // the PPTX footer shows "2 / 2". The model exposes the numbers only;
  // formatting stays with each consumer until this is decided.
  const theme = themeFor({ header: false, headerHide: false, footer: true, footerHide: false, logo: false, pos: 'top-left' });

  it('preview renders the bare number', () => {
    expect(renderPreview(CONTENT_SLIDE, theme, 2).slideNum).toBe('2');
  });

  it('PPTX renders "n / total"', async () => {
    const [, xml] = await exportSlides([TITLE_SLIDE, CONTENT_SLIDE], theme);
    expect(texts(xml, 'kova:slidenum')).toBe('2 / 2');
  });

  it('preview omits the number when none is passed (thumbnails); the model agrees', () => {
    expect(renderPreview(CONTENT_SLIDE, theme).slideNum).toBeNull();
    expect(resolveSlideFrame(CONTENT_SLIDE, theme, META).footer.showSlideNumber).toBe(false);
  });
});

describe('slide model vs SlideRenderer and PPTX: colours', () => {
  const theme: Theme = {
    ...DEFAULT_THEME,
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
    colors: {
      ...DEFAULT_THEME.colors,
      text: '#111111', title_text: '#EEEEEE', code_bg: '#123456',
    },
  };
  const withHB: Theme = { ...theme, colors: { ...theme.colors, heading: '#333333', bold: '#444444' } };

  const rows: Array<[string, Theme, Partial<Slide>]> = [
    ['plain', theme, {}],
    ['plain, theme heading/bold', withHB, {}],
    ['invert', withHB, { invert: true }],
    ['textColor', withHB, { textColor: '#ABCDEF' }],
    ['textColor + invert', withHB, { textColor: '#ABCDEF', invert: true }],
  ];

  it.each(rows)('%s', async (_n, t, flags) => {
    const slide: Slide = { ...CONTENT_SLIDE, ...flags };
    const { colours } = resolveSlideFrame(slide, t, META);

    const p = renderPreview(slide, t, 1);
    expect(p.vars).toEqual({ text: colours.text, heading: colours.heading, bold: colours.bold, codeBg: colours.codeBg });

    const [xml, codeXml] = await exportSlides([slide, { ...CODE_ONLY_SLIDE, ...flags }], t);
    expect(runColour(xml, 'Heading')).toBe(hexOf(colours.heading));
    expect(runColour(xml, 'plain ')).toBe(hexOf(colours.text));
    expect(runColour(xml, 'boldword')).toBe(hexOf(colours.bold));
    // Outer code-block rect is filled with the code background.
    expect(outerCodeFill(codeXml)).toBe(hexOf(colours.codeBg));
  });
});

describe('invert code background per layout: SlideRenderer and PPTX DISAGREE on multi-area layouts', () => {
  // Disagreement 2: an inverted slide's code background (#0d1117) only reaches
  // the PPTX code block on title-content, code and math (and the default
  // fallback). split, two-column, three-column, bsp and grid pass `undefined`
  // as codeBg to addElements, so their code blocks keep the theme's code_bg.
  // The preview sets --sl-code-bg on the whole slide frame, so it uses
  // #0d1117 on every layout. The model follows the preview.
  const theme: Theme = {
    ...DEFAULT_THEME,
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
    colors: { ...DEFAULT_THEME.colors, code_bg: '#123456' },
  };
  const rows: Array<[Slide['layout'], 'override' | 'theme code_bg']> = [
    ['title-content', 'override'],
    ['code', 'override'],
    ['math', 'override'],
    ['split', 'theme code_bg'],
    ['two-column', 'theme code_bg'],
    ['three-column', 'theme code_bg'],
    ['bsp', 'theme code_bg'],
    ['grid', 'theme code_bg'],
  ];

  it.each(rows)('%s: model and preview use #0d1117; PPTX uses %s', async (layout, pptx) => {
    const slide: Slide = { ...CODE_ONLY_SLIDE, layout, invert: true };
    expect(resolveSlideFrame(slide, theme, META).colours.codeBg).toBe('#0d1117');
    expect(renderPreview(slide, theme, 1).vars.codeBg).toBe('#0d1117');
    const [xml] = await exportSlides([slide], theme);
    expect(outerCodeFill(xml)).toBe(pptx === 'override' ? '0D1117' : '123456');
  });
});

describe('resolveDeckMeta vs the PPTX export derivation', () => {
  // App.tsx derives docTitle/docAuthor/docDate for the preview with the same
  // rules (it is not importable here); PPTX re-derives them from frontmatter.
  const rows: Array<[string, Record<string, unknown>]> = [
    ['frontmatter title/author/date', { title: 'Fm Title', author: 'Bo', date: '2025-05-05' }],
    ['title from the cover slide, fallback date', {}],
    ['numeric date', { date: 2026, author: 3 }],
  ];
  it.each(rows)('%s', async (_n, fm) => {
    const theme: Theme = {
      ...DEFAULT_THEME,
      header: { show: true, text: '{title} | {author} | {date}' },
      footer: { show: false, text: '', show_slide_number: false },
    };
    const slides = [TITLE_SLIDE, CONTENT_SLIDE];
    const meta = resolveDeckMeta(fm, slides, 'en');
    const res = await exportToPptx(slides, fm, theme, 'en');
    const zip = await JSZip.loadAsync(res.base64, { base64: true });
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(texts(xml, 'kova:header-text')).toBe([meta.title, meta.author, meta.date].filter(Boolean).join('|'));
  });

  it('skips a hidden H1 cover when picking the title (App.tsx rule)', () => {
    const hidden: Slide = { ...TITLE_SLIDE, hidden: true, title: 'Hidden' };
    expect(resolveDeckMeta({}, [hidden, TITLE_SLIDE], 'en').title).toBe('Cover');
  });
});
