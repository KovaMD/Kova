import type { ListItem, Slide } from '../types';

function collectListItemSteps(items: ListItem[], out: Set<number>): void {
  for (const item of items) {
    if (item.step !== undefined) out.add(item.step);
    if (item.children.length) collectListItemSteps(item.children, out);
  }
}

/**
 * Distinct step values used anywhere on a slide, ascending. Explicit
 * `<!-- step: N -->` grouping can make values sparse or out of document
 * order, so this is the count/sequence of *distinct values* — not a dense
 * 1..N range — meaning a sparse explicit number never forces phantom empty
 * clicks during presentation.
 */
export function getSlideStepValues(slide: Slide): number[] {
  const values = new Set<number>();
  for (const el of slide.elements) {
    if (el.type === 'column-break') continue;
    if (el.step !== undefined) values.add(el.step);
    if (el.type === 'list') collectListItemSteps(el.items, values);
  }
  return [...values].sort((a, b) => a - b);
}

export function getSlideStepCount(slide: Slide): number {
  return getSlideStepValues(slide).length;
}
