import type { SlideRenderContext } from '../context';
import { hex } from '../colour';
import { firstFont } from '../fonts';
import { W } from '../geometry';
import { tryAddImage } from '../elements/image';

export function addFullBleedSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings, slideH: H } = ctx;
  // Use background colour as fallback so a missing image doesn't render as a
  // dark primary-coloured slide that looks like a broken title slide.
  s.background = { fill: hex(t.colors.background) };
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    tryAddImage(s, img.src, { x: 0, y: 0, w: W, h: H }, warnings);
    // Overlay bar, mirroring .sl-full-bleed__caption — the image fills the
    // whole slide edge-to-edge so the caption can't just sit "below" it.
    if (img.caption) {
      const barH = 0.5;
      s.addText(img.caption, {
        x: 0, y: H - barH, w: W, h: barH,
        fontSize: 12, italic: true, color: 'FFFFFF',
        fontFace: firstFont(t.fonts.body),
        fill: { color: '000000', transparency: 35 },
        align: 'center', valign: 'middle',
      });
    }
  }
}
