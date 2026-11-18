// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { RefObject } from 'react';
import type { EditorHandle } from '../../components/layout/EditorPanel';
import type { PendingCli } from '../../types/cli';

// ── Fakes ────────────────────────────────────────────────────────────────────

/** In-memory disk behind the fake ipc. */
const disk = vi.hoisted(() => new Map<string, string>());

const ipc = vi.hoisted(() => ({
  readFile: vi.fn(async (path: string) => {
    const text = disk.get(path);
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  }),
  writeFile: vi.fn(async (path: string, content: string) => { disk.set(path, content); }),
  startWatching: vi.fn<(path: string) => Promise<void>>(async () => {}),
  stopWatching: vi.fn<() => Promise<void>>(async () => {}),
  renameFile: vi.fn(async (oldPath: string, newPath: string) => {
    const text = disk.get(oldPath);
    if (text === undefined) throw new Error('rename failed');
    disk.delete(oldPath);
    disk.set(newPath, text);
  }),
  takePendingOpen: vi.fn<() => Promise<string[]>>(async () => []),
}));
vi.mock('../../platform/ipc', () => ipc);

const dialog = vi.hoisted(() => ({
  open: vi.fn<(opts: unknown) => Promise<string | string[] | null>>(),
  save: vi.fn<(opts: unknown) => Promise<string | null>>(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

/** Captured `listen` handlers by event name. */
const listeners = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => unknown>());
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (e: { payload: unknown }) => unknown) => {
    listeners.set(name, handler);
    return () => { if (listeners.get(name) === handler) listeners.delete(name); };
  }),
}));

type DragPayload = { type: 'enter' | 'over'; paths: string[] } | { type: 'leave' } | { type: 'drop'; paths: string[] };
const dragDrop = vi.hoisted(() => ({ handler: null as null | ((e: { payload: DragPayload }) => void) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: async (h: (e: { payload: DragPayload }) => void) => {
      dragDrop.handler = h;
      return () => { if (dragDrop.handler === h) dragDrop.handler = null; };
    },
  }),
}));

import { useDocument, useLastSessionRecord, makeStarter, type UseDocumentOptions, type DocumentSettings } from '../useDocument';

const SETTINGS: DocumentSettings = {
  confirmOnClose: true,
  autosave: false,
  autosaveIntervalSeconds: 30,
  defaultThemeId: 'light',
  startupBehavior: 'blank',
  showFrontmatter: false,
};

const NO_CLI: PendingCli = {
  present: null, theme: null, check: false, check_only: null, import: null, export: null,
} as PendingCli;

function setup(overrides: Partial<UseDocumentOptions> & { settings?: Partial<DocumentSettings> } = {}) {
  const theme = {
    syncThemeFromContent: vi.fn<(text: string) => void>(),
    isCliThemeActive: vi.fn<() => boolean>(() => false),
    setActiveThemeId: vi.fn<(id: string) => void>(),
    setMissingThemeId: vi.fn<(id: string | null) => void>(),
  };
  const scrollToSlide = vi.fn<(index: number) => void>();
  const editorRef = { current: { scrollToSlide } as unknown as EditorHandle } as RefObject<EditorHandle | null>;
  const setCurrentSlideIndex = vi.fn<(index: number) => void>();
  const setWarnMessage = vi.fn<(message: string) => void>();
  const getPendingCli = vi.fn(async () => NO_CLI);
  const { settings: settingsOverride, ...rest } = overrides;
  const base: UseDocumentOptions = {
    settings: { ...SETTINGS, ...settingsOverride },
    theme,
    setCurrentSlideIndex,
    editorRef,
    coldPresent: false,
    getPendingCli,
    setWarnMessage,
    ...rest,
  };
  const hook = renderHook((props: Partial<UseDocumentOptions>) => useDocument({ ...base, ...props }), { initialProps: {} });
  return { ...hook, theme, scrollToSlide, setCurrentSlideIndex, setWarnMessage, getPendingCli: base.getPendingCli };
}

type Hook = ReturnType<typeof setup>['result'];

