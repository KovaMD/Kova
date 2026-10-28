import type { Slide, TocEntry } from './types';

/**
 * Entries for the `!toc` on slide `tocIndex`: every heading of every visible
 * slide (the title plus any later headings on the same slide, issue #278),
 * each with a depth for nesting (issue #277).
 *
 * Depth follows Typora: one step per heading level, so `##` then `####` nests
 * two steps. Unlike Typora it counts from the shallowest level present rather
 * than from h1, since Kova decks rarely use `#` past the cover.
 *
 * The first non-hidden H1 slide is the cover and is left out entirely;
 * subsequent H1 hero slides are included. The TOC slide itself is also left
 * out, and depths are measured after that exclusion so an `## Agenda` heading
 * on the TOC slide can't push every `###` entry down a level.
 */
export function buildTocEntries(slides: Slide[], tocIndex: number): TocEntry[] {
  const coverIndex = slides.find((s) => !s.hidden && s.titleLevel === 1)?.index ?? -1;
  const headings: Array<{ title: string; index: number; level: number }> = [];
  for (const s of slides) {
    if (s.hidden || !s.title || s.index === coverIndex || s.index === tocIndex) continue;
    headings.push({ title: s.title, index: s.index, level: s.titleLevel });
    for (const h of s.subheadings ?? []) {
      if (h.title) headings.push({ title: h.title, index: s.index, level: h.level });
    }
  }
  const minLevel = Math.min(...headings.map((h) => h.level));
  return headings.map(({ title, index, level }) => ({ title, index, depth: level - minLevel }));
}
