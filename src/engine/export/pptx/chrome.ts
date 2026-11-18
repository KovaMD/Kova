// Slide chrome drawn over every layout: header and footer bars, the theme
// logo and the academic references block.

import { parseChannels } from '../mermaidExportTheme';
import type { Theme } from '../../theme';
import type { FooterFrame } from '../../render/slideModel';
import type { PptxSlide } from './pptxTypes';
import type { SlideRenderContext } from './context';
import { hex } from './colour';
import { firstFont, pptxIconFont } from './fonts';
import { FOOT_H, HEAD_H, M, W } from './geometry';
import { htmlToInlineRuns } from './elements/textRuns';

// ── Academic references ───────────────────────────────────────────────────────

function blendColor(fg: string, bg: string, alpha: number): string {
  const [fr, fg2, fb] = parseChannels(hex(fg));
  const [br, bg2, bb] = parseChannels(hex(bg));
  const r = Math.round(fr * alpha + br * (1 - alpha));
  const g = Math.round(fg2 * alpha + bg2 * (1 - alpha));
  const b = Math.round(fb * alpha + bb * (1 - alpha));
  return [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function addReferences(ctx: SlideRenderContext, hasFoot: boolean) {
  const { s, theme: t, slideH: H } = ctx;
  const refs = ctx.slide.references;
  const tc = ctx.colours.text;
  const REF_H = Math.min(0.06 + refs.length * 0.17, H * 0.35);
  const bottomPad = hasFoot ? FOOT_H + 0.08 : 0.15;
  const color = blendColor(tc, t.colors.background, 0.60);
  const codeFont = firstFont(t.fonts.code);
  const accentColor = hex(t.colors.accent);
  const runs = refs.flatMap((ref, i) => {
    const refRuns = htmlToInlineRuns(ref, color, codeFont, accentColor, pptxIconFont(t), color);
    return refRuns.map((run, ri) => ({
      text: run.text,
      options: { fontSize: 7, ...run.options, color, breakLine: ri === refRuns.length - 1 && i < refs.length - 1 },
    }));
  });
  s.addText(runs, {
    x: W / 2, y: H - bottomPad - REF_H, w: W / 2 - M, h: REF_H,
    fontSize: 7, color,
    fontFace: firstFont(t.fonts.body),
    align: 'right', valign: 'bottom',
    wrap: true,
  });
}

// ── Header / Footer bars ──────────────────────────────────────────────────────

// Mirrors the BarText component and .sl-bar-parts CSS (issue #30/#44).
// Receives pre-split segments (split from the template *before* variable resolution
// so a doc title containing `|` is never treated as a column separator).
function addBarText(
  s: PptxSlide,
  segments: string[],
  x: number, y: number, w: number, h: number,
  fontSize: number, color: string, fontFace: string,
  objectName: string,
) {
  if (segments.length <= 1) {
    s.addText(segments[0] ?? '', { x, y, w, h, fontSize, color, fontFace, align: 'left', valign: 'middle', objectName });
    return;
  }
  const [left = '', center = '', ...rest] = segments;
  const right = rest.join(' | ');
  const colW = w / 3;
  if (left)   s.addText(left,   { x,            y, w: colW, h, fontSize, color, fontFace, align: 'left',   valign: 'middle', objectName });
  if (center) s.addText(center, { x: x + colW,  y, w: colW, h, fontSize, color, fontFace, align: 'center', valign: 'middle', objectName });
  if (right)  s.addText(right,  { x: x + colW * 2, y, w: colW, h, fontSize, color, fontFace, align: 'right',  valign: 'middle', objectName });
}

export function addHeaderBar(s: PptxSlide, t: Theme, segs: string[]) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: HEAD_H,
    fill: { color: hex(t.colors.primary) },
    line: { type: 'none' },
  });
  if (segs.some(Boolean)) {
    addBarText(s, segs, M, 0, W - M * 2, HEAD_H, 10, hex(t.colors.title_text), firstFont(t.fonts.body), 'kova:header-text');
  }
}

export function addFooterBar(s: PptxSlide, t: Theme, footer: FooterFrame, H: number) {
  // The CSS footer renders as a thin border-top line, not a filled bar —
  // use a thin accent-coloured rectangle to match the live preview.
  const footY = H - FOOT_H;
  s.addShape('rect', {
    x: 0, y: footY, w: W, h: 0.02,
    fill: { color: hex(t.colors.accent) },
    line: { type: 'none' },
  });
  const showNum = footer.showSlideNumber;
  const segs = footer.segments;
  const textW = W - M * 2 - (showNum ? 1.1 : 0);
  if (footer.hasText) {
    addBarText(s, segs, M, footY + 0.02, textW, FOOT_H - 0.02, 9, hex(t.colors.text), firstFont(t.fonts.body), 'kova:footer-text');
  }
  if (showNum) {
    // PPTX keeps its "n / total" label; the preview shows only "n" (known
    // difference, the model exposes just the numbers).
    s.addText(`${footer.slideNumber} / ${footer.totalSlides}`, {
      x: W - M - 1.1, y: footY + 0.02, w: 1.1, h: FOOT_H - 0.02,
      fontSize: 9, color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.body),
      align: 'right', valign: 'middle',
      objectName: 'kova:slidenum',
    });
  }
}

export function addLogo(
  s: PptxSlide,
  logoDataUrl: string,
  logoAr: number | null,
  position: Theme['logo_position'],
  opacity: number,
  H: number,
) {
  const LOGO_H = 0.35;
  const LOGO_W = logoAr ? LOGO_H * logoAr : 0.7;
  const PAD    = 0.12;
  let lx: number;
  let ly: number;
  switch (position) {
    case 'top-left':     lx = PAD;                ly = PAD; break;
    case 'top-right':    lx = W - PAD - LOGO_W;   ly = PAD; break;
    case 'bottom-left':  lx = PAD;                ly = H - PAD - LOGO_H; break;
    case 'bottom-right':
    default:             lx = W - PAD - LOGO_W;   ly = H - PAD - LOGO_H; break;
  }
  const transparency = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 100);
  try {
    s.addImage({ data: logoDataUrl, x: lx, y: ly, w: LOGO_W, h: LOGO_H, transparency, objectName: 'kova:logo' });
  } catch { /* ignore */ }
}