/** Open `path` (already on the fake disk) through File > Open. */
async function openViaDialog(result: Hook, path: string) {
  dialog.open.mockResolvedValueOnce(path);
  await act(async () => { result.current.handleOpenFile(); });
  await waitFor(() => expect(result.current.filePath).toBe(path));
}

/** Fire the Rust watcher's file-changed event and let its read settle. */
async function fireFileChanged() {
  const handler = listeners.get('file-changed');
  expect(handler).toBeTruthy();
  await act(async () => { await handler!({ payload: undefined }); });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  disk.clear();
  listeners.clear();
  dragDrop.handler = null;
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  vi.useRealTimers();
});

// ── Open ─────────────────────────────────────────────────────────────────────

describe('useDocument: open', () => {
  it('opens the chosen file: stops the old watcher, reads, applies and watches', async () => {
    disk.set('/d/a.md', '---\ntheme: dark\n---\n# A\n');
    const { result, theme, setCurrentSlideIndex } = setup();
    await openViaDialog(result, '/d/a.md');

    expect(result.current.content).toBe('---\ntheme: dark\n---\n# A\n');
    expect(result.current.isDirty).toBe(false);
    expect(theme.syncThemeFromContent).toHaveBeenCalledWith('---\ntheme: dark\n---\n# A\n');
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(0);
    expect(ipc.stopWatching).toHaveBeenCalledTimes(1);
    expect(ipc.startWatching).toHaveBeenCalledWith('/d/a.md');
    expect(ipc.stopWatching.mock.invocationCallOrder[0]).toBeLessThan(ipc.startWatching.mock.invocationCallOrder[0]);
    expect(dialog.open).toHaveBeenCalledWith({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      multiple: false,
    });
  });

  it('does nothing when the dialog is cancelled', async () => {
    dialog.open.mockResolvedValueOnce(null);
    const { result } = setup();
    await act(async () => { result.current.handleOpenFile(); });
    expect(ipc.readFile).not.toHaveBeenCalled();
    expect(result.current.filePath).toBeNull();
  });

  it('warns when the file cannot be read', async () => {
    dialog.open.mockResolvedValueOnce('/missing.md');
    const { result, setWarnMessage } = setup();
    await act(async () => { result.current.handleOpenFile(); });
    await waitFor(() => expect(setWarnMessage).toHaveBeenCalledTimes(1));
    expect(setWarnMessage.mock.calls[0][0]).toMatch(/^Could not open file: Error: ENOENT/);
    expect(result.current.filePath).toBeNull();
  });

  it('offers Marp conversion for a Marp deck and converts it into an untitled buffer', async () => {
    disk.set('/m/deck.md', '---\nmarp: true\n---\n# M\n');
    const { result } = setup();
    await openViaDialog(result, '/m/deck.md');
    expect(result.current.marpPromptOpen).toBe(true);

    await act(async () => { await result.current.convertMarp(); });
    expect(result.current.marpPromptOpen).toBe(false);
    expect(result.current.filePath).toBe('');
    expect(result.current.importDir).toBe('/m');
    expect(result.current.marpLoss).toBe(0);
    expect(result.current.content).not.toContain('marp: true');
  });

  it('imports a Marp file from File > Import > Marp', async () => {
    disk.set('/m/deck.md', '---\nmarp: true\n---\n# M\n');
    dialog.open.mockResolvedValueOnce('/m/deck.md');
    const { result } = setup();
    await act(async () => { result.current.handleImportMarp(); });
    await waitFor(() => expect(result.current.marpLoss).toBe(0));
    expect(result.current.filePath).toBe('');
    expect(result.current.importDir).toBe('/m');
    expect(result.current.marpPromptOpen).toBe(false);
    expect(ipc.startWatching).not.toHaveBeenCalled();
  });

  it('openImported stops the watcher then loads the imported deck', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openImported('# Imported\n', '/x/imported.md'); });
    expect(ipc.stopWatching).toHaveBeenCalledTimes(1);
    expect(result.current.filePath).toBe('/x/imported.md');
    expect(result.current.content).toBe('# Imported\n');
    expect(ipc.startWatching).toHaveBeenCalledWith('/x/imported.md');
  });

  it('File > New loads the starter deck and resets the theme', async () => {
    const { result, theme, setCurrentSlideIndex } = setup();
    await act(async () => { result.current.handleNewFile(); });
    await waitFor(() => expect(result.current.content).toBe(makeStarter()));
    expect(result.current.filePath).toBeNull();
    expect(result.current.isDirty).toBe(false);
    expect(ipc.stopWatching).toHaveBeenCalledTimes(1);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(0);
    expect(theme.setActiveThemeId).toHaveBeenCalledWith('light');
    expect(theme.setMissingThemeId).toHaveBeenCalledWith(null);
  });
});

