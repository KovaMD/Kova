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

  it('returns search results from several categories at once', async () => {
    const { user } = renderSettings();
    await user.type(screen.getByPlaceholderText('Search settings…'), 'show');
    expect(screen.getByText('Show frontmatter YAML in editor')).toBeTruthy();
    expect(screen.getByText('Show progress bar')).toBeTruthy();
    expect(screen.getByText("Show what's new after updates")).toBeTruthy();
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

  it('toggles spell checking from the Language & Spelling category', async () => {
    const { props, user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Language & Spelling' }));
    expect(screen.getByText('Dictionary language')).toBeTruthy();
    await user.click(screen.getAllByRole('switch')[0]);
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ spellCheckEnabled: false }));
  });

  it('sets the PDF page size from the Workspace category', async () => {
    const { props, user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Workspace' }));
    expect(screen.getByText('Autosave')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Letter' }));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ pdfPageSize: 'letter' }));
  });

  it('sets the display mode from the Presentation category', async () => {
    const { props, user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Presentation' }));
    await user.click(screen.getByRole('button', { name: 'Mirror' }));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ presentationMode: 'mirror' }));
  });

  it('opens the licences list from the About category and returns', async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'About' }));
    expect(screen.getByText('GitHub')).toBeTruthy();
    await user.click(screen.getByText('Licenses'));
    expect(screen.getByText('CodeMirror')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByText('CodeMirror')).toBeNull();
    expect(screen.getByText('GitHub')).toBeTruthy();
  });

  it('resets the About view to its main list when switching categories', async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'About' }));
    await user.click(screen.getByText('Licenses'));
    await user.click(screen.getByRole('button', { name: 'Updates' }));
    await user.click(screen.getByRole('button', { name: 'About' }));
    expect(screen.queryByText('CodeMirror')).toBeNull();
  });

  it('keeps the update check result when switching categories', async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Updates' }));
    await user.click(screen.getByText('Check now'));
    expect(await screen.findByText(/^Up to date/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Updates' }));
    expect(screen.getByText(/^Up to date/)).toBeTruthy();
  });

  it('closes on Escape', () => {
    const { props } = renderSettings();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
