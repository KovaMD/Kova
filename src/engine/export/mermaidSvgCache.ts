/**
 * Module-level cache of raw Mermaid SVG strings keyed by diagram source.
 * Populated by MermaidDiagram in the live preview; consumed by the PPTX
 * exporter so it can skip a second mermaid.render() call (which hangs when
 * a rendered diagram is already present in the live-preview DOM).
 */
export const mermaidSvgCache = new Map<string, string>();
