import type { Area, SlideRenderContext } from '../context';
import { hex } from '../colour';
import { firstFont } from '../fonts';
import { M, W } from '../geometry';
import { stepShapeName } from '../timing';
import { CAPTION_H, addCaption, imgAr, tryAddImage } from '../elements/image';

export function addTitleImageSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  // 3% gap mirrors .sl-split__body { gap: 3% } in CSS
  const GAP  = 0.3;
  const colW = (W - M * 2 - GAP) / 2;

  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: colW, h: ch,
      fontSize: 26, bold: true,
      color: ctx.colours.heading,
      fontFace: firstFont(t.fonts.title),
      align: 'left', valign: 'middle', wrap: true, shrinkText: true,
    });
  }
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    const capH = img.caption ? CAPTION_H : 0;
    const imgArea: Area = { x: M + colW + GAP, y: cy, w: colW, h: ch - capH };
    const objectName = img.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
    tryAddImage(s, img.src, imgArea, warnings, imgAr(img), objectName);
    if (objectName) ctx.steps.push({ step: img.step!, objectName });
    addCaption(s, img.caption, t, M + colW + GAP, cy + ch - capH, colW);
  }
}
