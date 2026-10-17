// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import mermaid from 'mermaid';
import { queuedMermaidRender, cachedMermaidRender } from '../mermaidRenderQueue';
import { getDiagramRenderer, setDiagramRenderer, subscribeDiagramRenderer } from '../diagramRenderer';
import { mermaidSvgCache } from '../mermaidSvgCache';

vi.mock('mermaid', () => ({
  default: { render: vi.fn() },
}));

// No root id, so retargetMermaidSvgIds leaves it unchanged on cache reuse.
const MERMAID_SVG = '<svg><g class="mermaid-output"/></svg>';

describe('diagram renderer routing', () => {
  beforeEach(() => {
    setDiagramRenderer('mermaid');
    vi.mocked(mermaid.render).mockReset();
    vi.mocked(mermaid.render).mockResolvedValue({ svg: MERMAID_SVG } as Awaited<ReturnType<typeof mermaid.render>>);
  });

  it('renders with Pele, not Mermaid, when Pele is selected', async () => {
    setDiagramRenderer('pele');
    const { svg } = await queuedMermaidRender('p1', 'flowchart LR\n  A --> B');
    expect(svg).toContain('class="pele pele-flowchart"');
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("skips Mermaid's queue, so a hung Mermaid render does not hold Pele up", async () => {
    let release!: () => void;
    vi.mocked(mermaid.render).mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ svg: MERMAID_SVG } as Awaited<ReturnType<typeof mermaid.render>>);
    }));
    const stuck = queuedMermaidRender('stuck', 'flowchart LR\n  A --> B');
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalled());

    setDiagramRenderer('pele');
    const { svg } = await queuedMermaidRender('p2', 'flowchart LR\n  A --> B');
    expect(svg).toContain('pele-flowchart');

    // Free the shared queue so later tests aren't stuck behind it.
    release();
    await stuck;
  });

  it('falls back to Mermaid for a diagram type Pele does not know', async () => {
    setDiagramRenderer('pele');
    const { svg } = await queuedMermaidRender('p3', 'notADiagram\n  x');
    expect(svg).toBe(MERMAID_SVG);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it('reports a Pele syntax error rather than retrying with Mermaid', async () => {
    setDiagramRenderer('pele');
    await expect(queuedMermaidRender('p4', 'flowchart LR\n  A -->')).rejects.toThrow(/parse error/i);
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('keys the render cache by engine, so switching is a miss and switching back is a hit', async () => {
    const src = 'flowchart LR\n  Cache --> Key';
    expect(await cachedMermaidRender('c1', src)).toBe(MERMAID_SVG);

    setDiagramRenderer('pele');
    expect(await cachedMermaidRender('c2', src)).toContain('pele-flowchart');

    setDiagramRenderer('mermaid');
    expect(await cachedMermaidRender('c3', src)).toBe(MERMAID_SVG);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });
});

describe('setDiagramRenderer', () => {
  beforeEach(() => setDiagramRenderer('mermaid'));

  it('notifies subscribers and drops export SVGs from the other engine', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagramRenderer(listener);
    mermaidSvgCache.set('flowchart LR\n  A --> B', MERMAID_SVG);

    setDiagramRenderer('pele');

    expect(getDiagramRenderer()).toBe('pele');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mermaidSvgCache.get('flowchart LR\n  A --> B')).toBeUndefined();
    unsubscribe();
  });

  it('does nothing when the engine is unchanged', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagramRenderer(listener);
    mermaidSvgCache.set('kept', MERMAID_SVG);

    setDiagramRenderer('mermaid');

    expect(listener).not.toHaveBeenCalled();
    expect(mermaidSvgCache.get('kept')).toBe(MERMAID_SVG);
    unsubscribe();
  });

  it("follows a change saved from another window's settings", () => {
    localStorage.setItem('kova:settings', JSON.stringify({ diagramRenderer: 'pele' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'kova:settings' }));
    expect(getDiagramRenderer()).toBe('pele');
    localStorage.removeItem('kova:settings');
  });
});
