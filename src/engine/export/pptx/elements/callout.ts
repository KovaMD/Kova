import type { SlideElement } from '../../../types';
import type { Area, ElementRenderContext } from '../context';
import type { Theme } from '../../../theme';
import { calloutBodySpec, calloutTitleSpec, calloutTypeColor, mixHex, type CalloutTextSpec } from '../../../calloutColors';
import { cssColorToHex, hex } from '../colour';
import { makeStepRegistrar } from '../timing';
import { firstFont } from '../fonts';
import type { TextRunBuilder } from './textRuns';
// ── Callout/admonition box (mirrors .sl-callout in SlideRenderer.css) ─────────
// Colors are fixed per type unless the theme sets colors.callout_colors — same
// rationale as the web renderer: users expect note=blue/warning=amber/danger=red
// regardless of theme. Title/body mixing mirrors the CSS color-mix (issue #283).
// All three colours are PPTX hex (no #); tc is the slide's text colour.
export function calloutPalette(t: Theme, type: string | undefined, tc: string): { color: string; title: string; body: string } {
  const cc = t.colors.callout_colors;
  const color = cssColorToHex(calloutTypeColor(cc, type));
  const pick = (spec: CalloutTextSpec) => mixHex(color, spec.base ? cssColorToHex(spec.base, tc) : tc, spec.mix);
  return { color, title: pick(calloutTitleSpec(cc)), body: pick(calloutBodySpec(cc)) };
}

export function addCalloutBlock(
  ctx: ElementRenderContext, el: Extract<SlideElement, { type: 'blockquote' }>, area: Area, step?: number,
) {
  const { s, theme: t, steps: stepTargets } = ctx;
  const tc = ctx.colours.text;
  const { color, title: titleColor, body: bodyColor } = calloutPalette(t, el.calloutType, tc);
  const BAR_W = 0.06;
  const PAD   = 0.15;

  // Background, accent bar, title, and body all reveal together on one click.
  const { stepName, registerStep } = makeStepRegistrar(step, area, 'callout', stepTargets);

  const bgName = stepName();
  s.addShape('rect', {
    x: area.x, y: area.y, w: area.w, h: area.h,
    fill: { color: hex(t.colors.background) },
    line: { color, width: 0.75, transparency: 60 },
    ...(bgName ? { objectName: bgName } : {}),
  });
  registerStep(bgName);

  const barName = stepName();
  s.addShape('rect', {
    x: area.x, y: area.y, w: BAR_W, h: area.h,
    fill: { color },
    line: { type: 'none' },
    ...(barName ? { objectName: barName } : {}),
  });
  registerStep(barName);

  const titleH = 0.35;
  const titleName = stepName();
  s.addText(el.title ?? '', {
    x: area.x + BAR_W + PAD, y: area.y + PAD * 0.5, w: area.w - BAR_W - PAD * 1.5, h: titleH,
    fontSize: 15, bold: true,
    color: titleColor,
    fontFace: firstFont(t.fonts.body),
    valign: 'top',
    ...(titleName ? { objectName: titleName } : {}),
  });
  registerStep(titleName);

  if (el.text.trim()) {
    const bodyName = stepName();
    s.addText(el.text, {
      x: area.x + BAR_W + PAD, y: area.y + PAD * 0.5 + titleH, w: area.w - BAR_W - PAD * 1.5, h: area.h - titleH - PAD,
      fontSize: 14,
      color: bodyColor,
      fontFace: firstFont(t.fonts.body),
      valign: 'top', wrap: true,
      shrinkText: true,
      ...(bodyName ? { objectName: bodyName } : {}),
    });
    registerStep(bodyName);
  }
}
/** A callout mixed with other content: title and body as text-box runs. */
export function appendCalloutRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'blockquote' }>,
) {
  b.startParagraph(el.step);
  const palette = calloutPalette(ctx.theme, el.calloutType, ctx.colours.text);
  b.runs.push({
    text: el.title ?? '',
    options: { bold: true, fontSize: 16, color: palette.title, breakLine: true, paraSpaceAfter: 2 },
  });
  if (el.text.trim()) {
    b.startParagraph(el.step);
    b.runs.push({ text: el.text, options: { fontSize: 16, color: palette.body, breakLine: true, paraSpaceAfter: 4 } });
  }
}
