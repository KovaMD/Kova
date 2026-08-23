import type { SlideElement } from '../types';
import { estimateItemLines, estimateTocEntryLines, estimateElementLines } from './autoLayout';

/**
 * Collapses consecutive `progress` elements into sub-arrays so that bsp/grid
 * renderers can place them all in a single pane/cell.
 *
 * Shared by the live preview (SlideRenderer) and the PPTX exporter so both
 * partition a slide's elements identically — see autoSplitElements below for
 * why that matters.
 */
export function groupProgressRuns(elements: SlideElement[]): SlideElement[][] {
  const groups: SlideElement[][] = [];
  for (const el of elements) {
    const last = groups[groups.length - 1];
    if (el.type === 'progress' && last && last[0]?.type === 'progress') {
      last.push(el);
    } else {
      groups.push([el]);
    }
  }
  return groups;
}

/**
 * Finds the index at which `items` should be cut so the cumulative weight
 * on each side is as close to balanced as possible. Falls back to a plain
 * count-based midpoint when weights are empty/equal.
 */
function balancedSplitIndex<T>(items: T[], weightOf: (item: T) => number): number {
  if (items.length <= 1) return items.length;
  const totalWeight = items.reduce((n, it) => n + weightOf(it), 0);
  let cumWeight = 0;
  let mid = Math.ceil(items.length / 2); // fallback for empty/equal items
  for (let i = 0; i < items.length; i++) {
    cumWeight += weightOf(items[i]);
    if (cumWeight >= totalWeight / 2) { mid = i + 1; break; }
  }
  // Guarantee both sides get at least one item — if the single heaviest item
  // is last, the loop above only crosses 50% at the final index, which would
  // otherwise put everything in the left column and leave the right empty.
  return Math.min(mid, items.length - 1);
}

/**
 * Splits a slide's elements into two columns for two-column/bsp layouts.
 *
 * Shared by the live preview (SlideRenderer) and the PPTX exporter. Keeping
 * a single implementation matters here: a slide is edited against the live
 * preview, so if the exporter split elements differently the exported deck
 * would visibly diverge from what the user saw on screen.
 *
 * Balancing is done by estimated wrapped-line count (the same weight
 * autoLayout.ts uses to decide whether to split at all) rather than raw
 * character count — raw length badly misjudges columns once the renderer
 * shrinks the font to fit, since it has no notion of how many characters
 * actually fit per rendered line (see issue #145).
 */
/**
 * Splits a slide's elements into `columns` groups at `column-break` markers.
 *
 * Shared by the live preview and the PPTX exporter for the same reason as
 * `autoSplitElements` above. Breaks beyond `columns - 1` fold into the last
 * group along with any trailing content — this is the mechanism that caps
 * three-column layouts at three columns even if a slide has 3+ `|||`.
 */
export function splitByColumnBreaks(elements: SlideElement[], columns: number): SlideElement[][] {
  const groups: SlideElement[][] = Array.from({ length: columns }, () => []);
  let col = 0;
  for (const el of elements) {
    if (el.type === 'column-break' && col < columns - 1) { col++; continue; }
    groups[col].push(el);
  }
  return groups;
}

/**
 * Explodes each list element into one single-item list per cell so grid
 * layout gives every bullet its own cell without requiring explicit `|||`
 * breaks — unlike column/bsp layouts, grid auto-infers cells from list
 * items (see #229). Non-list elements pass through unchanged.
 *
 * Shared by the live preview and the PPTX exporter for the same reason as
 * autoSplitElements/splitByColumnBreaks above: a grid slide must partition
 * identically in both so the export matches what was edited on screen.
 */
export function explodeListItems(elements: SlideElement[]): SlideElement[] {
  return elements.flatMap((el) => {
    if (el.type !== 'list' || el.items.length <= 1) return [el];
    return el.items.map((item) => ({ ...el, items: [item] }));
  });
}

export function autoSplitElements(elements: SlideElement[]): [SlideElement[], SlideElement[]] {
  // Single list: split by cumulative estimated line count for visual balance
  if (elements.length === 1 && elements[0].type === 'list') {
    const list = elements[0];
    const items = list.items;
    const mid = balancedSplitIndex(items, estimateItemLines);
    return [
      [{ ...list, items: items.slice(0, mid) }],
      [{ ...list, items: items.slice(mid) }],
    ];
  }
  // Single toc: split entries by cumulative estimated line count for visual balance
  if (elements.length === 1 && elements[0].type === 'toc') {
    const toc = elements[0];
    const entries = toc.entries;
    const mid = balancedSplitIndex(entries, (entry) => estimateTocEntryLines(entry.title));
    return [
      [{ ...toc, entries: entries.slice(0, mid) }],
      [{ ...toc, entries: entries.slice(mid), numberStart: mid }],
    ];
  }
  // Multiple elements: split by cumulative estimated line count for visual balance
  const mid = balancedSplitIndex(elements, estimateElementLines);
  return [elements.slice(0, mid), elements.slice(mid)];
}
