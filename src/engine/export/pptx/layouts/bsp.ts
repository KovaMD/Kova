import { groupProgressRuns } from '../../../layout/elementGrouping';
import type { SlideElement } from '../../../types';
import type { SlideRenderContext } from '../context';
import { hex } from '../colour';
import { firstFont } from '../fonts';
import { M, W } from '../geometry';
import { addElements } from '../elements';

export function addBspSlide(ctx: SlideRenderContext) {
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
  const colW  = (W - M * 2 - GAP) / 2;

  // Mirror preview: group consecutive progress bars, then apply same placement logic
  const groups = groupProgressRuns(slide.elements);
  if (groups.length < 2) {
    addElements(ctx, slide.elements, { x: M, y: bodyY, w: W - M * 2, h: bodyH });
    return;
  }

  const isPureText = (g: SlideElement[]) =>
    g.every((e) => e.type === 'paragraph' || e.type === 'list' || e.type === 'progress');

  let leftGroup: SlideElement[];
  let rightGroups: SlideElement[][];

  if (groups.length === 2) {
    if (!isPureText(groups[0]) && isPureText(groups[1])) {
      leftGroup   = groups[1];
      rightGroups = [groups[0]];
    } else {
      leftGroup   = groups[0];
      rightGroups = [groups[1]];
    }
  } else {
    leftGroup   = groups[0];
    rightGroups = groups.slice(1);
  }

  addElements(ctx, leftGroup, { x: M, y: bodyY, w: colW, h: bodyH });

  if (rightGroups.length === 1) {
    addElements(ctx, rightGroups[0], { x: M + colW + GAP, y: bodyY, w: colW, h: bodyH });
  } else {
    const subH = (bodyH - 0.2) / 2;
    addElements(ctx, rightGroups[0], { x: M + colW + GAP, y: bodyY,              w: colW, h: subH });
    if (rightGroups[1]) {
      addElements(ctx, rightGroups[1], { x: M + colW + GAP, y: bodyY + subH + 0.2, w: colW, h: subH });
    }
  }
}
