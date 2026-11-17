import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n';

export interface RenderWithProvidersOptions extends RenderOptions {
  /** UI locale passed to I18nProvider. Defaults to 'en'. */
  locale?: string;
}

export type RenderWithProvidersResult = RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
};

/**
 * Renders `ui` inside the app-level providers (currently I18nProvider) and
 * returns Testing Library's render result plus a `user` from
 * `userEvent.setup()`. A caller-supplied `wrapper` is nested inside the
 * providers, so it can still read their context.
 */
export function renderWithProviders(
  ui: ReactElement,
  { locale = 'en', wrapper: Inner, ...options }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <I18nProvider locale={locale}>
        {Inner ? <Inner>{children}</Inner> : children}
      </I18nProvider>
    );
  }
  const user = userEvent.setup();
  return { ...render(ui, { wrapper: Providers, ...options }), user };
}
