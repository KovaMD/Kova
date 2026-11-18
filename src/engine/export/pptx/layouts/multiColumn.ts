import { autoSplitElements, splitByColumnBreaks } from '../../../layout/elementGrouping';
import type { SlideRenderContext } from '../context';
import { hex } from '../colour';
import { firstFont } from '../fonts';
import { M, W } from '../geometry';
import { addElements } from '../elements';

export function addMultiColumnSlide(ctx: SlideRenderContext, columns: 2 | 3) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: ctx.colours.heading,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const GAP   = 0.3;
  const colW  = (W - M * 2 - GAP * (columns - 1)) / columns;
  const hasBreak = slide.elements.some((e) => e.type === 'column-break');
  const groups = hasBreak
    ? splitByColumnBreaks(slide.elements, columns)
    : [...autoSplitElements(slide.elements), ...Array(columns - 2).fill([])];

  groups.forEach((group, i) => {
    addElements(ctx, group, { x: M + i * (colW + GAP), y: bodyY, w: colW, h: bodyH });
  });
}
