import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n';
import { DEFAULT_DECK, DeckProvider, type DeckContextValue } from '../components/preview/DeckContext';

export interface RenderWithProvidersOptions extends RenderOptions {
  /** UI locale passed to I18nProvider. Defaults to 'en'. */
  locale?: string;
  /**
   * Deck render inputs for DeckProvider, merged over DEFAULT_DECK. Omit for
   * no provider (renderers then see DEFAULT_DECK anyway).
   */
  deck?: Partial<DeckContextValue>;
}

export type RenderWithProvidersResult = RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
};

/**
 * Renders `ui` inside the app-level providers (I18nProvider, plus
 * DeckProvider when `deck` is given) and
 * returns Testing Library's render result plus a `user` from
 * `userEvent.setup()`. A caller-supplied `wrapper` is nested inside the
 * providers, so it can still read their context.
 */
export function renderWithProviders(
  ui: ReactElement,
  { locale = 'en', deck, wrapper: Inner, ...options }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const deckValue: DeckContextValue | null = deck ? { ...DEFAULT_DECK, ...deck } : null;
  function Providers({ children }: { children: ReactNode }) {
    const inner = Inner ? <Inner>{children}</Inner> : children;
    return (
      <I18nProvider locale={locale}>
        {deckValue ? <DeckProvider value={deckValue}>{inner}</DeckProvider> : inner}
      </I18nProvider>
    );
  }
  const user = userEvent.setup();
  return { ...render(ui, { wrapper: Providers, ...options }), user };
}
