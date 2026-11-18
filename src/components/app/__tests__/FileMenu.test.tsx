// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { FileMenu, type FileMenuProps } from '../FileMenu';
import type { MenuActions } from '../../../macMenu';

function makeActions(): MenuActions {
  return {
    newFile: vi.fn(), openFile: vi.fn(), openRecent: vi.fn(), clearRecent: vi.fn(),
    save: vi.fn(), saveAs: vi.fn(), copyWithAssets: vi.fn(),
    import: vi.fn(), importUrl: vi.fn(), importMarp: vi.fn(),
    export: vi.fn(), exportPdf: vi.fn(), exportHtml: vi.fn(), print: vi.fn(), exit: vi.fn(),
    present: vi.fn(), toggleInspector: vi.fn(), openSettings: vi.fn(), installCli: vi.fn(),
  };
}

function renderMenu(overrides: Partial<FileMenuProps> = {}) {
  const actions = makeActions();
  const props: FileMenuProps = {
    actions,
    recents: [],
    filePath: '/docs/talk.md',
    isDirty: true,
    hasContent: true,
    canExport: true,
    pdfExporting: false,
    printing: false,
    combos: {},
    ...overrides,
  };
  const result = renderWithProviders(<FileMenu {...props} />);
  return { ...result, actions };
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name });

describe('FileMenu', () => {
  it('runs the shared menu action for each item and closes', async () => {
    const { user, actions } = renderMenu({ recents: ['/docs/a.md'] });
    const cases: [RegExp | string, keyof MenuActions, string?][] = [
      [/^New/, 'newFile'],
      [/^Open Ctrl/, 'openFile'],
      [/^Save Ctrl/, 'save'],
      [/^Save As/, 'saveAs'],
      ['Copy with Assets…', 'copyWithAssets'],
      ['Print…', 'print'],
      ['Exit', 'exit'],
      ['From PowerPoint…', 'import', 'Import'],
      ['From URL…', 'importUrl', 'Import'],
      ['From Marp…', 'importMarp', 'Import'],
      ['PowerPoint (.pptx)', 'export', 'Export'],
      ['PDF (.pdf)', 'exportPdf', 'Export'],
      ['HTML (.html)', 'exportHtml', 'Export'],
      ['Clear Menu', 'clearRecent', 'Open Recent'],
    ];
    for (const [name, key, submenu] of cases) {
      await user.click(btn('File'));
      if (submenu) await user.hover(btn(new RegExp(`^${submenu}`)));
      fireEvent.click(btn(name));
      expect(actions[key]).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: /^New/ })).toBeNull();
    }
  });

  it('opens a recent file by path', async () => {
    const { user, actions } = renderMenu({ recents: ['/docs/a.md', '/docs/b.md'] });
    await user.click(btn('File'));
    await user.hover(btn(/^Open Recent/));
    fireEvent.click(screen.getByTitle('/docs/b.md'));
    expect(actions.openRecent).toHaveBeenCalledWith('/docs/b.md');
  });

  it('disables every export item and Print when canExport is false', async () => {
    const { user } = renderMenu({ canExport: false });
    await user.click(btn('File'));
    expect(btn(/^Export/)).toHaveProperty('disabled', true);
    expect(btn('Print…')).toHaveProperty('disabled', true);
    expect(btn(/^Save As/)).toHaveProperty('disabled', false);
  });

  it('shows progress labels while a PDF export or print is running', async () => {
    const { user } = renderMenu({ canExport: false, pdfExporting: true, printing: true });
    await user.click(btn('File'));
    expect(btn('Preparing Print…')).toHaveProperty('disabled', true);
    // The Export trigger is disabled, so open its submenu by hovering the wrapper.
    fireEvent.mouseEnter(btn(/^Export/).parentElement!);
    expect(btn('Exporting PDF…')).toHaveProperty('disabled', true);
    expect(btn('Exporting…')).toHaveProperty('disabled', true);
    expect(btn('PowerPoint (.pptx)')).toHaveProperty('disabled', true);
  });

  it('disables Print alone while printing', async () => {
    const { user } = renderMenu({ printing: true });
    await user.click(btn('File'));
    expect(btn(/^Export/)).toHaveProperty('disabled', false);
    expect(btn('Preparing Print…')).toHaveProperty('disabled', true);
  });

  it('enables Save only for a dirty document with a path', async () => {
    const { user, unmount } = renderMenu({ isDirty: false });
    await user.click(btn('File'));
    expect(btn(/^Save Ctrl/)).toHaveProperty('disabled', true);
    unmount();
    const again = renderMenu({ filePath: null });
    await again.user.click(btn('File'));
    expect(btn(/^Save Ctrl/)).toHaveProperty('disabled', true);
    expect(btn('Copy with Assets…')).toHaveProperty('disabled', true);
  });

  it('shows user-rebound shortcuts', async () => {
    const { user } = renderMenu({ combos: { newFile: 'ctrl+alt+n' } });
    await user.click(btn('File'));
    expect(btn('New Ctrl+Alt+N')).toBeTruthy();
  });
});
