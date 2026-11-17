// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { BUILT_IN_THEMES } from '../../engine/theme';
import { loadSettings } from '../../store/settings';
import { fetchUpdate } from '../../engine/updater';
import { SettingsModal } from '../SettingsModal';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
// The updater wraps Tauri's updater plugin; stub it so no IPC is attempted.
vi.mock('../../engine/updater', () => ({
  fetchUpdate: vi.fn(() => Promise.resolve(null)),
  canSelfUpdate: vi.fn(() => Promise.resolve(true)),
  restartApp: vi.fn(),
}));

// Font probing needs a real canvas, which jsdom lacks.
vi.mock('../../engine/fontDetect', () => ({ isFontAvailable: () => true }));

type Props = ComponentProps<typeof SettingsModal>;

function renderSettings(overrides: Partial<Props> = {}) {
  const props: Props = {
    settings: { ...loadSettings(), uiTheme: 'auto', editorFont: 'ibm-plex-mono' },
    availableUpdate: null,
    allThemes: BUILT_IN_THEMES,
    isDirty: false,
    onChange: vi.fn(),
    onUpdateChecked: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<SettingsModal {...props} />) };
}

describe('SettingsModal smoke test', () => {
  it('opens on the Appearance category', () => {
    renderSettings();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('App theme')).toBeTruthy();
    expect(screen.getByText('Interface scale')).toBeTruthy();
  });

  it('switches the app theme to Dark', async () => {
    const { props, user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ uiTheme: 'dark' }));
  });

  it('filters settings across categories by search text', async () => {
    const { user } = renderSettings();
    await user.type(screen.getByPlaceholderText('Search settings…'), 'updates on launch');
    expect(screen.getByText('Check for updates on launch')).toBeTruthy();
    expect(screen.queryByText('App theme')).toBeNull();
  });

  it('runs an update check from the Updates category and reports the result', async () => {
    const { props, user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Updates' }));
    await user.click(screen.getByText('Check now'));
    expect(fetchUpdate).toHaveBeenCalled();
    expect(await screen.findByText(/^Up to date/)).toBeTruthy();
    expect(props.onUpdateChecked).toHaveBeenCalledWith(null);
  });

  it('closes on Escape', () => {
    const { props } = renderSettings();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
