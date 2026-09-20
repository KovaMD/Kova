// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar } from '../StatusBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  act(() => {
    root.render(createElement(StatusBar, {
      currentSlide: 3,
      totalSlides: 12,
      wordCount: 400,
      isDirty: false,
      filePath: '/tmp/deck.md',
      externalImageCount: 0,
      aspectRatioLabel: '16:9',
      onAspectRatioCycle: vi.fn(),
      locale: 'en',
      ...props,
    }));
  });
}

describe('StatusBar layout indicator', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('shows the auto-detected layout next to the slide counter', () => {
    render({ layoutName: 'split' });
    expect(container.textContent).toContain('Slide 3 of 12');
    expect(container.textContent).toContain('Layout: split');
    expect(container.textContent).not.toContain('(override)');
  });

  it('marks a layout pinned via <!-- layout: ... --> as an override', () => {
    render({ layoutName: 'code', layoutOverridden: true });
    expect(container.textContent).toContain('Layout: code (override)');
    const cell = Array.from(container.querySelectorAll('div')).find((d) => d.textContent === 'Layout: code (override)');
    expect(cell?.getAttribute('title')).toBe('Set by <!-- layout: code -->');
  });

  it('shows no layout cell when there is no current slide', () => {
    render({ totalSlides: 0, currentSlide: 0 });
    expect(container.textContent).not.toContain('Layout:');
  });
});
