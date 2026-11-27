import type { SlideElement } from '../../../types';
import type { Area, ElementRenderContext } from '../context';
import { addCalloutBlock, appendCalloutRuns } from './callout';
import { addCodeBlock, appendCodeRuns, appendMermaidRuns } from './code';
import { addImageElement } from './image';
import { addMediaElement } from './media';
import { addProgressBars } from './progress';
import { addTableElement } from './table';
import {
  addTextBox, appendListRuns, appendMathRuns, appendParagraphRuns, appendQuoteRuns, createTextRunBuilder,
} from './textRuns';
import { appendTocRuns } from './toc';

/** Draws a group of slide elements into `area`. A dispatcher over the
 *  per-element modules: a lone image, code block or callout fills the area;
 *  otherwise text-like elements share one merged text box at the top, with
 *  progress bars centred and any table, images and media stacked below. */
export function addElements(ctx: ElementRenderContext, elements: SlideElement[], area: Area) {
  if (elements.length === 0) return;

  // Single image fills the area
  if (elements.length === 1 && elements[0].type === 'image') {
    addImageElement(ctx, elements[0], area);
    return;
  }

  // Single code element — render with full dark-background styling. Renders
  // as 3-4 separate pptxgenjs shapes (background rect, inner rect, optional
  // language badge, code text) rather than one — addCodeBlock registers each
  // of them under the same step so they all reveal together on one click
  // (see the ClickTarget[] batching in applyStepAnimations), rather than
  // animating just one piece while the rest stay visible. Same reasoning
  // applies to the callout case just below.
  if (elements.length === 1 && elements[0].type === 'code') {
    const el = elements[0];
    addCodeBlock(ctx, el.value, el.lang, area, el.step);
    return;
  }

  // Single callout — render as a bordered/accent-barred box, not a plain quote
  if (elements.length === 1 && elements[0].type === 'blockquote' && elements[0].calloutType) {
    addCalloutBlock(ctx, elements[0], area, elements[0].step);
    return;
  }

  // Build one merged text box from all text-based elements.
  const text = createTextRunBuilder();
  for (const el of elements) {
    switch (el.type) {
      case 'paragraph':  appendParagraphRuns(ctx, text, el); break;
      case 'list':       appendListRuns(ctx, text, el); break;
      case 'blockquote':
        if (el.calloutType) appendCalloutRuns(ctx, text, el);
        else appendQuoteRuns(ctx, text, el);
        break;
      case 'toc':        appendTocRuns(ctx, text, el); break;
      case 'code':       appendCodeRuns(ctx, text, el); break;
      case 'math':       appendMathRuns(ctx, text, el); break;
      case 'mermaid':    appendMermaidRuns(ctx, text, el); break;
      // Video and YouTube are placed as real media objects below (with
      // text/image/table), not as runs; images and tables likewise.
      default: break;
    }
  }

  const tableEl = elements.find((e) => e.type === 'table');
  const imageEls = elements.filter((e) => e.type === 'image') as Extract<SlideElement, { type: 'image' }>[];
  const mediaEls = elements.filter((e) => e.type === 'youtube' || e.type === 'video');
  const hasBelow = tableEl?.type === 'table' || imageEls.length > 0 || mediaEls.length > 0;
  const textFrac = text.runs.length > 0 ? Math.min(0.5, 0.15 + text.runs.length * 0.08) : 0;

  // With a table/image below, the text only owns the top textFrac share.
  addTextBox(ctx, text, area, hasBelow ? { ...area, h: area.h * textFrac } : area);

  const progressEls = elements.filter((e) => e.type === 'progress') as Extract<SlideElement, { type: 'progress' }>[];
  addProgressBars(ctx, progressEls, area);

  // Table + any remaining images (elements.length === 1 && type === 'image' is
  // caught by the fast path at the top of this function; this is for an image
  // that shares its area with other content, e.g. a table, or any element mix
  // reached via an explicit ||| column break) share the space left below the
  // text runs. Without this, such images used to fall through to the switch's
  // `default` case above and vanish from the export with no warning.
  if (hasBelow) {
    const belowY = area.y + area.h * textFrac;
    const belowH = area.h * (1 - textFrac - 0.02);
    // With both a table and image(s) present, give the table the larger share
    // (it usually carries the primary content) and stack the image(s) below it.
    const tableFrac = tableEl?.type === 'table' && (imageEls.length > 0 || mediaEls.length > 0) ? 0.6 : 1;

    if (tableEl?.type === 'table') {
      addTableElement(ctx, tableEl, { x: area.x, y: belowY, w: area.w, h: belowH * tableFrac });
    }

    const mediaY = belowY + belowH * (tableEl?.type === 'table' ? tableFrac : 0);
    const mediaH = belowH * (1 - (tableEl?.type === 'table' ? tableFrac : 0));
    const stackCount = imageEls.length + mediaEls.length;
    const perH = stackCount > 0 ? mediaH / stackCount : mediaH;
    let stackI = 0;

    imageEls.forEach((img) => {
      const y = mediaY + stackI * perH;
      stackI += 1;
      addImageElement(ctx, img, { x: area.x, y, w: area.w, h: perH });
    });

    mediaEls.forEach((el) => {
      const y = mediaY + stackI * perH;
      stackI += 1;
      addMediaElement(ctx, el, { x: area.x, y, w: area.w, h: perH });
    });
  }
}
