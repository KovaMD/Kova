// @vitest-environment jsdom
// Characterisation tests for the App toolbar (File/Edit menus, window
// controls, toolbar buttons). Written against the full App before the menus
// were extracted into src/components/app/, so they pin the behaviour the
// extraction must preserve.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import App from '../App';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false, media,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
  Element.prototype.scrollIntoView = () => {};
  // CodeMirror measures text ranges, which jsdom does not lay out.
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  // The spell checker fetches dictionaries by relative URL, which jsdom
  // cannot resolve; it logs and carries on, so keep the output quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  localStorage.clear();
  mockWindows('main');
  mockIPC((cmd) => { calls.push(cmd); return null; }, { shouldMockEvents: true });
});
afterEach(() => { cleanup(); });

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  const toolbar = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('.app-toolbar');
    if (!el) throw new Error('toolbar not rendered');
    return el;
  });
  return { user, toolbar: within(toolbar) };
}

const fileButton = (tb: ReturnType<typeof within>) => tb.getByRole('button', { name: 'File' });
const editButton = (tb: ReturnType<typeof within>) => tb.getByRole('button', { name: 'Edit' });
const item = (tb: ReturnType<typeof within>, name: string | RegExp) => tb.getByRole('button', { name });

describe('App toolbar: File menu', () => {
  it('toggles open and closed from the File button', async () => {
    const { user, toolbar } = await renderApp();
    expect(toolbar.queryByRole('button', { name: /^New/ })).toBeNull();
    await user.click(fileButton(toolbar));
    expect(item(toolbar, /^New/)).toBeTruthy();
    await user.click(fileButton(toolbar));
    expect(toolbar.queryByRole('button', { name: /^New/ })).toBeNull();
  });

  it('closes when the user clicks outside it', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(fileButton(toolbar));
    expect(item(toolbar, /^New/)).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(toolbar.queryByRole('button', { name: /^New/ })).toBeNull();
  });

  it('shows the keyboard shortcut next to each item', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(fileButton(toolbar));
    expect(item(toolbar, 'New Ctrl+N')).toBeTruthy();
    expect(item(toolbar, 'Open Ctrl+O')).toBeTruthy();
    expect(item(toolbar, 'Save Ctrl+S')).toBeTruthy();
    expect(item(toolbar, 'Save As… Ctrl+Shift+S')).toBeTruthy();
  });

  it('disables save and export items while the document is empty', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(fileButton(toolbar));
    expect(item(toolbar, /^Save Ctrl/)).toHaveProperty('disabled', true);
    expect(item(toolbar, /^Save As/)).toHaveProperty('disabled', true);
    expect(item(toolbar, 'Copy with Assets…')).toHaveProperty('disabled', true);
    expect(item(toolbar, /^Export/)).toHaveProperty('disabled', true);
    expect(item(toolbar, 'Print…')).toHaveProperty('disabled', true);
    expect(item(toolbar, 'Exit')).toHaveProperty('disabled', false);
    expect(toolbar.getByRole('button', { name: '▶ Present' })).toHaveProperty('disabled', true);
  });

  it('enables export once New has created slides; Save stays disabled without a file path', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(fileButton(toolbar));
    await user.click(item(toolbar, /^New/));
    expect(toolbar.queryByRole('button', { name: /^New/ })).toBeNull();
    await waitFor(() => expect(toolbar.getByRole('button', { name: '▶ Present' })).toHaveProperty('disabled', false));

    await user.click(fileButton(toolbar));
    expect(item(toolbar, /^Save Ctrl/)).toHaveProperty('disabled', true);
    expect(item(toolbar, /^Save As/)).toHaveProperty('disabled', false);
    expect(item(toolbar, 'Copy with Assets…')).toHaveProperty('disabled', true);
    expect(item(toolbar, 'Print…')).toHaveProperty('disabled', false);
    const exportBtn = item(toolbar, /^Export/);
    expect(exportBtn).toHaveProperty('disabled', false);
    expect(exportBtn.getAttribute('aria-expanded')).toBe('false');

    // Submenus open on hover (a click then toggles them shut again).
    await user.hover(exportBtn);
    expect(exportBtn.getAttribute('aria-expanded')).toBe('true');
    expect(item(toolbar, 'PowerPoint (.pptx)')).toHaveProperty('disabled', false);
    expect(item(toolbar, 'PDF (.pdf)')).toHaveProperty('disabled', false);
    expect(item(toolbar, 'HTML (.html)')).toHaveProperty('disabled', false);
  });

  it('opens the PDF options dialog from Export > PDF and closes the menu', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(fileButton(toolbar));
    await user.click(item(toolbar, /^New/));
    await waitFor(() => expect(toolbar.getByRole('button', { name: '▶ Present' })).toHaveProperty('disabled', false));
    await user.click(fileButton(toolbar));
    await user.hover(item(toolbar, /^Export/));
    fireEvent.click(item(toolbar, 'PDF (.pdf)'));
    expect(toolbar.queryByRole('button', { name: 'PDF (.pdf)' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the Open Recent and Import submenus', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(fileButton(toolbar));
    await user.hover(item(toolbar, /^Open Recent/));
    expect(item(toolbar, 'No Recent Files')).toHaveProperty('disabled', true);
    await user.hover(item(toolbar, /^Import/));
    expect(toolbar.queryByRole('button', { name: 'No Recent Files' })).toBeNull();
    expect(item(toolbar, 'From PowerPoint…')).toBeTruthy();
    expect(item(toolbar, 'From URL…')).toBeTruthy();
    expect(item(toolbar, 'From Marp…')).toBeTruthy();
  });

  it('runs Open from the menu and from its shortcut', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(fileButton(toolbar));
    await user.click(item(toolbar, /^Open Ctrl/));
    await waitFor(() => expect(calls).toContain('plugin:dialog|open'));
    expect(toolbar.queryByRole('button', { name: /^Open Ctrl/ })).toBeNull();

    calls = [];
    fireEvent.keyDown(window, { key: 'o', code: 'KeyO', ctrlKey: true });
    await waitFor(() => expect(calls).toContain('plugin:dialog|open'));
  });
});

