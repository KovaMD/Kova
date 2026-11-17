import { describe, it, expect } from 'vitest';
import {
  resolveSlideFrame, resolveDeckMeta, resolveSlideColours, INVERT_CODE_BG,
  type DeckMeta, type FrameSlide, type LogoPlacement,
} from '../slideModel';
import { DEFAULT_THEME, BUILT_IN_THEMES, type Theme } from '../../theme';
import { formatFallbackDate } from '../../../i18n/date';
import type { Slide } from '../../types';

// Characterisation of the per-slide frame rules as SlideRenderer.tsx and
// exportPptx.ts addSlide implement them today (refactor card P2-01). The
// cross-check against the real consumers lives in slideModelParity.test.ts.

const META: DeckMeta = { title: 'Deck', author: 'Ada', date: '2026-01-02' };
const LOGO = 'data:image/png;base64,AAAA';

type Pos = Theme['logo_position'];
const POSITIONS: Pos[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function theme(opts: {
  header?: boolean; headerHide?: boolean;
  footer?: boolean; footerHide?: boolean;
  logo?: boolean; pos?: Pos; num?: boolean;
} = {}): Theme {
  return {
    ...DEFAULT_THEME,
    logo: opts.logo ? LOGO : undefined,
    logo_position: opts.pos ?? 'top-right',
    logo_opacity: 0.5,
    header: { show: opts.header ?? false, text: 'H', hide_on_title: opts.headerHide },
    footer: { show: opts.footer ?? false, text: 'F', show_slide_number: opts.num ?? false, hide_on_title: opts.footerHide },
  };
}

const slide = (layout: Slide['layout'], extra: Partial<FrameSlide> = {}): FrameSlide => ({ layout, ...extra });

describe('resolveSlideFrame: header/footer visibility', () => {
  // [header.show, header.hide_on_title, layout, expected visible]
  const rows: Array<[boolean, boolean | undefined, Slide['layout'], boolean]> = [
    [false, undefined, 'title', false],
    [false, true, 'title', false],
    [true, undefined, 'title', true],
    [true, false, 'title', true],
    [true, true, 'title', false],
    [true, true, 'title-content', true],
    [true, true, 'section', true],
    [true, true, 'blank', true],
    [false, true, 'title-content', false],
  ];
  it.each(rows)('header show=%s hide_on_title=%s on %s -> %s', (show, hide, layout, visible) => {
    const f = resolveSlideFrame(slide(layout), theme({ header: show, headerHide: hide }), META);
    expect(f.header.visible).toBe(visible);
  });
  it.each(rows)('footer show=%s hide_on_title=%s on %s -> %s', (show, hide, layout, visible) => {
    const f = resolveSlideFrame(slide(layout), theme({ footer: show, footerHide: hide }), META);
    expect(f.footer.visible).toBe(visible);
  });

  it('flags only the title layout as the title slide', () => {
    expect(resolveSlideFrame(slide('title'), DEFAULT_THEME, META).isTitleSlide).toBe(true);
    expect(resolveSlideFrame(slide('section'), DEFAULT_THEME, META).isTitleSlide).toBe(false);
  });
});

describe('resolveSlideFrame: bar text', () => {
  const t: Theme = {
    ...DEFAULT_THEME,
    header: { show: true, text: '{title} | {author} | {date}' },
    footer: { show: true, text: '{slide_number}/{total}', show_slide_number: true },
  };

  it('splits the template on | before resolving, so a | in the title is kept', () => {
    const f = resolveSlideFrame(slide('title-content'), t, { ...META, title: 'Costs | Benefits' }, { slideNumber: 3, totalSlides: 9 });
    expect(f.header.segments).toEqual(['Costs | Benefits', 'Ada', '2026-01-02']);
    expect(f.footer.segments).toEqual(['3/9']);
    expect(f.header.hasText).toBe(true);
  });

  it('resolves missing slide numbers to empty strings', () => {
    const f = resolveSlideFrame(slide('title-content'), t, META);
    expect(f.footer.segments).toEqual(['/']);
  });

  it('has no segments for a hidden bar and no text for an all-empty template', () => {
    const hidden = resolveSlideFrame(slide('title'), { ...t, header: { ...t.header, hide_on_title: true } }, META);
    expect(hidden.header).toEqual({ visible: false, segments: [], hasText: false });
    const empty = resolveSlideFrame(slide('title-content'), { ...t, header: { show: true, text: '{author}' } }, { ...META, author: '' });
    expect(empty.header).toEqual({ visible: true, segments: [''], hasText: false });
  });

  // [footer.show, show_slide_number, slideNumber, expected]
  const numRows: Array<[boolean, boolean, number | undefined, boolean]> = [
    [true, true, 4, true],
    [true, true, undefined, false], // thumbnails pass no slide number
    [true, false, 4, false],
    [false, true, 4, false],
  ];
  it.each(numRows)('footer show=%s show_slide_number=%s slide=%s -> slide number %s', (show, num, n, expected) => {
    const f = resolveSlideFrame(slide('title-content'), theme({ footer: show, num }), META, { slideNumber: n, totalSlides: 10 });
    expect(f.footer.showSlideNumber).toBe(expected);
  });
});

describe('resolveSlideFrame: logo placement (full theme x slide matrix)', () => {
  // Expected placement written out by hand from SlideRenderer.tsx:
  //   in a bar   when that bar is visible and the logo's corner belongs to it
  //   floating   when the theme has no bar at the logo's corner at all
  //   hidden     when the corner's bar exists but is hidden on this slide
  function expected(o: { header: boolean; headerHide: boolean; footer: boolean; footerHide: boolean; logo: boolean; pos: Pos }, isTitle: boolean): LogoPlacement {
    if (!o.logo) return 'hidden';
    const top = o.pos.startsWith('top');
    const show = top ? o.header : o.footer;
    const hide = top ? o.headerHide : o.footerHide;
    if (!show) return 'floating';
    if (hide && isTitle) return 'hidden';
    return top ? 'header' : 'footer';
  }

  const rows: Array<[string, Parameters<typeof expected>[0], Slide['layout']]> = [];
  for (const header of [false, true]) for (const headerHide of [false, true])
    for (const footer of [false, true]) for (const footerHide of [false, true])
      for (const logo of [false, true]) for (const pos of POSITIONS)
        for (const layout of ['title', 'title-content'] as const) {
          const o = { header, headerHide, footer, footerHide, logo, pos };
          rows.push([`${JSON.stringify(o)} ${layout}`, o, layout]);
        }

  it.each(rows)('%s', (_name, o, layout) => {
    const f = resolveSlideFrame(slide(layout), theme(o), META);
    expect(f.logo.placement).toBe(expected(o, layout === 'title'));
    expect(f.logo.position).toBe(o.pos);
    expect(f.logo.opacity).toBe(0.5);
  });

  it('a hidden-on-title header takes its logo down even when the footer is visible', () => {
    const f = resolveSlideFrame(slide('title'), theme({ header: true, headerHide: true, footer: true, logo: true, pos: 'top-left' }), META);
    expect(f.logo.placement).toBe('hidden');
    expect(f.footer.visible).toBe(true);
  });

  it('a bottom logo floats when only the header exists', () => {
    const f = resolveSlideFrame(slide('title-content'), theme({ header: true, logo: true, pos: 'bottom-right' }), META);
    expect(f.logo.placement).toBe('floating');
  });
});

describe('resolveSlideColours: precedence', () => {
  const base: Theme = {
    ...DEFAULT_THEME,
    colors: { ...DEFAULT_THEME.colors, text: '#111111', title_text: '#eeeeee', code_bg: '#222222' },
  };
  const withHB: Theme = { ...base, colors: { ...base.colors, heading: '#333333', bold: '#444444' } };

  // [name, theme, slide flags, text, heading, bold, codeBg, textOverride, codeBgOverride]
  const rows: Array<[string, Theme, Partial<FrameSlide>, string, string, string, string, string | undefined, string | undefined]> = [
    ['plain', base, {}, '#111111', '#111111', '#111111', '#222222', undefined, undefined],
    ['plain, theme heading/bold', withHB, {}, '#111111', '#333333', '#444444', '#222222', undefined, undefined],
    ['invert', base, { invert: true }, '#eeeeee', '#eeeeee', '#eeeeee', INVERT_CODE_BG, '#eeeeee', INVERT_CODE_BG],
    ['invert beats theme heading/bold', withHB, { invert: true }, '#eeeeee', '#eeeeee', '#eeeeee', INVERT_CODE_BG, '#eeeeee', INVERT_CODE_BG],
    ['textColor', base, { textColor: 'white' }, 'white', 'white', 'white', '#222222', 'white', undefined],
    ['textColor beats theme heading/bold', withHB, { textColor: 'rgb(1, 2, 3)' }, 'rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'rgb(1, 2, 3)', '#222222', 'rgb(1, 2, 3)', undefined],
    ['textColor beats invert, keeps theme code bg', withHB, { invert: true, textColor: '#abcdef' }, '#abcdef', '#abcdef', '#abcdef', '#222222', '#abcdef', undefined],
    ['invert: false is plain', withHB, { invert: false }, '#111111', '#333333', '#444444', '#222222', undefined, undefined],
  ];
  it.each(rows)('%s', (_n, t, flags, text, heading, bold, codeBg, textOverride, codeBgOverride) => {
    expect(resolveSlideColours(slide('title-content', flags), t))
      .toEqual({ text, heading, bold, codeBg, textOverride, codeBgOverride });
    expect(resolveSlideFrame(slide('title-content', flags), t, META).colours)
      .toEqual(resolveSlideColours(slide('title-content', flags), t));
  });

  it('matches every built-in theme for plain and inverted slides', () => {
    for (const t of BUILT_IN_THEMES) {
      const plain = resolveSlideColours(slide('title-content'), t);
      expect(plain.text).toBe(t.colors.text);
      expect(plain.heading).toBe(t.colors.heading ?? t.colors.text);
      expect(plain.bold).toBe(t.colors.bold ?? t.colors.text);
      expect(plain.codeBg).toBe(t.colors.code_bg);
      const inv = resolveSlideColours(slide('title-content', { invert: true }), t);
      expect([inv.text, inv.heading, inv.bold]).toEqual([t.colors.title_text, t.colors.title_text, t.colors.title_text]);
      expect(inv.codeBg).toBe('#0d1117');
    }
  });
});

describe('resolveDeckMeta', () => {
  const NOW = new Date(2026, 10, 17, 12);
  const s = (title: string, titleLevel: number, hidden = false) => ({ title, titleLevel, hidden });
  const slides = [s('Hidden cover', 1, true), s('Intro', 2), s('Cover', 1), s('Later', 1)];

  // [name, frontmatter, slides, expected title, author, date (undefined = locale fallback)]
  const rows: Array<[string, Record<string, unknown>, ReturnType<typeof s>[], string, string, string | undefined]> = [
    ['all from frontmatter', { title: 'T', author: 'A', date: 'D' }, slides, 'T', 'A', 'D'],
    ['title falls back to first visible H1', {}, slides, 'Cover', '', undefined],
    ['no H1 gives empty title', {}, [s('Intro', 2)], '', '', undefined],
    ['empty-string title is kept, not replaced by the cover', { title: '' }, slides, '', '', undefined],
    ['null title falls back to the cover', { title: null }, slides, 'Cover', '', undefined],
    ['null date falls back to the locale date', { date: null }, slides, 'Cover', '', undefined],
    ['numeric (core-schema) values are stringified', { title: 2026, author: 7, date: 2026 }, slides, '2026', '7', '2026'],
    ['ISO-looking date stays as authored (core schema keeps it a string)', { date: '2026-03-04' }, slides, 'Cover', '', '2026-03-04'],
  ];
  it.each(rows)('%s', (_n, fm, sl, title, author, date) => {
    for (const locale of ['en', 'de', 'sl']) {
      expect(resolveDeckMeta(fm, sl, locale, NOW)).toEqual({
        title, author, date: date ?? formatFallbackDate(locale, NOW),
      });
    }
  });

  it('uses the locale own date format for the fallback', () => {
    expect(resolveDeckMeta({}, [], 'de', NOW).date).toBe('17.11.2026');
  });
});
