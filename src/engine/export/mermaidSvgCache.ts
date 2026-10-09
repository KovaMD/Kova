/**
 * Module-level cache of raw Mermaid SVG strings keyed by diagram source.
 * Populated by MermaidDiagram in the live preview; consumed by the PPTX
 * exporter so it can skip a second mermaid.render() call (which hangs when
 * a rendered diagram is already present in the live-preview DOM).
 *
 * Capped LRU: keyed by full diagram source text, so every edit to a Mermaid
 * block adds a new entry. Without a cap this grows unboundedly over a long
 * editing session on a diagram-heavy deck.
 */
const MAX_ENTRIES = 50;

class MermaidSvgLruCache {
  private map = new Map<string, string>();

  constructor(private maxEntries = MAX_ENTRIES) {}

  get(key: string): string | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency: re-insert so it's last in iteration order.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: string): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

export const mermaidSvgCache = new MermaidSvgLruCache();

/**
 * Display-side cache keyed by the *full* render source (diagram text plus the
 * theme init prepended by buildMermaidRenderSource), so a theme change is a
 * cache miss rather than a stale hit. Lets the thumbnail, the main preview
 * and the presenter views share one mermaid.render() per diagram instead of
 * each paying for their own. Larger cap than mermaidSvgCache because a single
 * diagram-heavy deck can hold more than 50 distinct diagrams on its own.
 */
export const mermaidRenderedSvgCache = new MermaidSvgLruCache(150);
