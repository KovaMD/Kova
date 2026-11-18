import type { LayoutType } from '../../../types';
import { withThemeCodeBg, type SlideRenderContext } from '../context';
import { addTitleSlide } from './title';
import { addSectionSlide } from './section';
import { addTitleContentSlide } from './titleContent';
import { addTitleImageSlide } from './titleImage';
import { addSplitSlide } from './split';
import { addFullBleedSlide } from './fullBleed';
import { addQuoteSlide } from './quote';
import { addMultiColumnSlide } from './multiColumn';
import { addBspSlide } from './bsp';
import { addGridSlide } from './grid';
import { addMediaSlide } from './media';
import { addCodeSlide } from './code';
import { addBlankSlide } from './blank';

/** Draws one slide's layout into the content area of `ctx`. */
export type LayoutRenderer = (ctx: SlideRenderContext) => void;

/** One renderer per LayoutType. `satisfies Record<LayoutType, ...>` makes a
 *  layout added to LayoutType without a PPTX renderer a compile error.
 *
 *  Known difference from the preview: the invert code background is only
 *  honoured on title-content, code and math (and the fallback) layouts.
 *  Split, two-/three-column, bsp and grid keep the theme code_bg, so those
 *  layouts deliberately render through withThemeCodeBg(ctx). */
export const pptxLayouts = {
  'title':         addTitleSlide,
  'section':       addSectionSlide,
  'title-content': addTitleContentSlide,
  'title-image':   addTitleImageSlide,
  'split':         (ctx) => addSplitSlide(withThemeCodeBg(ctx)),
  'full-bleed':    addFullBleedSlide,
  'quote':         addQuoteSlide,
  'two-column':    (ctx) => addMultiColumnSlide(withThemeCodeBg(ctx), 2),
  'three-column':  (ctx) => addMultiColumnSlide(withThemeCodeBg(ctx), 3),
  'bsp':           (ctx) => addBspSlide(withThemeCodeBg(ctx)),
  'grid':          (ctx) => addGridSlide(withThemeCodeBg(ctx)),
  'media':         addMediaSlide,
  'code':          addCodeSlide,
  'math':          addTitleContentSlide,
  'blank':         addBlankSlide,
} satisfies Record<LayoutType, LayoutRenderer>;

/** Renders `ctx.slide` with its layout's renderer, falling back to
 *  title-content for an unknown layout name (as the old switch default did). */
export function renderLayout(ctx: SlideRenderContext): void {
  const render: LayoutRenderer = pptxLayouts[ctx.slide.layout] ?? addTitleContentSlide;
  render(ctx);
}
