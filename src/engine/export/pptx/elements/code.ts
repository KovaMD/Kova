import hljs from 'highlight.js';
import type { SlideElement } from '../../../types';
import type { Area, ElementRenderContext } from '../context';
import { hex } from '../colour';
import { makeStepRegistrar } from '../timing';
import { firstFont } from '../fonts';
import type { PptxRun, TextRunBuilder } from './textRuns';
// ── Syntax-highlight helpers (github-dark colour map) ─────────────────────────

export const HLJS_DEFAULT = 'C9D1D9'; // .hljs base text colour

export const HLJS_STYLE: Record<string, { color: string; bold?: true; italic?: true }> = {
  'hljs-keyword':           { color: 'FF7B72' },
  'hljs-doctag':            { color: 'FF7B72' },
  'hljs-template-tag':      { color: 'FF7B72' },
  'hljs-template-variable': { color: 'FF7B72' },
  'hljs-type':              { color: 'FF7B72' },
  'hljs-title':             { color: 'D2A8FF' },
  'hljs-attr':              { color: '79C0FF' },
  'hljs-attribute':         { color: '79C0FF' },
  'hljs-literal':           { color: '79C0FF' },
  'hljs-meta':              { color: '79C0FF' },
  'hljs-number':            { color: '79C0FF' },
  'hljs-operator':          { color: '79C0FF' },
  'hljs-variable':          { color: '79C0FF' },
  'hljs-selector-attr':     { color: '79C0FF' },
  'hljs-selector-class':    { color: '79C0FF' },
  'hljs-selector-id':       { color: '79C0FF' },
  'hljs-regexp':            { color: 'A5D6FF' },
  'hljs-string':            { color: 'A5D6FF' },
  'hljs-built_in':          { color: 'FFA657' },
  'hljs-symbol':            { color: 'FFA657' },
  'hljs-comment':           { color: '8B949E' },
  'hljs-code':              { color: '8B949E' },
  'hljs-formula':           { color: '8B949E' },
  'hljs-name':              { color: '7EE787' },
  'hljs-quote':             { color: '7EE787' },
  'hljs-selector-tag':      { color: '7EE787' },
  'hljs-selector-pseudo':   { color: '7EE787' },
  'hljs-subst':             { color: 'C9D1D9' },
  'hljs-section':           { color: '1F6FEB', bold: true },
  'hljs-bullet':            { color: 'F2CC60' },
  'hljs-emphasis':          { color: 'C9D1D9', italic: true },
  'hljs-strong':            { color: 'C9D1D9', bold: true },
  'hljs-addition':          { color: 'AFF5B4' },
  'hljs-deletion':          { color: 'FFDCD7' },
};

