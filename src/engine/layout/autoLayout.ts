import type { SlideElement, LayoutType } from '../types';

/**
 * Analyses the elements of a slide and returns the best-fit layout.
 * Rules are checked in priority order — first match wins.
 */
export function detectLayout(
  elements: SlideElement[],
  titleLevel: number,
  hasTitle: boolean,
): LayoutType {
  const has = (t: SlideElement['type']) => elements.some((e) => e.type === t);

  // ── Highest-priority special types ───────────────────────────────────────

  // Media: YouTube or poll present anywhere on the slide
  if (has('youtube') || has('poll')) return 'media';

  // Two-column: column-break separator present
  if (has('column-break')) return 'two-column';

  // ── Code-only ────────────────────────────────────────────────────────────

  // Code block (with or without a title heading)
  const bodyElements = hasTitle
    ? elements.filter((e) => e.type !== 'column-break')
    : elements;

  // Code layout only when the slide is code/mermaid-only (no other content to split with)
  if (bodyElements.length > 0 && bodyElements.every((e) => e.type === 'code' || e.type === 'mermaid')) {
    return 'code';
  }

  // ── No-title layouts ──────────────────────────────────────────────────────

  if (!hasTitle) {
    if (bodyElements.length === 1) {
      if (bodyElements[0].type === 'image') return 'full-bleed';
      if (bodyElements[0].type === 'blockquote') return 'quote';
    }
    if (bodyElements.length === 0) return 'title'; // empty slide fallback
  }

  // ── Title-only ────────────────────────────────────────────────────────────

  if (hasTitle && bodyElements.length === 0) {
    return titleLevel <= 1 ? 'title' : 'section';
  }

  // ── Title + image combinations ────────────────────────────────────────────

  const images    = bodyElements.filter((e) => e.type === 'image');
  const nonImages = bodyElements.filter((e) => e.type !== 'image');

  if (hasTitle && images.length === 1 && nonImages.length === 0) return 'title-image';

  // Traditional split: exactly 1 image + 1 pure-text element (paragraph/list)
  const isPureText = (t: string) => t === 'paragraph' || t === 'list';
  if (hasTitle && images.length === 1 && nonImages.length === 1 && isPureText(nonImages[0].type)) {
    return 'split';
  }

  // ── BSP auto-tiling ───────────────────────────────────────────────────────
  // Trigger for 2–3 elements where the mix is visually diverse enough
  // to benefit from side-by-side rendering. Skip if everything is plain
  // paragraph/list (stacked looks better for all-text slides).

  const allPureText = bodyElements.every((e) => isPureText(e.type));

  if (!allPureText && (bodyElements.length === 2 || bodyElements.length === 3)) return 'bsp';

  // ── Grid: 4+ distinct content elements ───────────────────────────────────

  if (bodyElements.length >= 4) return 'grid';

  // ── Default ───────────────────────────────────────────────────────────────

  return 'title-content';
}
