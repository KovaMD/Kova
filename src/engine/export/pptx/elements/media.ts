import type { SlideElement } from '../../../types';
import { extractYoutubeId } from '../../../media/youtube';
import type { PptxSlide } from '../pptxTypes';
import type { Area, ElementRenderContext } from '../context';
import { hex } from '../colour';
import { videoExtnFromDataUrl } from '../assets';
import { firstFont } from '../fonts';
export function addMediaTextFallback(
  ctx: ElementRenderContext,
  label: string,
  detail: string,
  area: Area,
) {
  const { s, theme: t } = ctx;
  s.addText([
    { text: '▶ ', options: { fontSize: 30, bold: true } },
    { text: label, options: { fontSize: 20, breakLine: true } },
    { text: detail, options: { fontSize: 11, color: hex(t.colors.accent) } },
  ], {
    x: area.x, y: area.y, w: area.w, h: area.h,
    color: ctx.colours.text, fontFace: firstFont(t.fonts.body),
    align: 'center', valign: 'middle', wrap: true,
  });
}

/** Embed a YouTube URL as an online media object (desktop PowerPoint). */
export function tryAddOnlineVideo(s: PptxSlide, url: string, area: Area, warnings: string[]): boolean {
  const id = extractYoutubeId(url);
  if (!id) return false;
  try {
    s.addMedia({
      type: 'online',
      link: `https://www.youtube.com/embed/${id}`,
      x: area.x, y: area.y, w: area.w, h: area.h,
    });
    return true;
  } catch {
    warnings.push(`YouTube embed could not be added to PPTX: ${url.slice(0, 80)}`);
    return false;
  }
}

/** Embed a pre-resolved `data:` video via pptxgenjs `addMedia`. */
export function tryAddLocalVideo(s: PptxSlide, src: string, area: Area, warnings: string[]): boolean {
  if (!src.startsWith('data:')) {
    warnings.push(`Video skipped (could not be fetched): ${src.slice(0, 80)}`);
    return false;
  }
  try {
    s.addMedia({
      type: 'video',
      data: src,
      extn: videoExtnFromDataUrl(src),
      x: area.x, y: area.y, w: area.w, h: area.h,
    });
    return true;
  } catch {
    warnings.push(`Embedded video could not be added to PPTX: ${src.slice(0, 60)}…`);
    return false;
  }
}
/** A YouTube or local video in `area`, falling back to a text card. */
export function addMediaElement(
  ctx: ElementRenderContext, el: Extract<SlideElement, { type: 'youtube' | 'video' }>, area: Area,
) {
  const { s, warnings } = ctx;
  if (el.type === 'youtube') {
    if (!tryAddOnlineVideo(s, el.url, area, warnings)) {
      addMediaTextFallback(ctx, el.label || 'YouTube Video', el.url, area);
    }
  } else if (el.type === 'video') {
    if (!tryAddLocalVideo(s, el.src, area, warnings)) {
      addMediaTextFallback(ctx, el.label || 'Video', el.src, area);
    }
  }
}
