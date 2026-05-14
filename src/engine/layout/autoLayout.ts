import type { SlideElement, LayoutType, ListItem } from '../types';

// ── Content density helpers ───────────────────────────────────────────────────

// Two-column layout kicks in when estimated visual lines exceed this.
// Column width is ~half the slide, so ~45 chars per line fits comfortably.
const OVERFLOW_LINE_THRESHOLD = 6;

/**
 * Counts logical elements, treating consecutive `progress` bars as a single
 * unit. This prevents individual bars from each consuming a grid/bsp pane.
 */
function logicalElementCount(elements: SlideElement[]): number {
  let count = 0;
  let inProgressRun = false;
  for (const el of elements) {
    if (el.type === 'progress') {
      if (!inProgressRun) { count++; inProgressRun = true; }
    } else {
      count++;
      inProgressRun = false;
    }
  }
  return count;
}

function estimateItemLines(item: ListItem): number {
  const self = Math.max(1, Math.ceil(item.text.length / 45));
  const children = item.children.reduce((n, c) => n + estimateItemLines(c), 0);
  return self + children;
}

function estimateLines(elements: SlideElement[]): number {
  let total = 0;
  for (const el of elements) {
    switch (el.type) {
      case 'list':
        total += el.items.reduce((n, item) => n + estimateItemLines(item), 0);
        break;
      case 'paragraph': {
        const lines = el.text.split('\n').filter(Boolean);
        total += lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 55)), 0);
        break;
      }
      case 'progress':
        total += 2;
        break;
      default:
        total += 2;
    }
  }
  return total;
}

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

  // ── H1 always produces a title/hero slide ────────────────────────────────
  // Paragraph elements are treated as subtitles; other content is ignored
  // in layout detection (TitleLayout renders them as subtitle lines).
  if (hasTitle && titleLevel === 1) return 'title';

  // ── Highest-priority special types ───────────────────────────────────────

  if (has('youtube') || has('poll')) return 'media';
  if (has('column-break')) return 'two-column';

  // ── Code-only ────────────────────────────────────────────────────────────

  const bodyElements = hasTitle
    ? elements.filter((e) => e.type !== 'column-break')
    : elements;

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

  // ── H2 section break ─────────────────────────────────────────────────────
  if (hasTitle && titleLevel === 2 && bodyElements.length === 0) return 'section';

  // ── Title + image combinations ────────────────────────────────────────────

  const images    = bodyElements.filter((e) => e.type === 'image');
  const nonImages = bodyElements.filter((e) => e.type !== 'image');

  if (hasTitle && images.length === 1 && nonImages.length === 0) return 'title-image';

  // Split: 1 image + any number of pure-text elements (paragraph/list/progress)
  // The SplitLayout renderer stacks all non-image elements in one column, so
  // nonImages.length > 1 is handled correctly — no BSP/grid needed.
  const isPureText = (t: string) => t === 'paragraph' || t === 'list' || t === 'progress';
  if (hasTitle && images.length === 1 && nonImages.length >= 1 && nonImages.every((e) => isPureText(e.type))) {
    return 'split';
  }

  // ── BSP auto-tiling ───────────────────────────────────────────────────────
  // Trigger for 2–3 elements where the mix is visually diverse enough
  // to benefit from side-by-side rendering. Skip if everything is plain
  // paragraph/list (stacked looks better for all-text slides).

  const allPureText = bodyElements.every((e) => e.type === 'paragraph' || e.type === 'list');
  // Tables need a full-width area; bsp panes are too narrow for them.
  const hasTable = bodyElements.some((e) => e.type === 'table');

  const logicalCount = logicalElementCount(bodyElements);

  if (!allPureText && !hasTable && (logicalCount === 2 || logicalCount === 3)) return 'bsp';

  // ── Grid: 4+ distinct content elements ───────────────────────────────────

  if (logicalCount >= 4) return 'grid';

  // ── Overflow guard ────────────────────────────────────────────────────────
  // When pure-text content is dense enough to overflow the slide, split into
  // two columns. The renderer auto-splits at the list/element midpoint.

  if (allPureText && estimateLines(bodyElements) > OVERFLOW_LINE_THRESHOLD) {
    return 'two-column';
  }

  // ── Default ───────────────────────────────────────────────────────────────

  return 'title-content';
}