// ── Editing ──────────────────────────────────────────────────────────────────

describe('useDocument: editor typing', () => {
  it('keeps the frontmatter when the editor shows only the body', async () => {
    const { result } = setup();
    await act(async () => { await result.current.applyFileContent('---\ntitle: T\n---\n# Old\n', '/a.md'); });
    act(() => result.current.handleContentChange('# New\n'));
    expect(result.current.content).toBe('---\ntitle: T\n---\n# New\n');
    expect(result.current.isDirty).toBe(true);
  });

  it('takes the whole document when the editor shows the frontmatter', async () => {
    const { result } = setup({ settings: { showFrontmatter: true } });
    await act(async () => { await result.current.applyFileContent('---\ntitle: T\n---\n# Old\n', '/a.md'); });
    act(() => result.current.handleContentChange('# Whole\n'));
    expect(result.current.content).toBe('# Whole\n');
    expect(result.current.contentRef.current).toBe('# Whole\n');
  });
});

// ── Save / Save As ───────────────────────────────────────────────────────────

describe('useDocument: save', () => {
  it('writes the content, clears dirty and re-registers the watcher', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# A2\n'));
    ipc.startWatching.mockClear();

    let ok = false;
    await act(async () => { ok = await result.current.handleSave(); });
    expect(ok).toBe(true);
    expect(disk.get('/a.md')).toBe('# A2\n');
    expect(result.current.isDirty).toBe(false);
    expect(ipc.startWatching).toHaveBeenCalledWith('/a.md');
  });

  it('returns false without a file path', async () => {
    const { result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.handleSave(); });
    expect(ok).toBe(false);
    expect(ipc.writeFile).not.toHaveBeenCalled();
  });

  it('stays dirty and warns when the write fails', async () => {
    disk.set('/a.md', '# A\n');
    const { result, setWarnMessage } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# A2\n'));
    ipc.writeFile.mockRejectedValueOnce(new Error('disk full'));
    let ok = true;
    await act(async () => { ok = await result.current.handleSave(); });
    expect(ok).toBe(false);
    expect(result.current.isDirty).toBe(true);
    expect(setWarnMessage).toHaveBeenCalledWith('Save failed: Error: disk full');
  });

  it('stays dirty when the user typed while the write was in flight', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# A2\n'));

    let release!: () => void;
    ipc.writeFile.mockImplementationOnce((path, content) => new Promise<void>((r) => {
      release = () => { disk.set(path, content); r(); };
    }));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.handleSave(); });
    expect(result.current.isDirty).toBe(false); // optimistic
    act(() => result.current.handleContentChange('# A3\n'));
    await act(async () => { release(); await saving; });

    expect(disk.get('/a.md')).toBe('# A2\n');
    expect(result.current.content).toBe('# A3\n');
    expect(result.current.isDirty).toBe(true);
  });

  it('save-as writes to the chosen path and adopts it', async () => {
    const { result } = setup();
    act(() => result.current.handleContentChange('# Untitled\n'));
    dialog.save.mockResolvedValueOnce('/new/deck.md');
    let target: string | null = null;
    await act(async () => { target = await result.current.handleSaveAs(); });
    expect(target).toBe('/new/deck.md');
    expect(disk.get('/new/deck.md')).toBe('# Untitled\n');
    expect(result.current.filePath).toBe('/new/deck.md');
    expect(result.current.isDirty).toBe(false);
    expect(ipc.startWatching).toHaveBeenCalledWith('/new/deck.md');
    expect(dialog.save).toHaveBeenCalledWith({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: undefined,
    });
  });

  it('save-as returns null when the dialog is cancelled', async () => {
    const { result } = setup();
    dialog.save.mockResolvedValueOnce(null);
    let target: string | null = 'x';
    await act(async () => { target = await result.current.handleSaveAs(); });
    expect(target).toBeNull();
    expect(ipc.writeFile).not.toHaveBeenCalled();
  });

  it('save-as warns on a write failure', async () => {
    const { result, setWarnMessage } = setup();
    dialog.save.mockResolvedValueOnce('/new/deck.md');
    ipc.writeFile.mockRejectedValueOnce(new Error('denied'));
    let target: string | null = 'x';
    await act(async () => { target = await result.current.handleSaveAs(); });
    expect(target).toBeNull();
    expect(setWarnMessage).toHaveBeenCalledWith('Save failed: Error: denied');
  });
});

