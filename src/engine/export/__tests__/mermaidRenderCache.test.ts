import { describe, it, expect, vi, beforeEach } from 'vitest';

const render = vi.fn();
vi.mock('mermaid', () => ({ default: { render: (...args: unknown[]) => render(...args) } }));
vi.stubGlobal('document', {
  getElementById: () => ({}),
});

const { retargetMermaidSvgIds, cachedMermaidRender, getCachedMermaidSvg } = await import('../mermaidRenderQueue');

const svgFor = (id: string) =>
  `<svg id="${id}" width="10"><style>#${id} .node{fill:red}</style><marker id="${id}_arrow"/><path marker-end="url(#${id}_arrow)"/></svg>`;

describe('retargetMermaidSvgIds', () => {
  it('re-scopes the root id, style selectors and marker references', () => {
    expect(retargetMermaidSvgIds(svgFor('mermaid-r1-1'), 'mermaid-r2-5')).toBe(svgFor('mermaid-r2-5'));
  });

  it('does not touch a longer id that merely starts with the old one', () => {
    const svg = '<svg id="mermaid-r1-1"><g id="mermaid-r1-10"/></svg>';
    expect(retargetMermaidSvgIds(svg, 'x')).toBe('<svg id="x"><g id="mermaid-r1-10"/></svg>');
  });

  it('returns the input unchanged when there is no root id', () => {
    expect(retargetMermaidSvgIds('<svg width="1"/>', 'x')).toBe('<svg width="1"/>');
  });
});

describe('cachedMermaidRender', () => {
  beforeEach(() => render.mockReset());

  it('shares one render between concurrent callers and serves later ones from cache', async () => {
    render.mockImplementation(async (id: string) => ({ svg: svgFor(id) }));
    const [a, b] = await Promise.all([
      cachedMermaidRender('mermaid-a-1', 'graph TD; A-->B'),
      cachedMermaidRender('mermaid-b-1', 'graph TD; A-->B'),
    ]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(a).toBe(svgFor('mermaid-a-1'));
    expect(b).toBe(svgFor('mermaid-b-1'));
    expect(getCachedMermaidSvg('graph TD; A-->B', 'mermaid-c-1')).toBe(svgFor('mermaid-c-1'));
    await cachedMermaidRender('mermaid-d-1', 'graph TD; A-->B');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed render', async () => {
    render.mockRejectedValueOnce(new Error('Parse error'));
    await expect(cachedMermaidRender('mermaid-e-1', 'bad')).rejects.toThrow('Parse error');
    expect(getCachedMermaidSvg('bad', 'x')).toBeUndefined();
  });
});
