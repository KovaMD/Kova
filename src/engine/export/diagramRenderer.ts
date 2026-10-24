import { loadSettings, type DiagramRenderer } from '../../store/settings';
import { mermaidSvgCache } from './mermaidSvgCache';

/**
 * Which engine renders ```mermaid blocks: Pele (the default, a synchronous
 * renderer; see peleRender.ts) or Mermaid itself as a fallback. Held at module level
 * because the render queue and exporters run outside React; MermaidDiagram
 * subscribes so open diagrams re-render when it changes.
 */
let current: DiagramRenderer = loadSettings().diagramRenderer;
const listeners = new Set<() => void>();

export function getDiagramRenderer(): DiagramRenderer {
  return current;
}

export function setDiagramRenderer(next: DiagramRenderer): void {
  if (next === current) return;
  current = next;
  // The export cache is keyed by raw diagram source only, so drop SVGs from
  // the other engine rather than let an export pick one up.
  mermaidSvgCache.clear();
  listeners.forEach((l) => l());
}

export function subscribeDiagramRenderer(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Presenter and audience windows are separate webviews sharing localStorage;
// follow a change saved from the main window's settings.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'kova:settings') setDiagramRenderer(loadSettings().diagramRenderer);
  });
}
