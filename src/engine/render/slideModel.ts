// Shared slide presentation model (refactor card P2-01).
//
// The live preview (SlideRenderer + themeToVars) and the PPTX export
// (pptx/index.ts addSlide) each used to derive the same per-slide "frame" rules
// on their own: whether the header/footer bar shows (incl. `hide_on_title`,
// issue #254), where the theme logo goes, the per-slide colour precedence
// (`<!-- color -->` vs Marp `_class: invert`, issue #146) and the deck's
// title/author/date used by header/footer templates. This module is the one
// place those rules live. It is pure: no React, no DOM, no Tauri.
//
// Outputs are raw theme values (CSS colour strings as authored), never
// consumer-formatted: the preview feeds them into CSS custom properties, the
// PPTX export converts them to 6-digit hex itself.

import type { Frontmatter, Slide } from '../types';
import type { Theme } from '../theme';
import { resolveTemplate } from '../theme';
import { formatFallbackDate } from '../../i18n/date';

/** Code-block background on an inverted (`_class: invert`) slide: the
 *  highlight.js github-dark background, so code stays legible on dark. */
export const INVERT_CODE_BG = '#0d1117';

export interface DeckMeta {
  title: string;
  author: string;
  date: string;
}

/** Where this slide sits in the deck; omitted for e.g. preview thumbnails. */
export interface SlidePosition {
  slideNumber?: number;
  totalSlides?: number;
}

export interface BarFrame {
  /** The bar renders on this slide (theme `show`, minus `hide_on_title`). */
  visible: boolean;
  /** Template text split on the theme's `|` (left | center | right) and
   *  resolved. Split *before* resolution so a `|` inside the doc title is
   *  never a separator (issue #30). Empty when the bar is hidden. */
  segments: string[];
  /** At least one segment is non-empty, i.e. there is bar text to draw. */
  hasText: boolean;
}

export interface FooterFrame extends BarFrame {
  /** Theme asks for a slide number and one is known for this slide. */
  showSlideNumber: boolean;
  slideNumber?: number;
  totalSlides?: number;
}

/**
 * - `header` / `footer`: the logo sits in that (visible) bar.
 * - `floating`: the theme has no bar at the logo's corner at all, so the logo
 *   floats in its corner on its own.
 * - `hidden`: no logo, or its bar exists in the theme but is hidden on this
 *   slide (`hide_on_title`), which takes the logo down with it rather than
 *   spawning a floating duplicate.
 */
export type LogoPlacement = 'header' | 'footer' | 'floating' | 'hidden';

export interface LogoFrame {
  placement: LogoPlacement;
  src?: string;
  position: Theme['logo_position'];
  opacity: number;
}

export interface SlideColours {
  /** Body text colour. */
  text: string;
  /** Content heading colour. */
  heading: string;
  /** Inline **bold** colour. */
  bold: string;
  /** Code-block background. */
  codeBg: string;
  /** The per-slide text override (explicit `textColor`, else invert's
   *  `title_text`), or undefined when neither applies. Exposed so the preview
   *  can keep passing it to `themeToVars` as before. */
  textOverride?: string;
  /** The per-slide code background override (invert without an explicit
   *  colour), or undefined. */
  codeBgOverride?: string;
}

export interface SlideFrame {
  isTitleSlide: boolean;
  header: BarFrame;
  footer: FooterFrame;
  logo: LogoFrame;
  colours: SlideColours;
}

export type FrameSlide = Pick<Slide, 'layout'> & Partial<Pick<Slide, 'textColor' | 'invert'>>;

const HEADER_CORNERS: ReadonlyArray<Theme['logo_position']> = ['top-left', 'top-right'];
const FOOTER_CORNERS: ReadonlyArray<Theme['logo_position']> = ['bottom-left', 'bottom-right'];

function barSegments(text: string, meta: DeckMeta, pos: SlidePosition): string[] {
  const vars = {
    title: meta.title, author: meta.author, date: meta.date,
    slideNumber: pos.slideNumber, totalSlides: pos.totalSlides,
  };
  return text.split('|').map((s) => resolveTemplate(s.trim(), vars));
}

