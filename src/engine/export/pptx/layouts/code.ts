import type { Area, SlideRenderContext } from '../context';
import { hex } from '../colour';
import { firstFont } from '../fonts';
import { M, W } from '../geometry';
import { stepShapeName } from '../timing';
import { addCodeBlock } from '../elements/code';
import { CAPTION_H, addCaption, tryAddImage } from '../elements/image';

export function addCodeSlide(ctx: SlideRenderContext) {
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
  const codeY = cy + hh + 0.1;
  const codeH = ch - hh - 0.1;

  // Mermaid diagrams are pre-converted to image elements during resolveSlideImages.
  // If conversion succeeded, it shows up as an image element here.
  const imgEl = slide.elements.find((e) => e.type === 'image');
  if (imgEl && imgEl.type === 'image') {
    const ar = imgEl.title ? parseFloat(imgEl.title) : NaN;
    const capH = imgEl.caption ? CAPTION_H : 0;
    const imgArea: Area = { x: M, y: codeY, w: W - M * 2, h: codeH - capH };
    const objectName = imgEl.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
    tryAddImage(s, imgEl.src, imgArea, warnings, isFinite(ar) ? ar : undefined, objectName);
    if (objectName) ctx.steps.push({ step: imgEl.step!, objectName });
    addCaption(s, imgEl.caption, t, M, codeY + codeH - capH, W - M * 2);
    return;
  }

  const codeEl = slide.elements.find((e) => e.type === 'code' || e.type === 'mermaid');
  if (!codeEl) return;

  addCodeBlock(ctx, codeEl.value, codeEl.type === 'code' ? codeEl.lang : undefined,
    { x: M, y: codeY, w: W - M * 2, h: codeH }, codeEl.step);
}