// Walk the hljs HTML DOM and produce a flat list of coloured text runs.
// Newlines inside runs are converted to explicit breakLine: true entries.
export function hljsHtmlToRuns(html: string): PptxRun[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const runs: PptxRun[] = [];

  function walk(node: Node, color: string, bold: boolean, italic: boolean) {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? '';
      if (!raw) return;
      const lines = raw.split('\n');
      lines.forEach((line, i) => {
        const last = i === lines.length - 1;
        if (last && line === '') return; // trailing \n — skip phantom fragment
        runs.push({
          text: line || ' ',
          options: {
            color,
            ...(bold   ? { bold }   : {}),
            ...(italic ? { italic } : {}),
            ...(!last  ? { breakLine: true } : {}),
          },
        });
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const cls = (node as Element).getAttribute('class') ?? '';
      let nodeColor = color;
      let nodeBold  = bold;
      let nodeItalic = italic;
      for (const c of cls.split(/\s+/)) {
        const s = HLJS_STYLE[c];
        if (s) { nodeColor = s.color; nodeBold = bold || !!s.bold; nodeItalic = italic || !!s.italic; break; }
      }
      for (const child of node.childNodes) walk(child, nodeColor, nodeBold, nodeItalic);
    }
  }

  for (const child of div.childNodes) walk(child, HLJS_DEFAULT, false, false);
  return runs;
}

// ── Styled code block (reused by addCodeSlide and addElements) ────────────────

export function addCodeBlock(
  ctx: ElementRenderContext, value: string, lang: string | undefined, area: Area, step?: number,
) {
  const { s, theme: t, steps: stepTargets } = ctx;
  const codeBgOverride = ctx.colours.codeBg;
  // A code block is 3-4 separate pptxgenjs shapes (outer rect, optional lang
  // badge, inner rect, code text) rather than one — registering each of them
  // as its own whole-shape target under the *same* step, all inside the same
  // clickEffect (see the ClickTarget[] batching in applyStepAnimations),
  // reveals the whole block together on one click instead of animating just
  // one piece of it while the rest stay visible.
  const { stepName, registerStep } = makeStepRegistrar(step, area, 'code', stepTargets);

  const OUTER_PAD = 0.15;
  const LANG_H    = 0.25;
  const INNER_PAD = 0.15;
  // 12pt text at ~1.2 line spacing in PowerPoint ≈ 0.22" per line
  const LINE_H    = 0.22;

  const lineCount = Math.max(1, value.split('\n').length);
  const langExtra = lang ? LANG_H + 0.06 : 0;
  const textH     = lineCount * LINE_H;

  // Natural height of the whole code block; clamp to the available area
  const naturalH = OUTER_PAD + langExtra + INNER_PAD + textH + INNER_PAD + OUTER_PAD;
  const blockH   = Math.min(naturalH, area.h);

  // Derive inner dimensions from the clamped block height so nothing overflows.
  const innerAvail   = blockH - OUTER_PAD * 2 - langExtra;
  const innerH       = Math.max(INNER_PAD * 2 + LINE_H, Math.min(INNER_PAD + textH + INNER_PAD, innerAvail));
  const clampedTextH = Math.max(LINE_H, innerH - INNER_PAD * 2);

  // Vertically centre within the area
  const blockY = area.y + (area.h - blockH) / 2;

  // Outer area — code_bg background, no border (mirrors .sl-code)
  const codeBg = codeBgOverride ?? t.colors.code_bg;
  const outerName = stepName();
  s.addShape('rect', {
    x: area.x, y: blockY, w: area.w, h: blockH,
    fill: { color: hex(codeBg) },
    line: { type: 'none' },
    ...(outerName ? { objectName: outerName } : {}),
  });
  registerStep(outerName);

  // Language badge — uppercase, accent, letter-spaced (mirrors .sl-code__lang)
  if (lang) {
    const langName = stepName();
    s.addText(lang.toUpperCase(), {
      x: area.x + OUTER_PAD, y: blockY + OUTER_PAD,
      w: 3, h: LANG_H,
      fontSize: 9, color: hex(t.colors.accent),
      fontFace: firstFont(t.fonts.code),
      align: 'left', valign: 'bottom',
      charSpacing: 1,
      ...(langName ? { objectName: langName } : {}),
    });
    registerStep(langName);
  }

  // Inner dark rect — use the github-dark background (#0d1117) for proper contrast.
  // mixBlack(code_bg, 0.4) only yields medium gray for light themes, making text
  // hard to read; the actual highlight.js github-dark theme hardcodes #0d1117.
  const innerX = area.x + OUTER_PAD;
  const innerY = blockY + OUTER_PAD + langExtra;
  const innerW = area.w - OUTER_PAD * 2;

  const innerName = stepName();
  s.addShape('rect', {
    x: innerX, y: innerY, w: innerW, h: innerH,
    fill: { color: '0D1117' },
    line: { type: 'none' },
    ...(innerName ? { objectName: innerName } : {}),
  });
  registerStep(innerName);

  // Syntax-highlight and convert to coloured PptxGenJS runs (github-dark palette).
  const highlighted = lang && hljs.getLanguage(lang)
    ? hljs.highlight(value, { language: lang })
    : hljs.highlightAuto(value);
  const codeRuns = hljsHtmlToRuns(highlighted.value);

  const textName = stepName();
  s.addText(codeRuns.length > 0 ? codeRuns : [{ text: value || ' ', options: { color: HLJS_DEFAULT } }], {
    x: innerX + INNER_PAD, y: innerY + INNER_PAD,
    w: innerW - INNER_PAD * 2,
    h: clampedTextH,
    fontSize: 12, color: HLJS_DEFAULT,
    fontFace: firstFont(t.fonts.code),
    align: 'left', valign: 'top',
    wrap: false,
    // Box height is already clamped to the slide above; shrinkText is a
    // PowerPoint-side autofit hint for excess *line count* (applied on first
    // edit/resize in PowerPoint — see the comment in addElements). It does
    // nothing for excess *line length* since wrap is intentionally off here
    // to preserve code indentation/alignment.
    shrinkText: true,
    ...(textName ? { objectName: textName } : {}),
  });
  registerStep(textName);
}
// ── Plain-text fallbacks inside a merged text box ─────────────────────────────

export function appendCodeRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'code' }>,
) {
  // Code mixed with other elements: fall back to plain monospaced text.
  // (Single-element code is caught by addElements and rendered with full styling.)
  b.startParagraph(el.step);
  b.runs.push({ text: el.value, options: { fontFace: firstFont(ctx.theme.fonts.code), fontSize: 13, breakLine: true } });
}

export function appendMermaidRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'mermaid' }>,
) {
  // Reached only when resolveSlideImages' mermaidToDataUrl failed to
  // rasterise the diagram (already pushed a warning there) — this had
  // no case at all before, so a diagram mixed with other content
  // silently vanished with nothing in its place, unlike code/math's
  // plain-text fallback.
  b.startParagraph(el.step);
  b.runs.push({ text: el.value, options: { fontFace: firstFont(ctx.theme.fonts.code), fontSize: 13, breakLine: true } });
  if (el.caption) {
    b.startParagraph(el.step);
    b.runs.push({ text: el.caption, options: { fontSize: 11, italic: true, breakLine: true, paraSpaceAfter: 4 } });
  }
}
