// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import mermaid from 'mermaid';
import { queuedMermaidRender } from '../mermaidRenderQueue';

vi.mock('mermaid', () => ({
  default: { render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }) },
}));

// Regression tests for issue #195: Mermaid's Gantt renderer measures its host
// element's offsetWidth at render time to pick its internal scale. Without an
// explicit container, mermaid.render() falls through to document.body, so
// that measurement (and therefore the diagram's scale) depended on whichever
// window happened to be rendering it and how it was sized at that instant —
// these tests pin down the fixed-size container that replaces that reliance.
describe('queuedMermaidRender render host', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.width = '';
    vi.mocked(mermaid.render).mockClear();
  });

  it('passes a fixed-size, off-screen container as the 3rd argument instead of leaving it undefined', async () => {
    await queuedMermaidRender('test-id', 'graph TD\nA-->B');

    expect(mermaid.render).toHaveBeenCalledTimes(1);
    const container = vi.mocked(mermaid.render).mock.calls[0][2] as HTMLElement;
    expect(container).toBeInstanceOf(HTMLElement);
    expect(container.style.width).toBe('960px');
    expect(container.style.height).toBe('540px');
    // Off-screen and out of normal flow, so it never affects real layout.
    expect(container.style.position).toBe('fixed');
    expect(container.style.left).toBe('-99999px');
    expect(document.body.contains(container)).toBe(true);
  });

  it('reuses the same host element across renders instead of creating one per call', async () => {
    await queuedMermaidRender('id-1', 'graph TD\nA-->B');
    await queuedMermaidRender('id-2', 'graph TD\nC-->D');

    const calls = vi.mocked(mermaid.render).mock.calls;
    expect(calls[1][2]).toBe(calls[0][2]);
    expect(document.querySelectorAll('#mermaid-render-host').length).toBe(1);
  });

  it('gives the container the same fixed dimensions no matter how document.body is sized at render time', async () => {
    document.body.style.width = '1400px';
    await queuedMermaidRender('wide', 'graph TD\nA-->B');
    const wideContainer = vi.mocked(mermaid.render).mock.calls[0][2] as HTMLElement;

    document.body.style.width = '80px';
    await queuedMermaidRender('narrow', 'graph TD\nA-->B');
    const narrowContainer = vi.mocked(mermaid.render).mock.calls[1][2] as HTMLElement;

    // Same element, so trivially the same style — the point is that neither
    // render picked up document.body's width (1400px / 80px) at all.
    expect(narrowContainer).toBe(wideContainer);
    expect(narrowContainer.style.width).toBe('960px');
  });
});
