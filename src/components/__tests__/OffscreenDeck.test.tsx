// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { BUILT_IN_THEMES } from '../../engine/theme';
import type { Slide } from '../../engine/types';
import { OffscreenDeck } from '../OffscreenDeck';

// SlideRenderer pulls in Mermaid; stub it to record its props and signal ready.
vi.mock('../preview/SlideRenderer', () => ({
  SlideRenderer: (p: {
    slideNumber: number; totalSlides: number; docTitle: string;
    hideOverflowBadge?: boolean; onAllDiagramsReady?: () => void;
  }) => {
    p.onAllDiagramsReady?.();
    return (
      <span
        data-n={p.slideNumber}
        data-total={p.totalSlides}
        data-title={p.docTitle}
        data-hide={String(Boolean(p.hideOverflowBadge))}
      />
    );
  },
}));

afterEach(cleanup);

type Props = ComponentProps<typeof OffscreenDeck>;

function renderDeck(overrides: Partial<Props> = {}) {
  const props: Props = {
    slides: [{}, {}, {}] as unknown as Slide[],
    theme: BUILT_IN_THEMES[0],
    aspectRatio: { w: 4, h: 3 },
    docTitle: 'Deck',
    docAuthor: 'Me',
    docDate: 'Today',
    setSlideRef: vi.fn(),
    onSlideReady: vi.fn(),
    ...overrides,
  };
  return { ...render(<OffscreenDeck {...props} />), props };
}

describe('OffscreenDeck', () => {
  it('renders one fixed-size wrapper per slide, off-screen and hidden', () => {
    const { container } = renderDeck();
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.style.position).toBe('fixed');
    expect(root.style.top).toBe('-99999px');
    expect(root.style.width).toBe('960px');
    const wrappers = Array.from(root.children) as HTMLElement[];
    expect(wrappers.length).toBe(3);
    for (const w of wrappers) {
      expect(w.style.width).toBe('960px');
      expect(w.style.height).toBe('720px');
      expect(w.style.overflow).toBe('hidden');
    }
  });

  it('rounds the slide height from the aspect ratio', () => {
    const { container } = renderDeck({ aspectRatio: { w: 16, h: 9 } });
    const w = container.firstElementChild!.firstElementChild as HTMLElement;
    expect(w.style.height).toBe('540px');
  });

  it('registers each wrapper by index and passes slide numbering', () => {
    const { container, props } = renderDeck();
    const wrappers = Array.from(container.firstElementChild!.children);
    wrappers.forEach((w, i) => {
      expect(props.setSlideRef).toHaveBeenCalledWith(i, w);
      const inner = w.firstElementChild as HTMLElement;
      expect(inner.dataset.n).toBe(String(i + 1));
      expect(inner.dataset.total).toBe('3');
      expect(inner.dataset.title).toBe('Deck');
      expect(inner.dataset.hide).toBe('true');
    });
  });

  it('forwards each slide ready signal', () => {
    const { props } = renderDeck();
    expect(props.onSlideReady).toHaveBeenCalledTimes(3);
  });

  it('unregisters wrappers on unmount', () => {
    const { unmount, props } = renderDeck();
    unmount();
    expect(props.setSlideRef).toHaveBeenCalledWith(0, null);
    expect(props.setSlideRef).toHaveBeenCalledWith(2, null);
  });
});
