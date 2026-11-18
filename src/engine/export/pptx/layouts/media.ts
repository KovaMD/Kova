import type { Area, SlideRenderContext } from '../context';
import { hex } from '../colour';
import { firstFont } from '../fonts';
import { M, W } from '../geometry';
import { addMediaTextFallback, tryAddLocalVideo, tryAddOnlineVideo } from '../elements/media';

export function addMediaSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings } = ctx;
  const { y: cy, h: ch } = ctx.area;
  const tc = ctx.colours.text;
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
  const yt    = slide.elements.find((e) => e.type === 'youtube');
  const vid   = slide.elements.find((e) => e.type === 'video');
  const poll  = slide.elements.find((e) => e.type === 'poll');

  const both  = yt && poll;
  const halfH = (bodyH - 0.2) / 2;
  const full: Area = { x: M, y: bodyY, w: W - M * 2, h: bodyH };
  const ytArea: Area = { x: M, y: bodyY, w: W - M * 2, h: both ? halfH : bodyH };

  if (vid && vid.type === 'video') {
    if (!tryAddLocalVideo(s, vid.src, full, warnings)) {
      addMediaTextFallback(ctx, vid.label || 'Video', vid.src, full);
    }
  }

  if (yt && yt.type === 'youtube') {
    if (!tryAddOnlineVideo(s, yt.url, ytArea, warnings)) {
      addMediaTextFallback(ctx, yt.label || 'YouTube Video', yt.url, ytArea);
    }
  }
  if (poll && poll.type === 'poll') {
    const pollY = both ? bodyY + halfH + 0.2 : bodyY;
    s.addText([
      { text: poll.label || 'QR Code', options: { fontSize: 20, bold: true, breakLine: true } },
      { text: poll.url, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: pollY, w: W - M * 2, h: both ? halfH : bodyH,
      color: tc, fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  }
}