// ── Rename ───────────────────────────────────────────────────────────────────

describe('useDocument: rename', () => {
  it('renames on disk keeping the extension and re-watches the new path', async () => {
    disk.set('/d/old.markdown', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/d/old.markdown');
    act(() => result.current.startRename('old'));
    expect(result.current.isRenaming).toBe(true);
    act(() => result.current.setRenameValue('  fresh '));
    ipc.startWatching.mockClear();
    ipc.stopWatching.mockClear();

    await act(async () => { await result.current.handleRenameCommit(); });
    expect(result.current.isRenaming).toBe(false);
    expect(ipc.renameFile).toHaveBeenCalledWith('/d/old.markdown', '/d/fresh.markdown');
    expect(result.current.filePath).toBe('/d/fresh.markdown');
    expect(ipc.stopWatching).toHaveBeenCalledTimes(1);
    expect(ipc.startWatching).toHaveBeenCalledWith('/d/fresh.markdown');
  });

  it('is a no-op for an unchanged or blank name', async () => {
    disk.set('/d/same.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/d/same.md');
    act(() => result.current.startRename('same'));
    await act(async () => { await result.current.handleRenameCommit(); });
    act(() => result.current.startRename('   '));
    await act(async () => { await result.current.handleRenameCommit(); });
    expect(ipc.renameFile).not.toHaveBeenCalled();
  });

  it('cancel leaves rename mode without touching disk', () => {
    const { result } = setup();
    act(() => result.current.startRename('x'));
    act(() => result.current.cancelRename());
    expect(result.current.isRenaming).toBe(false);
    expect(ipc.renameFile).not.toHaveBeenCalled();
  });

  it('warns when the rename fails', async () => {
    disk.set('/d/a.md', '# A\n');
    const { result, setWarnMessage } = setup();
    await openViaDialog(result, '/d/a.md');
    ipc.renameFile.mockRejectedValueOnce(new Error('exists'));
    act(() => result.current.startRename('b'));
    await act(async () => { await result.current.handleRenameCommit(); });
    expect(setWarnMessage).toHaveBeenCalledWith('Rename failed: Error: exists');
    expect(result.current.filePath).toBe('/d/a.md');
  });
});

// ── Dirty guard / confirm close ─────────────────────────────────────────────

describe('useDocument: dirty guard', () => {
  it('runs the action at once when clean', () => {
    const { result } = setup();
    const action = vi.fn();
    act(() => result.current.guardDirty(action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.confirmCloseOpen).toBe(false);
  });

  it('runs the action at once when dirty but confirmOnClose is off', () => {
    const { result } = setup({ settings: { confirmOnClose: false } });
    act(() => result.current.handleContentChange('# x'));
    const action = vi.fn();
    act(() => result.current.guardDirty(action));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('asks first when dirty; cancel drops the action', () => {
    const { result } = setup();
    act(() => result.current.handleContentChange('# x'));
    const action = vi.fn();
    act(() => result.current.guardDirty(action));
    expect(action).not.toHaveBeenCalled();
    expect(result.current.confirmCloseOpen).toBe(true);
    act(() => result.current.cancelConfirmClose());
    expect(result.current.confirmCloseOpen).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('discard runs the pending action without saving', () => {
    const { result } = setup();
    act(() => result.current.handleContentChange('# x'));
    const action = vi.fn();
    act(() => result.current.guardDirty(action));
    act(() => result.current.discardAndContinue());
    expect(action).toHaveBeenCalledTimes(1);
    expect(ipc.writeFile).not.toHaveBeenCalled();
    expect(result.current.confirmCloseOpen).toBe(false);
  });

  it('save-and-continue saves the open file, then runs the action', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# B\n'));
    const action = vi.fn();
    act(() => result.current.guardDirty(action));
    await act(async () => { await result.current.saveAndContinue(); });
    expect(disk.get('/a.md')).toBe('# B\n');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('save-and-continue on an untitled deck goes through save-as and aborts if cancelled', async () => {
    const { result } = setup();
    act(() => result.current.handleContentChange('# B\n'));
    const action = vi.fn();
    act(() => result.current.guardDirty(action));
    dialog.save.mockResolvedValueOnce(null);
    await act(async () => { await result.current.saveAndContinue(); });
    expect(dialog.save).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
    expect(result.current.confirmCloseOpen).toBe(false);
  });

  it('save-and-continue aborts when the save fails', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# B\n'));
    const action = vi.fn();
    act(() => result.current.guardDirty(action));
    ipc.writeFile.mockRejectedValueOnce(new Error('nope'));
    await act(async () => { await result.current.saveAndContinue(); });
    expect(action).not.toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);
  });

  it('guards File > Open behind the prompt when dirty', async () => {
    disk.set('/b.md', '# B\n');
    const { result } = setup();
    act(() => result.current.handleContentChange('# x'));
    act(() => result.current.handleOpenFile());
    expect(dialog.open).not.toHaveBeenCalled();
    expect(result.current.confirmCloseOpen).toBe(true);
    dialog.open.mockResolvedValueOnce('/b.md');
    act(() => result.current.discardAndContinue());
    await waitFor(() => expect(result.current.filePath).toBe('/b.md'));
  });
});

// ── External change (file watcher) ───────────────────────────────────────────

describe('useDocument: external change', () => {
  it('reloads silently and shows the banner when clean', async () => {
    disk.set('/a.md', '# A\n');
    const { result, theme } = setup();
    await openViaDialog(result, '/a.md');
    theme.syncThemeFromContent.mockClear();
    disk.set('/a.md', '# Edited elsewhere\n');
    await fireFileChanged();
    expect(result.current.content).toBe('# Edited elsewhere\n');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.externalReloadBannerOpen).toBe(true);
    expect(result.current.externalChangeOpen).toBe(false);
    expect(theme.syncThemeFromContent).toHaveBeenCalledWith('# Edited elsewhere\n');
    act(() => result.current.dismissExternalReloadBanner());
    expect(result.current.externalReloadBannerOpen).toBe(false);
  });

  it('skips the theme re-sync while a CLI --theme override is active', async () => {
    disk.set('/a.md', '# A\n');
    const { result, theme } = setup();
    await openViaDialog(result, '/a.md');
    theme.syncThemeFromContent.mockClear();
    theme.isCliThemeActive.mockReturnValue(true);
    disk.set('/a.md', '# B\n');
    await fireFileChanged();
    expect(result.current.content).toBe('# B\n');
    expect(theme.syncThemeFromContent).not.toHaveBeenCalled();
  });

  it('ignores events that leave the bytes unchanged', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    await fireFileChanged();
    expect(result.current.externalReloadBannerOpen).toBe(false);
  });

  it('ignores events with no open file', async () => {
    setup();
    await fireFileChanged();
    expect(ipc.readFile).not.toHaveBeenCalled();
  });

  it('blocks with the dialog when dirty, and Reload re-reads the captured path', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# mine\n'));
    disk.set('/a.md', '# theirs\n');
    await fireFileChanged();
    expect(result.current.externalChangeOpen).toBe(true);
    expect(result.current.content).toBe('# mine\n');

    await act(async () => { await result.current.reloadExternalChange(); });
    expect(result.current.externalChangeOpen).toBe(false);
    expect(result.current.content).toBe('# theirs\n');
    expect(result.current.isDirty).toBe(false);
  });

  it('Save As from the dialog closes it and saves elsewhere', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# mine\n'));
    disk.set('/a.md', '# theirs\n');
    await fireFileChanged();
    dialog.save.mockResolvedValueOnce('/a-copy.md');
    await act(async () => { await result.current.saveAsExternalChange(); });
    expect(result.current.externalChangeOpen).toBe(false);
    expect(disk.get('/a-copy.md')).toBe('# mine\n');
    expect(result.current.filePath).toBe('/a-copy.md');
  });

  it('saving resolves the conflict and dismisses the dialog', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# mine\n'));
    disk.set('/a.md', '# theirs\n');
    await fireFileChanged();
    await act(async () => { await result.current.handleSave(); });
    expect(result.current.externalChangeOpen).toBe(false);
    expect(disk.get('/a.md')).toBe('# mine\n');
  });

  it('shows the dialog when the re-read fails while dirty', async () => {
    disk.set('/a.md', '# A\n');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleContentChange('# mine\n'));
    disk.delete('/a.md');
    await fireFileChanged();
    expect(result.current.externalChangeOpen).toBe(true);
  });

  it('registers the watcher listener once across re-renders', async () => {
    const { listen } = await import('@tauri-apps/api/event');
    const { result } = setup();
    act(() => result.current.handleContentChange('a'));
    act(() => result.current.handleContentChange('b'));
    const calls = vi.mocked(listen).mock.calls.filter(([name]) => name === 'file-changed');
    expect(calls).toHaveLength(1);
  });
});

