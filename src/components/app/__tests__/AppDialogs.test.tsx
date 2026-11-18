// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { AppDialogs, type AppDialogsProps } from '../AppDialogs';
import { APP_VERSION } from '../../../version';

function baseProps(): AppDialogsProps {
  return {
    marpPromptOpen: false,
    onMarpConvert: vi.fn(),
    onMarpDismiss: vi.fn(),
    marpLoss: null,
    onMarpLossDismiss: vi.fn(),
    missingThemeId: null,
    onMissingThemeInstalled: vi.fn(),
    onMissingThemeDismiss: vi.fn(),
    showWhatsNew: false,
    onWhatsNewOpen: vi.fn(),
    onWhatsNewDismiss: vi.fn(),
    warnMessage: null,
    externalChangeOpen: false,
    onExternalChangeClose: vi.fn(),
    onExternalChangeReload: vi.fn(),
    onExternalChangeSaveAs: vi.fn(),
    externalReloadBannerOpen: false,
    onExternalReloadBannerDismiss: vi.fn(),
    pdfOptionsOpen: false,
    pdfPerPage: 1,
    pdfNotesOn: false,
    pdfHasNotes: false,
    onPdfPerPageChange: vi.fn(),
    onPdfNotesChange: vi.fn(),
    onPdfOptionsClose: vi.fn(),
    onPdfExport: vi.fn(),
    confirmCloseOpen: false,
    onConfirmCloseCancel: vi.fn(),
    onConfirmCloseDiscard: vi.fn(),
    onConfirmCloseSave: vi.fn(),
    dropConfirmPath: null,
    onDropConfirmCancel: vi.fn(),
    onDropConfirmOpen: vi.fn(),
  };
}

function renderDialogs(overrides: Partial<AppDialogsProps> = {}) {
  const props = { ...baseProps(), ...overrides };
  return { ...renderWithProviders(<AppDialogs {...props} />), props };
}

describe('AppDialogs', () => {
  // MissingThemeBanner fetches the theme registry on mount.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when every dialog and banner is closed', () => {
    const { container } = renderDialogs();
    expect(container.innerHTML).toBe('');
  });

  it('Marp prompt banner converts and dismisses', async () => {
    const { user, props } = renderDialogs({ marpPromptOpen: true });
    expect(screen.getByText('This looks like a Marp deck.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Convert to Kova' }));
    expect(props.onMarpConvert).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTitle('Dismiss'));
    expect(props.onMarpDismiss).toHaveBeenCalledTimes(1);
  });

  it('Marp loss banner shows the count and only appears when above zero', async () => {
    const { user, props, rerender } = renderDialogs({ marpLoss: 2 });
    expect(screen.getByText('Imported. 2 Marp features simplified.')).toBeTruthy();
    await user.click(screen.getByTitle('Dismiss'));
    expect(props.onMarpLossDismiss).toHaveBeenCalledTimes(1);
    rerender(<AppDialogs {...props} marpLoss={0} />);
    expect(screen.queryByText(/Marp feature/)).toBeNull();
  });

  it('missing theme banner names the theme', () => {
    renderDialogs({ missingThemeId: 'ocean-depths' });
    expect(screen.getByText(/ocean-depths/)).toBeTruthy();
  });

  it("what's new banner opens release notes and dismisses", async () => {
    const { user, props } = renderDialogs({ showWhatsNew: true });
    expect(screen.getByText(`Kova updated to v${APP_VERSION} — here's what's new.`)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'View release notes' }));
    expect(props.onWhatsNewOpen).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTitle('Dismiss'));
    expect(props.onWhatsNewDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the warning toast', () => {
    renderDialogs({ warnMessage: 'Something odd happened' });
    expect(screen.getByText('Something odd happened')).toBeTruthy();
  });

  it('external-change dialog reloads or saves as, and ignores Escape', async () => {
    const { user, props } = renderDialogs({ externalChangeOpen: true });
    const dialog = screen.getByRole('dialog', { name: 'File changed externally' });
    await user.keyboard('{Escape}');
    expect(props.onExternalChangeClose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Reload' }));
    expect(props.onExternalChangeReload).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Save As…' }));
    expect(props.onExternalChangeSaveAs).toHaveBeenCalledTimes(1);
  });

  it('external reload banner dismisses', async () => {
    const { user, props } = renderDialogs({ externalReloadBannerOpen: true });
    expect(screen.getByText('Another application modified this file. The latest version has been loaded.')).toBeTruthy();
    await user.click(screen.getByTitle('Dismiss'));
    expect(props.onExternalReloadBannerDismiss).toHaveBeenCalledTimes(1);
  });

  it('PDF options dialog picks per-page count, toggles notes, cancels and exports', async () => {
    const { user, props } = renderDialogs({ pdfOptionsOpen: true, pdfHasNotes: true });
    const dialog = screen.getByRole('dialog', { name: 'Export PDF' });
    await user.click(within(dialog).getByRole('button', { name: '4' }));
    expect(props.onPdfPerPageChange).toHaveBeenCalledWith(4);
    const notes = within(dialog).getByRole('checkbox', { name: 'Include speaker notes (handout)' });
    expect((notes as HTMLInputElement).disabled).toBe(false);
    await user.click(notes);
    expect(props.onPdfNotesChange).toHaveBeenCalledWith(true);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onPdfOptionsClose).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(props.onPdfExport).toHaveBeenCalledTimes(1);
  });

  it('PDF options dialog disables notes when the deck has none', () => {
    renderDialogs({ pdfOptionsOpen: true, pdfHasNotes: false });
    const notes = screen.getByRole('checkbox', { name: 'Include speaker notes (handout) — none in this deck' });
    expect((notes as HTMLInputElement).disabled).toBe(true);
  });

  it('confirm-close dialog cancels, discards or saves', async () => {
    const { user, props } = renderDialogs({ confirmCloseOpen: true });
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onConfirmCloseCancel).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(props.onConfirmCloseDiscard).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(props.onConfirmCloseSave).toHaveBeenCalledTimes(1);
  });

  it('drop-confirm dialog names the file, cancels or opens', async () => {
    const { user, props } = renderDialogs({ dropConfirmPath: '/tmp/decks/talk.md' });
    const dialog = screen.getByRole('dialog', { name: 'Open file' });
    expect(within(dialog).getByText('talk.md')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onDropConfirmCancel).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Open' }));
    expect(props.onDropConfirmOpen).toHaveBeenCalledTimes(1);
  });
});