function bar(visible: boolean, text: string, meta: DeckMeta, pos: SlidePosition): BarFrame {
  const segments = visible ? barSegments(text, meta, pos) : [];
  return { visible, segments, hasText: segments.some(Boolean) };
}

/** Per-slide colour precedence: an explicit `textColor` wins for text,
 *  heading and bold alike; otherwise invert swaps all three to `title_text`;
 *  otherwise heading/bold fall back to their own theme colour, then `text`. */
export function resolveSlideColours(slide: FrameSlide, theme: Theme): SlideColours {
  const c = theme.colors;
  const textOverride = slide.textColor ?? (slide.invert ? c.title_text : undefined);
  const codeBgOverride = slide.invert && !slide.textColor ? INVERT_CODE_BG : undefined;
  return {
    text: textOverride ?? c.text,
    heading: textOverride ?? c.heading ?? c.text,
    bold: textOverride ?? c.bold ?? c.text,
    codeBg: codeBgOverride ?? c.code_bg,
    textOverride,
    codeBgOverride,
  };
}

export function resolveSlideFrame(
  slide: FrameSlide,
  theme: Theme,
  deckMeta: DeckMeta,
  position: SlidePosition = {},
): SlideFrame {
  const isTitleSlide = slide.layout === 'title';
  const headerVisible = theme.header.show && !(theme.header.hide_on_title && isTitleSlide);
  const footerVisible = theme.footer.show && !(theme.footer.hide_on_title && isTitleSlide);

  // "Has a home" ignores hide_on_title on purpose: a bar merely hidden on this
  // slide takes its logo down with it instead of leaving a floating duplicate.
  const inHeaderCorner = HEADER_CORNERS.includes(theme.logo_position);
  const inFooterCorner = FOOTER_CORNERS.includes(theme.logo_position);
  let placement: LogoPlacement;
  if (!theme.logo) placement = 'hidden';
  else if (inHeaderCorner && theme.header.show) placement = headerVisible ? 'header' : 'hidden';
  else if (inFooterCorner && theme.footer.show) placement = footerVisible ? 'footer' : 'hidden';
  else placement = 'floating';

  const showSlideNumber = footerVisible
    && theme.footer.show_slide_number
    && position.slideNumber !== undefined;

  return {
    isTitleSlide,
    header: bar(headerVisible, theme.header.text, deckMeta, position),
    footer: {
      ...bar(footerVisible, theme.footer.text, deckMeta, position),
      showSlideNumber,
      slideNumber: position.slideNumber,
      totalSlides: position.totalSlides,
    },
    logo: {
      placement,
      src: theme.logo,
      position: theme.logo_position,
      opacity: theme.logo_opacity,
    },
    colours: resolveSlideColours(slide, theme),
  };
}

/**
 * The deck's title/author/date as used by header/footer templates.
 * - title: frontmatter `title:`, else the first *visible* H1 slide's title
 *   (the cover), else ''.
 * - author: frontmatter `author:`, else ''.
 * - date: frontmatter `date:` (null/absent falls back), else today's date in
 *   the locale's own format.
 * Frontmatter is parsed with the YAML core schema, so a value may arrive as a
 * number or boolean; it is stringified, which is what template substitution
 * did with it anyway.
 */
export function resolveDeckMeta(
  frontmatter: Frontmatter,
  slides: ReadonlyArray<Pick<Slide, 'hidden' | 'titleLevel' | 'title'>>,
  locale: string,
  now: Date = new Date(),
): DeckMeta {
  const fmTitle = frontmatter.title as unknown;
  const fmAuthor = frontmatter.author as unknown;
  const fmDate = frontmatter.date as unknown;
  const title = fmTitle != null
    ? String(fmTitle)
    : slides.find((s) => !s.hidden && s.titleLevel === 1)?.title ?? '';
  return {
    title,
    author: fmAuthor != null ? String(fmAuthor) : '',
    date: fmDate != null ? String(fmDate) : formatFallbackDate(locale, now),
  };
}