// ── Autosave ─────────────────────────────────────────────────────────────────

describe('useDocument: autosave', () => {
  async function dirtyOpenDoc(settings: Partial<DocumentSettings>) {
    disk.set('/a.md', '# A\n');
    const hook = setup({ settings: { autosave: true, autosaveIntervalSeconds: 15, ...settings } });
    await openViaDialog(hook.result, '/a.md');
    vi.useFakeTimers();
    act(() => hook.result.current.handleContentChange('# typed\n'));
    return hook;
  }

  it('saves after the interval while dirty, without restarting on keystrokes', async () => {
    const { result } = await dirtyOpenDoc({});
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    act(() => result.current.handleContentChange('# typed more\n'));
    expect(ipc.writeFile).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(ipc.writeFile).toHaveBeenCalledWith('/a.md', '# typed more\n');
    expect(result.current.isDirty).toBe(false);
  });

  it('does not autosave when disabled', async () => {
    await dirtyOpenDoc({ autosave: false });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(ipc.writeFile).not.toHaveBeenCalled();
  });

  it('is suppressed while the external-change dialog is open', async () => {
    const { result } = await dirtyOpenDoc({});
    disk.set('/a.md', '# theirs\n');
    await fireFileChanged();
    expect(result.current.externalChangeOpen).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(ipc.writeFile).not.toHaveBeenCalled();
  });
});

