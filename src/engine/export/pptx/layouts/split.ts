import type { Area, SlideRenderContext } from '../context';
import { hex } from '../colour';
import { firstFont } from '../fonts';
import { M, W } from '../geometry';
import { stepShapeName } from '../timing';
import { addElements } from '../elements';
import { CAPTION_H, addCaption, imgAr, tryAddImage } from '../elements/image';

export function addSplitSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings } = ctx;
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
  const colW  = (W - M * 2 - 0.3) / 2;
  const imgIdx = slide.elements.findIndex((e) => e.type === 'image');
  const img    = imgIdx >= 0 ? slide.elements[imgIdx] : undefined;
  const rest   = slide.elements.filter((e) => e.type !== 'image');
  // Mirror the preview: image goes right when it appears after text in source
  const imgOnRight = imgIdx > 0;

  const ar = img && img.type === 'image' ? imgAr(img) : undefined;
  const capH = img && img.type === 'image' && img.caption ? CAPTION_H : 0;

  if (imgOnRight) {
    addElements(ctx, rest, { x: M, y: bodyY, w: colW, h: bodyH });
    if (img && img.type === 'image') {
      const imgX = M + colW + 0.3;
      const imgArea: Area = { x: imgX, y: bodyY, w: colW, h: bodyH - capH };
      const objectName = img.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
      tryAddImage(s, img.src, imgArea, warnings, ar, objectName);
      if (objectName) ctx.steps.push({ step: img.step!, objectName });
      addCaption(s, img.caption, t, imgX, bodyY + bodyH - capH, colW);
    }
  } else {
    if (img && img.type === 'image') {
      const imgArea: Area = { x: M, y: bodyY, w: colW, h: bodyH - capH };
      const objectName = img.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
      tryAddImage(s, img.src, imgArea, warnings, ar, objectName);
      if (objectName) ctx.steps.push({ step: img.step!, objectName });
      addCaption(s, img.caption, t, M, bodyY + bodyH - capH, colW);
    }
    addElements(ctx, rest, { x: M + colW + 0.3, y: bodyY, w: colW, h: bodyH });
  }
}
