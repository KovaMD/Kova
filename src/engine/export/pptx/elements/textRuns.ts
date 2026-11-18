import type { SlideElement } from '../../../types';
import type { PptxTextRun } from '../pptxTypes';
import type { Area, ElementRenderContext } from '../context';
import { hex } from '../colour';
import { fitRunsScale, scaleRuns } from '../fit';
import { stepShapeName } from '../timing';
import { firstFont, pptxIconFont } from '../fonts';
import { katexTexSource, stripHtml } from '../html';

// Text runs: inline HTML to pptxgenjs runs, plus the run builders for the
// elements that share one merged text box (paragraph, list, plain quote,
// math). Code, Mermaid, callout and TOC runs live in their own modules.
export type PptxRun = { text: string; options: Record<string, unknown> };

// Inline formatting state accumulated while walking down the DOM. Bundled
// into one object (rather than one positional bool per attribute) so adding
// a new inline format only touches this type and the two places that read
// or derive it, not every walk() call site.
export interface RunFormatting {
  bold: boolean;
  italic: boolean;
  isCode: boolean;
  isIcon: boolean;
  strike: boolean;
  underline: boolean;
  color: string;
  href: string | null;
}

// Options shared by every run regardless of node kind; callers layer on
// italic/fontFace since those two vary for the KaTeX-TeX-source case.
export function baseRunOptions(f: RunFormatting): Record<string, unknown> {
  return {
    color: f.color,
    ...(f.bold      ? { bold: true }                    : {}),
    ...(f.strike    ? { strike: true }                  : {}),
    ...(f.underline ? { underline: { style: 'sng' } }    : {}),
    ...(f.href      ? { hyperlink: { url: f.href } }     : {}),
  };
}

// Walk markdown-generated HTML (bold, italic, code, links) into PptxGenJS runs.
export function htmlToInlineRuns(
  html: string,
  defaultColor: string,
  codeFont: string,
  accentColor: string,
  iconFont: string,
  boldColor: string = defaultColor,
): PptxRun[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const runs: PptxRun[] = [];

  function walk(node: Node, f: RunFormatting) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (!text) return;
      runs.push({
        text,
        options: {
          ...baseRunOptions(f),
          ...(f.italic ? { italic: true }        : {}),
          // Icon glyphs always need their own font regardless of surrounding
          // code/bold/italic formatting — checked first so an icon inside a
          // stray `isCode` context (shouldn't happen, but not load-bearing on
          // the parser never producing one) still gets the right glyph.
          // No vertical lift to match .sl-icon's 0.05em (issue #282): the only
          // run-level offset is `baseline`, which PowerPoint and LibreOffice
          // treat as superscript and shrink the glyph to ~60%.
          ...(f.isIcon ? { fontFace: iconFont }
            : f.isCode ? { fontFace: codeFont } : {}),
        },
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      const tex = katexTexSource(el);
      if (tex !== null) {
        runs.push({
          text: tex,
          options: { ...baseRunOptions(f), italic: true },
        });
        return;
      }
      // Fallback: strip MathML and walk only the visual HTML layer once.
      if (el.classList?.contains('katex')) {
        el.querySelector('.katex-mathml')?.remove();
      }

      const isBold = tag === 'strong' || tag === 'b';
      // '#' is escUrl's sentinel for a stripped/invalid href (see markdownToSlides.ts) — never link to it.
      const linkHref = tag === 'a' ? el.getAttribute('href') : null;
      const nextHref = linkHref && linkHref !== '#' ? linkHref : f.href;
      for (const child of node.childNodes) {
        walk(child, {
          bold: f.bold || isBold,
          italic: f.italic || tag === 'em' || tag === 'i',
          isCode: f.isCode || tag === 'code',
          isIcon: f.isIcon || (tag === 'span' && el.classList?.contains('sl-icon')),
          strike: f.strike || tag === 'del' || tag === 's',
          underline: f.underline || tag === 'u',
          // Link colour wins over bold colour when both apply (e.g. a bolded
          // link, or bold text nested inside a link), matching the existing
          // precedent that link text always takes accentColor regardless of
          // surrounding formatting. `nextHref` stays truthy for every
          // descendant of an `<a>`, so this holds even past an intervening
          // <strong>.
          color: (tag === 'a' || nextHref) ? accentColor : (isBold ? boldColor : f.color),
          href: nextHref,
        });
      }
    }
  }

  for (const child of div.childNodes) {
    walk(child, {
      bold: false, italic: false, isCode: false, isIcon: false, strike: false, underline: false,
      color: defaultColor, href: null,
    });
  }
  return runs.length > 0 ? runs : [{ text: stripHtml(html) || ' ', options: { color: defaultColor } }];
}
// ── Merged text box ───────────────────────────────────────────────────────────

/** The runs of one merged text box. `startParagraph` tracks which 0-based
 *  OOXML paragraph (<a:p>) each pushed run lands in, purely from the callers'
 *  own knowledge of where paragraphs begin: a list item has no explicit
 *  `breakLine` (pptxgenjs starts a new paragraph on its own whenever a run
 *  carries a `bullet` option, confirmed by inspecting actual export output),
 *  so paragraph boundaries are asserted at each point a renderer already knows
 *  semantically starts a new paragraph, not inferred generically from run
 *  options. `paraSteps` collects, per build step, every paragraph index that
 *  step should reveal, consumed by applyStepAnimations() once this shape's
 *  real OOXML shape id is known. */