// ── Recents ──────────────────────────────────────────────────────────────────

describe('useDocument: recents', () => {
  it('adds each opened file to the front of the list', async () => {
    disk.set('/a.md', 'a');
    disk.set('/b.md', 'b');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    await openViaDialog(result, '/b.md');
    expect(result.current.recents).toEqual(['/b.md', '/a.md']);
  });

  it('clearRecents empties the list and storage', async () => {
    disk.set('/a.md', 'a');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.clearRecents());
    expect(result.current.recents).toEqual([]);
    expect(localStorage.getItem('kova:recentFiles')).toBeNull();
  });

  it('drops a recent entry that can no longer be opened', async () => {
    localStorage.setItem('kova:recentFiles', JSON.stringify(['/gone.md', '/kept.md']));
    const { result } = setup();
    expect(result.current.recents).toEqual(['/gone.md', '/kept.md']);
    act(() => result.current.handleMarkdownDrop('/gone.md'));
    await waitFor(() => expect(result.current.recents).toEqual(['/kept.md']));
  });

  it('leaves the list alone during a cold --present session', async () => {
    const { result } = setup({ coldPresent: true });
    await act(async () => { await result.current.applyFileContent('# P', '/p.md'); });
    expect(result.current.recents).toEqual([]);
  });
});

