// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { BUILT_IN_THEMES, DEFAULT_THEME } from '../../../engine/theme';
import { InspectorPanel } from '../InspectorPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

type Props = ComponentProps<typeof InspectorPanel>;

function renderInspector(overrides: Partial<Props> = {}) {
  const props: Props = {
    filePath: '/home/user/talks/deck.md',
    slideCount: 7,
    frontmatter: { title: 'Launch plan' },
    theme: DEFAULT_THEME,
    baseTheme: DEFAULT_THEME,
    themeOverrides: {},
    allThemes: BUILT_IN_THEMES,
    onThemeSelect: vi.fn(),
    onThemeChange: vi.fn(),
    onMetaChange: vi.fn(),
    onFormat: vi.fn(),
    onOpenLibrary: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<InspectorPanel {...props} />) };
}

describe('InspectorPanel smoke test', () => {
  it('shows the document info and the open Format section', () => {
    renderInspector();
    expect(screen.getByText('…/talks/deck.md')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByDisplayValue('Launch plan')).toBeTruthy();
    expect(screen.getByTitle('Bold (Ctrl+B)')).toBeTruthy();
  });

  it('sends a format command when a format button is clicked', async () => {
    const { props, user } = renderInspector();
    await user.click(screen.getByTitle('Bold (Ctrl+B)'));
    expect(props.onFormat).toHaveBeenCalledWith({ type: 'bold' });
  });

  it('commits an edited author when the field is confirmed with Enter', async () => {
    const { props, user } = renderInspector();
    await user.type(screen.getByPlaceholderText('Author'), 'Ada{Enter}');
    expect(props.onMetaChange).toHaveBeenCalledWith('author', 'Ada');
  });

  it('collapses the Format section when its header is clicked', async () => {
    const { user } = renderInspector();
    await user.click(screen.getByRole('button', { name: /Format/ }));
    expect(screen.queryByTitle('Bold (Ctrl+B)')).toBeNull();
  });
});