export interface TextRunBuilder {
  runs: PptxTextRun[];
  paraSteps: Map<number, number[]>;
  startParagraph(step: number | undefined): void;
}

export function createTextRunBuilder(): TextRunBuilder {
  const runs: PptxTextRun[] = [];
  let paraIdx = -1; // -1 so the first startParagraph() call lands on 0
  const paraSteps = new Map<number, number[]>();
  return {
    runs,
    paraSteps,
    startParagraph(step: number | undefined) {
      paraIdx += 1;
      if (step === undefined) return;
      const list = paraSteps.get(step) ?? [];
      list.push(paraIdx);
      paraSteps.set(step, list);
    },
  };
}

/** htmlToInlineRuns with the slide's body colours and fonts. */
function inlineRuns(ctx: ElementRenderContext, html: string): PptxRun[] {
  const { theme: t } = ctx;
  const { text: tc, bold: boldColor } = ctx.colours;
  return htmlToInlineRuns(html, tc, firstFont(t.fonts.code), hex(t.colors.accent), pptxIconFont(t), boldColor);
}

export function appendParagraphRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'paragraph' }>,
) {
  if (el.text.trim()) {
    b.startParagraph(el.step);
    const paraRuns = inlineRuns(ctx, el.html);
    paraRuns.forEach((run, ri) => {
      b.runs.push({ text: run.text, options: { fontSize: 18, ...run.options, breakLine: ri === paraRuns.length - 1 } });
    });
  }
}

export function appendListRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'list' }>,
) {
  for (const item of el.items) {
    b.startParagraph(el.step ?? item.step);
    const bulletBase = {
      bullet: el.ordered ? { type: 'number', style: 'arabicPeriod' } as const : true as const,
      fontSize: 18,
      paraSpaceAfter: 4,
    };
    const itemRuns = inlineRuns(ctx, item.html);
    b.runs.push({ text: itemRuns[0].text, options: { ...itemRuns[0].options, ...bulletBase } });
    for (let ri = 1; ri < itemRuns.length; ri++) {
      b.runs.push({ text: itemRuns[ri].text, options: { fontSize: 18, ...itemRuns[ri].options } });
    }
    for (const child of item.children) {
      b.startParagraph(el.step ?? child.step);
      const childBase = { bullet: true as const, indentLevel: 1, fontSize: 16, paraSpaceAfter: 3 };
      const childRuns = inlineRuns(ctx, child.html);
      b.runs.push({ text: childRuns[0].text, options: { ...childRuns[0].options, ...childBase } });
      for (let ri = 1; ri < childRuns.length; ri++) {
        b.runs.push({ text: childRuns[ri].text, options: { fontSize: 16, ...childRuns[ri].options } });
      }
    }
  }
}

/** A plain (non-callout) blockquote mixed into the text box. */
export function appendQuoteRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'blockquote' }>,
) {
  b.startParagraph(el.step);
  b.runs.push({
    text: `“${el.text}”`,
    options: { italic: true, fontSize: 18, breakLine: true },
  });
  if (el.attribution) {
    b.startParagraph(el.step);
    b.runs.push({
      text: `— ${el.attribution}`,
      options: { fontSize: 14, color: hex(ctx.theme.colors.accent), breakLine: true },
    });
  }
}

export function appendMathRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'math' }>,
) {
  b.startParagraph(el.step);
  b.runs.push({ text: el.value, options: { fontFace: firstFont(ctx.theme.fonts.code), fontSize: 15, breakLine: true } });
  if (el.caption) {
    b.startParagraph(el.step);
    b.runs.push({ text: el.caption, options: { fontSize: 11, italic: true, breakLine: true, paraSpaceAfter: 4 } });
  }
}

/** Draws the accumulated runs as one text box filling `area`. The runs are
 *  pre-scaled to fit `fitArea` (the top share of `area` when a table, image
 *  or media sits below the text). */
export function addTextBox(ctx: ElementRenderContext, b: TextRunBuilder, area: Area, fitArea: Area) {
  const { s, theme: t, warnings, steps: stepTargets } = ctx;
  const tc = ctx.colours.text;
  const { runs, paraSteps } = b;
  if (runs.length === 0) return;
  const objectName = paraSteps.size > 0 ? stepShapeName(area, 'text') : undefined;
  const fit = fitRunsScale(runs, fitArea);
  if (fit.overflow) {
    const label = runs[0].text.trim().slice(0, 40);
    warnings.push(
      `Text too long for the slide — scaled down to ${Math.round(fit.scale * 100)}% and may still overflow${label ? ` (starts: "${label}")` : ''}`,
    );
  }
  s.addText(scaleRuns(runs, fit.scale), {
    x: area.x, y: area.y, w: area.w, h: area.h,
    fontSize: Math.max(1, Math.round(18 * fit.scale * 2) / 2), color: tc,
    fontFace: firstFont(t.fonts.body),
    valign: 'top', wrap: true,
    // The runs are already pre-scaled to fit (fitRunsScale above). shrinkText
    // additionally sets PowerPoint's "Shrink text on overflow" flag, so the
    // box keeps fitting as the recipient edits it.
    shrinkText: true,
    ...(objectName ? { objectName } : {}),
  });
  if (objectName) {
    for (const [step, paragraphs] of paraSteps) {
      stepTargets.push({ step, objectName, paragraphs });
    }
  }
}
