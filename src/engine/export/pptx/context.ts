import type { Slide } from '../../types';
import type { Theme } from '../../theme';
import type { PptxBox, PptxSlide } from './pptxTypes';

/** A rectangle on the slide, in inches. */
export type Area = PptxBox;

/** One build-step reveal target registered while a slide is drawn, turned
 *  into <p:timing> XML once the generated OOXML shape ids are known. */
export interface StepTarget {
  step: number;
  objectName: string;
  /** 0-based paragraph indices within that (merged text box) shape, in the
   *  order they were written — omitted for a whole-shape target (a lone
   *  image/code-block/callout that already gets its own dedicated shape). */
  paragraphs?: number[];
}

/** Per-slide colours, already converted to the 6-digit hex pptxgenjs needs. */
export interface SlideColours {
  text: string;
  heading: string;
  bold: string;
  /** Invert-mode code background. Only some layouts honour it (see
   *  withThemeCodeBg); undefined means the theme's code_bg. */
  codeBg?: string;
}

/** What element renderers need: the slide to draw on, the theme and colours,
 *  and where to report warnings and build steps. */
export interface ElementRenderContext {
  s: PptxSlide;
  theme: Theme;
  colours: SlideColours;
  warnings: string[];
  steps: StepTarget[];
}

/** Everything a layout renderer needs for one slide, replacing the old
 *  positional colour/step argument tails. */
export interface SlideRenderContext extends ElementRenderContext {
  slide: Slide;
  /** Content area between the header and footer bars. */
  area: Area;
  /** Full slide height in inches (the width is fixed). */
  slideH: number;
}

/** The same context with the invert code background dropped, for layouts
 *  that deliberately keep the theme code_bg (a known PPTX difference from the
 *  preview: split, two-/three-column, bsp and grid). */
export function withThemeCodeBg<C extends ElementRenderContext>(ctx: C): C {
  return { ...ctx, colours: { ...ctx.colours, codeBg: undefined } };
}
