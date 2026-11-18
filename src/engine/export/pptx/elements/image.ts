import type { SlideElement } from '../../../types';
import type { Theme } from '../../../theme';
import type { PptxSlide } from '../pptxTypes';
import type { Area, ElementRenderContext } from '../context';
import { hex } from '../colour';
import { stepShapeName } from '../timing';
import { firstFont } from '../fonts';
// PptxGenJS `sizing.contain` is broken for pre-encoded data URLs because it
// initialises imgWidth/imgHeight from the box dimensions (not the PNG pixels).
// We do the contain math ourselves when we know the aspect ratio.
export function imgAr(el: Extract<SlideElement, { type: 'image' }>): number | undefined {
  const v = el.title ? parseFloat(el.title) : NaN;
  return isFinite(v) ? v : undefined;
}

// Height reserved below an image/diagram for its !caption text, mirroring
// the web renderer's .sl-caption. Callers shrink the image area by this much
// before placing the caption in the freed strip.
export const CAPTION_H = 0.28;

export function addCaption(s: PptxSlide, caption: string | undefined, t: Theme, x: number, y: number, w: number) {
  if (!caption) return;
  s.addText(caption, {
    x, y, w, h: CAPTION_H,
    fontSize: 10, italic: true,
    color: hex(t.colors.text),
    fontFace: firstFont(t.fonts.body),
    align: 'center', valign: 'top',
  });
}

export function containArea(area: Area, aspectRatio: number): Area {
  const areaAspect = area.w / area.h;
  if (aspectRatio > areaAspect) {
    // Width-limited: fill width, reduce height
    const h = area.w / aspectRatio;
    return { x: area.x, y: area.y + (area.h - h) / 2, w: area.w, h };
  } else {
    // Height-limited: fill height, reduce width
    const w = area.h * aspectRatio;
    return { x: area.x + (area.w - w) / 2, y: area.y, w, h: area.h };
  }
}

export function tryAddImage(s: PptxSlide, src: string, area: Area, warnings: string[], aspectRatio?: number, objectName?: string) {
  if (!src) return;
  const placed = aspectRatio ? containArea(area, aspectRatio) : area;
  if (src.startsWith('data:')) {
    try {
      s.addImage({ data: src, x: placed.x, y: placed.y, w: placed.w, h: placed.h, ...(objectName ? { objectName } : {}) });
    } catch {
      warnings.push(`Embedded image could not be added to PPTX: ${src.slice(0, 60)}…`);
    }
    return;
  }
  // Do NOT pass http/https URLs to PptxGenJS — it would attempt its own XHR fetch
  // during write(), which is blocked by CSP on macOS WKWebView and throws, killing
  // the entire export. All remote images should have been pre-resolved to data: URLs
  // by resolveSlideImages; reaching here means the fetch failed, so skip gracefully.
  warnings.push(`Image skipped (could not be fetched): ${src.slice(0, 80)}`);
}
/** An image with its caption in `box` (caption strip included), registered
 *  as a whole-shape build step when the image is stepped. */
export function addImageElement(
  ctx: ElementRenderContext, el: Extract<SlideElement, { type: 'image' }>, box: Area,
) {
  const { s, theme: t, warnings, steps: stepTargets } = ctx;
  const capH = el.caption ? CAPTION_H : 0;
  const imgArea: Area = { x: box.x, y: box.y, w: box.w, h: box.h - capH };
  const objectName = el.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
  tryAddImage(s, el.src, imgArea, warnings, imgAr(el), objectName);
  if (objectName) stepTargets.push({ step: el.step!, objectName });
  addCaption(s, el.caption, t, box.x, box.y + box.h - capH, box.w);
}