// ── Last session ─────────────────────────────────────────────────────────────

describe('useDocument: last session', () => {
  it('restores the last file and slide when reopenLast is set', async () => {
    disk.set('/last.md', '# L\n');
    localStorage.setItem('kova:lastSession', JSON.stringify({ path: '/last.md', slideIndex: 3 }));
    const { result, setCurrentSlideIndex, scrollToSlide } = setup({ settings: { startupBehavior: 'reopenLast' } });
    await waitFor(() => expect(result.current.filePath).toBe('/last.md'));
    await waitFor(() => expect(setCurrentSlideIndex).toHaveBeenLastCalledWith(3));
    await waitFor(() => expect(scrollToSlide).toHaveBeenCalledWith(3));
    expect(result.current.content).toBe('# L\n');
  });

  it('does not restore when startup is blank', async () => {
    localStorage.setItem('kova:lastSession', JSON.stringify({ path: '/last.md', slideIndex: 0 }));
    const { getPendingCli } = setup();
    await act(async () => {});
    expect(getPendingCli).not.toHaveBeenCalled();
    expect(ipc.readFile).not.toHaveBeenCalled();
  });

  it('stays out of the way of a CLI --present launch', async () => {
    disk.set('/last.md', '# L\n');
    localStorage.setItem('kova:lastSession', JSON.stringify({ path: '/last.md', slideIndex: 0 }));
    const { result, getPendingCli } = setup({
      settings: { startupBehavior: 'reopenLast' },
      getPendingCli: vi.fn(async () => ({ ...NO_CLI, present: '/talk.md' })),
    });
    await waitFor(() => expect(getPendingCli).toHaveBeenCalled());
    await act(async () => {});
    expect(ipc.readFile).not.toHaveBeenCalled();
    expect(result.current.filePath).toBeNull();
  });

  it('a missing last file leaves the blank state', async () => {
    localStorage.setItem('kova:lastSession', JSON.stringify({ path: '/gone.md', slideIndex: 0 }));
    const { result } = setup({ settings: { startupBehavior: 'reopenLast' } });
    await waitFor(() => expect(ipc.readFile).toHaveBeenCalledWith('/gone.md'));
    await act(async () => {});
    expect(result.current.filePath).toBeNull();
  });
});

describe('useLastSessionRecord', () => {
  const stored = () => localStorage.getItem('kova:lastSession');

  it('skips the mount pass, then records the open file and slide', () => {
    localStorage.setItem('kova:lastSession', JSON.stringify({ path: '/prev.md', slideIndex: 1 }));
    const { rerender } = renderHook(
      ({ path, index }: { path: string | null; index: number }) => useLastSessionRecord(path, index, false),
      { initialProps: { path: null as string | null, index: 0 } },
    );
    expect(JSON.parse(stored()!)).toEqual({ path: '/prev.md', slideIndex: 1 });
    rerender({ path: '/a.md', index: 2 });
    expect(JSON.parse(stored()!)).toEqual({ path: '/a.md', slideIndex: 2 });
    rerender({ path: null, index: 0 });
    expect(stored()).toBeNull();
  });

  it('never writes during a cold --present session', () => {
    localStorage.setItem('kova:lastSession', JSON.stringify({ path: '/prev.md', slideIndex: 1 }));
    const { rerender } = renderHook(
      ({ path }: { path: string | null }) => useLastSessionRecord(path, 0, true),
      { initialProps: { path: null as string | null } },
    );
    rerender({ path: '/talk.md' });
    expect(JSON.parse(stored()!)).toEqual({ path: '/prev.md', slideIndex: 1 });
  });
});