describe('App toolbar: Edit menu', () => {
  it('toggles, shows shortcuts and closes on an outside click', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(editButton(toolbar));
    expect(item(toolbar, 'Undo Ctrl+Z')).toBeTruthy();
    expect(item(toolbar, 'Redo Ctrl+Y')).toBeTruthy();
    expect(item(toolbar, 'Cut Ctrl+X')).toBeTruthy();
    expect(item(toolbar, 'Copy Ctrl+C')).toBeTruthy();
    expect(item(toolbar, 'Paste Ctrl+V')).toBeTruthy();
    expect(item(toolbar, 'Select All Ctrl+A')).toBeTruthy();
    expect(item(toolbar, 'Find Ctrl+F')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(toolbar.queryByRole('button', { name: 'Undo Ctrl+Z' })).toBeNull();

    await user.click(editButton(toolbar));
    await user.click(editButton(toolbar));
    expect(toolbar.queryByRole('button', { name: 'Undo Ctrl+Z' })).toBeNull();
  });

  it('closes after an item is chosen', async () => {
    const { user, toolbar } = await renderApp();
    await user.click(editButton(toolbar));
    await user.click(item(toolbar, 'Select All Ctrl+A'));
    expect(toolbar.queryByRole('button', { name: 'Select All Ctrl+A' })).toBeNull();
  });
});

describe('App toolbar: buttons and window controls', () => {
  it('shows the untitled document name', async () => {
    const { toolbar } = await renderApp();
    expect(toolbar.getByText('Untitled.md')).toBeTruthy();
  });

  it('toggles the inspector button state', async () => {
    const { user, toolbar } = await renderApp();
    const btn = toolbar.getByTitle('Toggle inspector');
    const before = btn.classList.contains('wm-btn--active');
    await user.click(btn);
    expect(btn.classList.contains('wm-btn--active')).toBe(!before);
  });

  it('labels the focus-mode button with its shortcut', async () => {
    const { toolbar } = await renderApp();
    expect(toolbar.getByTitle('Enter focus mode (Ctrl+Shift+F)')).toBeTruthy();
  });

  it('minimises and maximises the window on mousedown', async () => {
    const { toolbar } = await renderApp();
    fireEvent.mouseDown(toolbar.getByTitle('Minimise'));
    fireEvent.mouseDown(toolbar.getByTitle('Maximise / Restore'));
    await waitFor(() => {
      expect(calls).toContain('plugin:window|minimize');
      expect(calls).toContain('plugin:window|toggle_maximize');
    });
  });
});
