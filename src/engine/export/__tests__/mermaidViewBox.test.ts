// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fitMermaidViewBox } from '../mermaidViewBox';

const SVGNS = 'http://www.w3.org/2000/svg';

function makeSvg(inner: string): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg xmlns="${SVGNS}" viewBox="0 0 960 388">${inner}</svg>`;
  return wrap.querySelector('svg') as SVGSVGElement;
}

describe('fitMermaidViewBox', () => {
  it('rewrites the viewBox to the padded content bounding box', () => {
    const svg = makeSvg('<rect />');
    svg.getBBox = vi.fn(() => ({ x: 10, y: 20, width: 100, height: 50 })) as never;

    fitMermaidViewBox(svg, 8);

    expect(svg.getAttribute('viewBox')).toBe('2 12 116 66');
  });

  // Issue #195: a Gantt "today" marker is drawn at the real current date, so a
  // chart whose tasks are all in the past parks it far off-canvas. Fitting the
  // viewBox to it shrinks the diagram to an unreadable sliver.
  it('hides the Gantt today marker while measuring, then restores it', () => {
    const svg = makeSvg('<g class="today"><line class="today" /></g><rect />');
    const marker = svg.querySelector('line.today') as SVGElement;
    const displaysWhileMeasuring: string[] = [];
    svg.getBBox = vi.fn(() => {
      displaysWhileMeasuring.push(marker.style.display);
      return { x: 0, y: 0, width: 900, height: 300 };
    }) as never;

    fitMermaidViewBox(svg);

    expect(displaysWhileMeasuring).toEqual(['none']);
    expect(marker.style.display).toBe('');
  });

  it('restores the today marker even when getBBox throws', () => {
    const svg = makeSvg('<line class="today" />');
    const marker = svg.querySelector('.today') as SVGElement;
    svg.getBBox = vi.fn(() => { throw new Error('not rendered'); }) as never;

    fitMermaidViewBox(svg);

    expect(marker.style.display).toBe('');
    expect(svg.getAttribute('viewBox')).toBe('0 0 960 388');
  });

  it('leaves the viewBox untouched for a zero-area bounding box', () => {
    const svg = makeSvg('<rect />');
    svg.getBBox = vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0 })) as never;

    fitMermaidViewBox(svg);

    expect(svg.getAttribute('viewBox')).toBe('0 0 960 388');
  });

  it('ignores a flowchart node group carrying a user "today" class', () => {
    const svg = makeSvg('<g class="node today"><rect /></g>');
    const node = svg.querySelector('.node') as SVGElement;
    const displaysWhileMeasuring: string[] = [];
    svg.getBBox = vi.fn(() => {
      displaysWhileMeasuring.push(node.style.display);
      return { x: 0, y: 0, width: 400, height: 200 };
    }) as never;

    fitMermaidViewBox(svg);

    // never hidden — the selector is `line.today`, not `.today`
    expect(displaysWhileMeasuring).toEqual(['']);
  });
});