// ── Drop, Open Recent and file association ──────────────────────────────────

describe('useDocument: drop', () => {
  function drag(payload: DragPayload) {
    act(() => dragDrop.handler!({ payload }));
  }

  it('highlights only for markdown drags and opens the dropped file', async () => {
    disk.set('/d/x.md', '# X\n');
    const { result } = setup();
    await waitFor(() => expect(dragDrop.handler).toBeTruthy());

    drag({ type: 'enter', paths: ['/d/pic.png'] });
    drag({ type: 'over', paths: ['/d/pic.png'] });
    expect(result.current.fileDragOver).toBe(false);
    drag({ type: 'leave' });

    drag({ type: 'enter', paths: ['/d/pic.png', '/d/x.md'] });
    drag({ type: 'over', paths: ['/d/pic.png', '/d/x.md'] });
    expect(result.current.fileDragOver).toBe(true);
    drag({ type: 'drop', paths: ['/d/pic.png', '/d/x.md'] });
    expect(result.current.fileDragOver).toBe(false);
    await waitFor(() => expect(result.current.filePath).toBe('/d/x.md'));
  });

  it('ignores a drop with no markdown file', async () => {
    const { result } = setup();
    await waitFor(() => expect(dragDrop.handler).toBeTruthy());
    drag({ type: 'drop', paths: ['/d/pic.png'] });
    expect(ipc.readFile).not.toHaveBeenCalled();
    expect(result.current.filePath).toBeNull();
  });

  it('asks before replacing a clean open file, then opens on confirm', async () => {
    disk.set('/a.md', 'a');
    disk.set('/b.md', 'b');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleMarkdownDrop('/b.md'));
    expect(result.current.dropConfirmPath).toBe('/b.md');
    expect(result.current.filePath).toBe('/a.md');

    await act(async () => { await result.current.confirmDropOpen(); });
    expect(result.current.dropConfirmPath).toBeNull();
    expect(result.current.filePath).toBe('/b.md');
  });

  it('cancelling the drop prompt keeps the open file', async () => {
    disk.set('/a.md', 'a');
    const { result } = setup();
    await openViaDialog(result, '/a.md');
    act(() => result.current.handleMarkdownDrop('/b.md'));
    act(() => result.current.cancelDropConfirm());
    expect(result.current.dropConfirmPath).toBeNull();
    expect(result.current.filePath).toBe('/a.md');
  });

  it('routes a drop onto unsaved edits through the dirty guard', () => {
    const { result } = setup();
    act(() => result.current.handleContentChange('# x'));
    act(() => result.current.handleMarkdownDrop('/b.md'));
    expect(result.current.confirmCloseOpen).toBe(true);
    expect(result.current.dropConfirmPath).toBeNull();
  });

  it('a newer open wins over an older one still reading', async () => {
    disk.set('/new.md', 'new');
    let releaseSlow!: () => void;
    ipc.readFile.mockImplementationOnce(() => new Promise<string>((r) => { releaseSlow = () => r('slow'); }));
    const { result } = setup();
    act(() => result.current.handleMarkdownDrop('/slow.md'));
    // Untitled and clean: the second open also proceeds without a prompt.
    act(() => result.current.handleMarkdownDrop('/new.md'));
    await waitFor(() => expect(result.current.filePath).toBe('/new.md'));
    await act(async () => { releaseSlow(); });
    expect(result.current.filePath).toBe('/new.md');
    expect(result.current.content).toBe('new');
  });

  it('opens the first file handed over by the OS on launch and later', async () => {
    disk.set('/assoc.md', 'assoc');
    disk.set('/later.md', 'later');
    ipc.takePendingOpen.mockResolvedValueOnce(['/assoc.md', '/ignored.md']);
    const { result } = setup();
    await waitFor(() => expect(result.current.filePath).toBe('/assoc.md'));

    // A live open-file event with a file already open asks first.
    await act(async () => { await listeners.get('open-file')!({ payload: ['/later.md'] }); });
    expect(result.current.dropConfirmPath).toBe('/later.md');
  });
});
