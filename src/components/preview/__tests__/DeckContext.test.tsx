// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DEFAULT_THEME, BUILT_IN_THEMES } from '../../../engine/theme';
import { DEFAULT_DECK, DeckProvider, useDeck, useDeckContextValue, type DeckContextValue } from '../DeckContext';

describe('DeckContext', () => {
  it('falls back to the default theme, 16:9 and empty meta without a provider', () => {
    const { result } = renderHook(() => useDeck());
    expect(result.current).toBe(DEFAULT_DECK);
    expect(result.current.theme).toBe(DEFAULT_THEME);
    expect(result.current.aspectRatio).toEqual({ w: 16, h: 9 });
    expect(result.current.docTitle).toBe('');
  });

  it('hands the provided value to consumers', () => {
    const value: DeckContextValue = {
      theme: BUILT_IN_THEMES[1], docTitle: 'Deck', docAuthor: 'Ada', docDate: '2026-01-02', aspectRatio: { w: 4, h: 3 },
    };
    const wrapper = ({ children }: { children: ReactNode }) => <DeckProvider value={value}>{children}</DeckProvider>;
    const { result } = renderHook(() => useDeck(), { wrapper });
    expect(result.current).toBe(value);
  });

  it('useDeckContextValue keeps its identity until a field changes', () => {
    const ar = { w: 16, h: 9 };
    const { result, rerender } = renderHook(
      ({ title }) => useDeckContextValue(DEFAULT_THEME, title, 'Ada', 'today', ar),
      { initialProps: { title: 'A' } },
    );
    const first = result.current;
    rerender({ title: 'A' });
    expect(result.current).toBe(first);
    rerender({ title: 'B' });
    expect(result.current).not.toBe(first);
    expect(result.current.docTitle).toBe('B');
  });

  it('re-renders consumers when the provided value changes', () => {
    const seen: string[] = [];
    function Probe() { seen.push(useDeck().docTitle); return null; }
    const make = (docTitle: string): DeckContextValue => ({ ...DEFAULT_DECK, docTitle });
    const { rerender } = render(<DeckProvider value={make('one')}><Probe /></DeckProvider>);
    rerender(<DeckProvider value={make('two')}><Probe /></DeckProvider>);
    expect(seen).toEqual(['one', 'two']);
  });
});
