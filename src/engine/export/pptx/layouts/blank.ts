import type { SlideRenderContext } from '../context';
import { hex } from '../colour';

export function addBlankSlide(ctx: SlideRenderContext) {
  ctx.s.background = { fill: hex(ctx.theme.colors.background) };
}
