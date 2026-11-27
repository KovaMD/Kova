import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as ipc from '../platform/ipc';
import type { EditorHandle } from '../components/layout/EditorPanel';
import { isMarp, importMarp } from '../engine/import/marp';
import { dirname, dirnameOn, pathSeparator } from '../engine/paths';
import type { AppSettings } from '../store/settings';
import { loadLastSession, saveLastSession } from '../store/lastSession';
import { loadRecentFiles, addRecentFile, removeRecentFile, clearRecentFiles } from '../store/recentFiles';
import type { PendingCli } from '../types/cli';
import { bestEffort } from '../platform/bestEffort';

export function makeStarter() {
  return `---
title: My Presentation
date: ${new Date().getFullYear()}
---

# My Presentation

---

## First Slide

- Point one
- Point two
- Point three
`;
}

/**
 * The theme operations the document lifecycle drives. App owns the theme
 * state (useThemeState), which itself derives from the document content, so
 * these are passed through as a port rather than the hook depending on it.
 * Called only from event handlers and effects, never during render.
 */
export interface DocumentThemePort {
  /** Pick the base theme named by a document's frontmatter `theme:` key. */
  syncThemeFromContent: (text: string) => void;
  /** True while a CLI --theme override supersedes the deck's own theme. */
  isCliThemeActive: () => boolean;
  setActiveThemeId: (id: string) => void;
  setMissingThemeId: (id: string | null) => void;
}

export type DocumentSettings = Pick<
  AppSettings,
  'confirmOnClose' | 'autosave' | 'autosaveIntervalSeconds' | 'defaultThemeId' | 'startupBehavior' | 'showFrontmatter'
>;

export interface UseDocumentOptions {
  settings: DocumentSettings;
  theme: DocumentThemePort;
  setCurrentSlideIndex: (index: number) => void;
  /** Scrolled to the restored slide after a last-session restore. */
  editorRef: RefObject<EditorHandle | null>;
  /**
   * Session started via `kova --present`: it must not touch the recents list
   * (or the last-session record, see useLastSessionRecord).
   */
  coldPresent: boolean;
  /** The cached CLI drain; a CLI launch owns the session, so restore skips. */
  getPendingCli: () => Promise<PendingCli | null>;
  /** Shows a warning that stays until replaced (open/save/rename failures). */
  setWarnMessage: (message: string) => void;
}

export interface UseDocumentResult {
  filePath: string | null;
  content: string;
  setContent: Dispatch<SetStateAction<string>>;
  /** Render-updated mirror of `content`, for handlers that must not re-bind. */
  contentRef: RefObject<string>;
  isDirty: boolean;
  setIsDirty: Dispatch<SetStateAction<boolean>>;
  /**
   * Source folder of an imported deck. The import lands in an untitled buffer
   * (no filePath), but its relative image paths must still resolve against
   * the original .md's location.
   */
  importDir: string;

  /** Run `action`, first asking to save when there are unsaved edits. */
  guardDirty: (action: () => void) => void;
  /** Shared post-load sequence for text already read (or generated). */
  applyFileContent: (text: string, path: string) => Promise<void>;
  /** Editor typing: `newBody` is the whole document or just the body. */
  handleContentChange: (newBody: string) => void;

  handleNewFile: () => void;
  handleOpenFile: () => void;
  handleSave: () => Promise<boolean>;
  handleSaveAs: () => Promise<string | null>;
  /** Open a path (drag-drop, Open Recent, file association). */
  handleMarkdownDrop: (path: string) => void;

  /** Import results land here: stop the watcher, then load. */
  openImported: (markdown: string, savedPath: string) => Promise<void>;
  handleImportMarp: () => void;
  marpPromptOpen: boolean;
  convertMarp: () => Promise<void>;
  dismissMarpPrompt: () => void;
  marpLoss: number | null;
  dismissMarpLoss: () => void;

  recents: string[];
  clearRecents: () => void;

  isRenaming: boolean;
  renameValue: string;
  startRename: (value: string) => void;
  setRenameValue: (value: string) => void;
  cancelRename: () => void;
  handleRenameCommit: () => Promise<void>;

  confirmCloseOpen: boolean;
  cancelConfirmClose: () => void;
  discardAndContinue: () => void;
  saveAndContinue: () => Promise<void>;

  externalChangeOpen: boolean;
  closeExternalChange: () => void;
  reloadExternalChange: () => Promise<void>;
  saveAsExternalChange: () => Promise<void>;
  externalReloadBannerOpen: boolean;
  dismissExternalReloadBanner: () => void;

  fileDragOver: boolean;
  dropConfirmPath: string | null;
  cancelDropConfirm: () => void;
  confirmDropOpen: () => Promise<void>;
}

/**
 * The open document's lifecycle: content and dirty state, open, save,
 * save-as, rename, the file watcher and external changes, autosave, recents,
 * last-session restore, drag-drop and file-association opens, and the
 * unsaved-changes guard in front of all of them.
 */
export function useDocument({
  settings,
  theme,
  setCurrentSlideIndex,
  editorRef,
  coldPresent,
  getPendingCli,
  setWarnMessage,
}: UseDocumentOptions): UseDocumentResult {
  const { syncThemeFromContent, isCliThemeActive, setActiveThemeId, setMissingThemeId } = theme;
  const [filePath, setFilePath] = useState<string | null>(null);
  const [content, setContent]   = useState('');
  const [isDirty, setIsDirty]   = useState(false);
  const [marpPrompt, setMarpPrompt] = useState<{ text: string; dir: string } | null>(null);
  const [marpLoss, setMarpLoss]     = useState<number | null>(null);
  const [importDir, setImportDir]   = useState('');
  const [recents, setRecents] = useState<string[]>(() => loadRecentFiles());
  // Wrapped in `{ run }` rather than storing the bare function: a bare
  // `useState<() => void>` makes `setConfirmCloseAction(action)` look correct
  // while actually invoking React's functional-updater form instead of
  // storing it. The wrapper removes that footgun entirely.
  const [confirmCloseAction, setConfirmCloseAction] = useState<{ run: () => void } | null>(null);
  const [showExternalChangeDialog, setShowExternalChangeDialog] = useState(false);
  const [showExternalReloadBanner, setShowExternalReloadBanner] = useState(false);
  const [isRenaming, setIsRenaming]       = useState(false);
  const [renameValue, setRenameValue]     = useState('');
  const [fileDragOver, setFileDragOver]       = useState(false);
  const [dropConfirmPath, setDropConfirmPath] = useState<string | null>(null);

  // When showFrontmatter is on, the editor receives the full document.
  // Ref is updated synchronously during render so handleContentChange (called
  // synchronously from CodeMirror's dispatch inside the [content] effect) always
  // sees the current value — a useEffect update would be too late.
  const showFrontmatterRef = useRef(settings.showFrontmatter);
  showFrontmatterRef.current = settings.showFrontmatter;
  const contentRef = useRef(content);
  contentRef.current = content;
  // Last content known to be persisted on disk for the currently watched file.
  // External-change events that do not alter this snapshot are ignored.
  const diskContentRef = useRef(content);
  // Monotonically increasing counter guarding handleMarkdownDrop's doOpen —
  // see the comment at its call site.
  const loadGenerationRef = useRef(0);
  // Updated in render body (not useEffect) so the file-changed listener always
  // sees the current dirty state when it fires synchronously after a watcher event.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  // Captures the file path at the moment the external-change dialog is opened,
  // so the Reload button always reloads the file that triggered the alert even
  // if the user somehow navigates to a different file before clicking.
  const externalChangePathRef = useRef<string | null>(null);

  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  // File-changed event from Rust watcher.
  // Kova's own atomic writes are suppressed on the Rust side (via the
  // own_write_suppress_until timestamp in AppState), so every event that
  // reaches here is a genuine external change and always requires acknowledgement.
  useEffect(() => {
    const unlisten = listen<void>('file-changed', async () => {
      const path = filePathRef.current;
      if (!path) return;
      let newContent: string;
      try {
        newContent = await ipc.readFile(path);
      } catch (err) {
        console.error('Failed to reload file:', err);
        if (isDirtyRef.current) {
          externalChangePathRef.current = path;
          setShowExternalChangeDialog(true);
        }
        return;
      }

      // OneDrive and other sync clients can touch file metadata frequently
      // without changing the markdown bytes. Ignore those watcher events.
      if (newContent === diskContentRef.current) return;

      if (isDirtyRef.current) {
        // Unsaved edits — block with a modal; user must choose reload or save-as.
        diskContentRef.current = newContent;
        externalChangePathRef.current = path;
        setShowExternalChangeDialog(true);
      } else {
        // No unsaved edits — reload silently then surface a dismissable banner.
        // Skip the frontmatter theme re-sync when a CLI --theme override is
        // active: it supersedes the deck's theme for the whole session.
        if (!isCliThemeActive()) syncThemeFromContent(newContent);
        setContent(newContent);
        setIsDirty(false);
        diskContentRef.current = newContent;
        setShowExternalReloadBanner(true);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  // Both are stable in App (port callbacks over hook-owned refs): runs once.
  }, [isCliThemeActive, syncThemeFromContent]);

  const guardDirty = useCallback((action: () => void) => {
    if (isDirty && settings.confirmOnClose) {
      setConfirmCloseAction({ run: action });
    } else {
      action();
    }
  }, [isDirty, settings.confirmOnClose]);

  const handleNewFile = useCallback(() => {
    guardDirty(async () => {
      await bestEffort(ipc.stopWatching(), 'stopWatching');
      setFilePath(null);
      setContent(makeStarter());
      setIsDirty(false);
      setCurrentSlideIndex(0);
      setActiveThemeId(settings.defaultThemeId);
      setMissingThemeId(null);
    });
  }, [guardDirty, settings.defaultThemeId, setActiveThemeId, setMissingThemeId, setCurrentSlideIndex]);

  // Shared post-load sequence: apply theme, content, and watcher for a file that
  // has already been read (or generated) and saved to disk.
  const applyFileContent = useCallback(async (text: string, path: string) => {
    syncThemeFromContent(text);
    setFilePath(path);
    setContent(text);
    setIsDirty(false);
    diskContentRef.current = text;
    setCurrentSlideIndex(0);
    if (path) await ipc.startWatching(path).catch(console.error);
    setMarpPrompt(isMarp(text) ? { text, dir: dirname(path) } : null);
    setImportDir('');
    setMarpLoss(null);
  }, [syncThemeFromContent, setCurrentSlideIndex]);

  // Startup restore — only when the user has opted in via Settings. Best-effort:
  // a deleted/moved/unreadable file just leaves the app at its normal blank
  // startup state rather than surfacing an error for what is, after all, a
  // convenience feature. Runs once on mount; settings.startupBehavior at the
  // time of mount is what matters (changing the setting later only affects
  // the *next* launch, not the current session).
  useEffect(() => {
    if (settings.startupBehavior !== 'reopenLast') return;
    const session = loadLastSession();
    if (!session) return;
    (async () => {
      // A cold-start present (kova --present) owns this session — restoring
      // the last file would race the CLI file's load through applyFileContent
      // and whichever resolves last would win, possibly presenting the wrong
      // deck. The CLI drain is cached, so this await costs one IPC roundtrip.
      // --import is headless and exits the process itself, but skip restoring
      // here too rather than doing pointless work moments before it quits.
      // --export needs this effect to stay out of the way entirely: it loads
      // its own file into the same state this would race against.
      const cli = await getPendingCli();
      if (cli?.present || cli?.import || cli?.export) return;
      try {
        const text: string = await ipc.readFile(session.path);
        await applyFileContent(text, session.path);
        // applyFileContent itself resets to slide 0 — apply the saved position
        // after it resolves so this wins. Out-of-range values are corrected by
        // the existing slide-index clamp effect once `slides` is recomputed.
        setCurrentSlideIndex(session.slideIndex);
        setTimeout(() => editorRef.current?.scrollToSlide(session.slideIndex), 50);
      } catch (err) {
        console.warn('[kova] could not restore last session:', err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- restores the last session once at startup; running again would reload the file over the user's edits
  }, []);

  // Maintain the "Open Recent" list whenever a file becomes the open document.
  useEffect(() => {
    // --present is a one-shot, headless presentation run — it must operate
    // independently of the desktop app's own state, same as it already skips
    // the last-session record (issue #185).
    if (coldPresent) return;
    if (filePath) setRecents(addRecentFile(filePath));
  }, [filePath, coldPresent]);

  const handleMarkdownDrop = useCallback((path: string) => {
    const doOpen = async () => {
      const myGeneration = ++loadGenerationRef.current;
      try {
        await bestEffort(ipc.stopWatching(), 'stopWatching');
        const text: string = await ipc.readFile(path);
        // Two fast, overlapping triggers (drag-drop or Open Recent) would
        // otherwise race independently through applyFileContent, and
        // whichever IPC call happens to resolve last "wins" per state field —
        // possibly mixing one file's content with another's path. Bail if a
        // newer load has started since this one began.
        if (loadGenerationRef.current !== myGeneration) return;
        await applyFileContent(text, path);
      } catch (err) {
        console.error('Drop open failed:', err);
        setRecents(removeRecentFile(path));
      }
    };

    if (!filePath && !isDirty) {
      void doOpen();
    } else if (isDirty) {
      guardDirty(() => void doOpen());
    } else {
      setDropConfirmPath(path);
    }
  }, [filePath, isDirty, guardDirty, applyFileContent]);

  // Listen for markdown file drops on the window (image drops are handled in EditorPanel)
  useEffect(() => {
    const MD_EXT = /\.(md|markdown)$/i;
    let dragHasMd = false;

    const unlisten = getCurrentWindow().onDragDropEvent((evt) => {
      const p = evt.payload;

      if (p.type === 'enter') {
        dragHasMd = p.paths.some((f) => MD_EXT.test(f));
        return;
      }
      if (p.type === 'over') {
        if (dragHasMd) setFileDragOver(true);
        return;
      }
      if (p.type === 'leave') {
        setFileDragOver(false);
        dragHasMd = false;
        return;
      }
      if (p.type === 'drop') {
        setFileDragOver(false);
        dragHasMd = false;
        const mdPath = p.paths.find((f) => MD_EXT.test(f));
        if (!mdPath) return;
        handleMarkdownDrop(mdPath);
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [handleMarkdownDrop]);

  const openImported = useCallback(async (markdown: string, savedPath: string) => {
    await bestEffort(ipc.stopWatching(), 'stopWatching');
    await applyFileContent(markdown, savedPath);
  }, [applyFileContent]);

  const handleImportMarp = useCallback(() => {
    guardDirty(async () => { try {
      const selected = await open({
        filters: [{ name: 'Marp Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      await bestEffort(ipc.stopWatching(), 'stopWatching');
      const text: string = await ipc.readFile(selected);
      const { markdown, dropped } = importMarp(text);
      await applyFileContent(markdown, '');
      setImportDir(dirname(selected));
      setMarpPrompt(null);
      setMarpLoss(dropped.length);
    } catch (err) { console.error('Marp import failed:', err); } });
  }, [guardDirty, applyFileContent]);

  const convertMarp = useCallback(async () => {
    if (!marpPrompt) return;
    const { text, dir } = marpPrompt;
    const { markdown, dropped } = importMarp(text);
    setMarpPrompt(null);
    await bestEffort(ipc.stopWatching(), 'stopWatching');
    await applyFileContent(markdown, '');
    setImportDir(dir);
    setMarpLoss(dropped.length);
  }, [marpPrompt, applyFileContent]);

  const handleOpenFile = useCallback(() => {
    guardDirty(async () => { try {
      const selected = await open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      await bestEffort(ipc.stopWatching(), 'stopWatching');
      const text: string = await ipc.readFile(selected);
      await applyFileContent(text, selected);
    } catch (err) { console.error('Open failed:', err); setWarnMessage(`Could not open file: ${err}`); }});
  }, [guardDirty, applyFileContent, setWarnMessage]);

  const handleRenameCommit = useCallback(async () => {
    setIsRenaming(false);
    if (!filePath) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    const sep = pathSeparator(filePath);
    const dir = dirnameOn(filePath, sep);
    const ext = filePath.match(/\.(md|markdown)$/i)?.[0] ?? '.md';
    const newPath = `${dir}${sep}${trimmed}${ext}`;
    if (newPath === filePath) return;
    try {
      await bestEffort(ipc.stopWatching(), 'stopWatching');
      await ipc.renameFile(filePath, newPath);
      setFilePath(newPath);
      await ipc.startWatching(newPath).catch(console.error);
    } catch (err) {
      console.error('Rename failed:', err);
      setWarnMessage(`Rename failed: ${err}`);
    }
  }, [filePath, renameValue, setWarnMessage]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!filePath) return false;
    // Optimistic: mark clean before the write so that when the OS file-watcher
    // fires (during the IPC round-trip) isDirtyRef.current is already false and
    // the event is treated as a silent no-op reload rather than a warning.
    // React renders this state change before Rust's disk I/O + IPC completes.
    setIsDirty(false);
    const savingPath = filePath;
    const contentAtSave = content;
    try {
      // The document is the single source of truth — theme overrides and every
      // frontmatter edit are already in `content`, so write it verbatim.
      const toWrite = contentAtSave;
      await ipc.writeFile(savingPath, toWrite);
      // The user may have opened a different document while the write was in
      // flight (isDirty was already cleared above, so guardDirty let them) —
      // in that case this save's side effects belong to a document that's no
      // longer open, so leave the now-active document's state alone.
      if (filePathRef.current !== savingPath) return true;
      diskContentRef.current = toWrite;
      if (contentRef.current === contentAtSave) {
        if (toWrite !== contentAtSave) setContent(toWrite);
      } else {
        // The user kept typing while the write was in flight — toWrite only
        // reflects the pre-save snapshot, so adopting it here would discard
        // those newer edits. Leave the live content as-is and stay dirty so
        // a follow-up save picks them up.
        setIsDirty(true);
      }
      // Re-register the watcher: atomic_write replaces the file's inode via
      // rename, which causes inotify to drop the watch on the old inode.
      // Explicitly re-watching after each save ensures external changes are
      // detected regardless of how the OS / notify crate handles the rename.
      await ipc.startWatching(savingPath).catch(console.error);
      // Saving resolves any pending external-change conflict: the user's edits
      // win. Dismiss the dialog so the confirmCloseAction "Save" path can
      // proceed with the close, and so Ctrl+S while the dialog is open doesn't
      // leave a stale conflict prompt on screen.
      setShowExternalChangeDialog(false);
      return true;
    } catch (err) {
      if (filePathRef.current === savingPath) setIsDirty(true);
      console.error('Save failed:', err);
      setWarnMessage(`Save failed: ${err}`);
      return false;
    }
  }, [filePath, content, setWarnMessage]);

  const handleSaveAs = useCallback(async (): Promise<string | null> => {
    const startedFromPath = filePath;
    try {
      const target = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: filePath ?? undefined,
      });
      if (!target) return null;
      const contentAtSave = content;
      const toWrite = contentAtSave;
      await ipc.writeFile(target, toWrite);
      // The user may have switched to a different document while the native
      // save dialog was open or the write was in flight — don't adopt `target`
      // as the active file out from under them in that case.
      if (filePathRef.current !== startedFromPath) return target;
      diskContentRef.current = toWrite;
      setFilePath(target);
      if (contentRef.current === contentAtSave) {
        setIsDirty(false);
        if (toWrite !== contentAtSave) setContent(toWrite);
      } else {
        // Content changed while the write was in flight — keep those edits
        // and stay dirty rather than clobbering them with the pre-save snapshot.
        setIsDirty(true);
      }
      await ipc.startWatching(target).catch(console.error);
      return target;
    } catch (err) { console.error('Save As failed:', err); setWarnMessage(`Save failed: ${err}`); return null; }
  }, [filePath, content, setWarnMessage]);

  const handleContentChange = useCallback((newBody: string) => {
    if (showFrontmatterRef.current) {
      // Editor holds the full document — use it directly.
      setContent(newBody);
    } else {
      setContent((prev) => {
        const fm = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
        return (fm ? fm[0] : '') + newBody;
      });
    }
    setIsDirty(true);
  }, []);

  // handleSave gets a new identity on every keystroke (it depends on `content`).
  // A ref lets the autosave timer below call the latest save logic without
  // including that ever-changing identity in its own dependency array — see the
  // effect's comment for why that matters.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  // File association: open files delivered via double-click / "Open With".
  // On macOS, paths arrive via RunEvent::Opened; on Linux/Windows, via CLI arg
  // buffered in lib.rs setup. Drain on mount, then listen for live macOS opens.
  // Opens the first path only — single-window editor, no tabs.
  useEffect(() => {
    void bestEffort(ipc.takePendingOpen()
      .then((paths) => { if (paths[0]) handleMarkdownDrop(paths[0]); }), 'takePendingOpen');
    const un = listen<string[]>('open-file', (e) => {
      const p = e.payload?.[0];
      if (p) handleMarkdownDrop(p);
    });
    return () => { un.then((f) => f()); };
  }, [handleMarkdownDrop]);

  // Autosave — only when enabled, a file path exists, and there are unsaved changes.
  // Deliberately excludes `handleSave` from the dependency array: if it were
  // included, the timer would be torn down and restarted on every keystroke
  // (handleSave's identity changes with `content`), so the countdown would
  // perpetually reset to zero and autosave would never actually fire during
  // continuous editing. isDirty's false→true transition is what starts the
  // timer; it then runs uninterrupted every autosaveIntervalSeconds until the
  // next save (isDirty back to false) regardless of further keystrokes.
  useEffect(() => {
    // Suppress autosave while the external-change dialog is open: the user must
    // explicitly choose to reload or save-as, and silently writing would resolve
    // the conflict without acknowledgement. The timer is killed when the dialog
    // opens and restarted (fresh interval) once the user dismisses it.
    if (!settings.autosave || !filePath || !isDirty || showExternalChangeDialog) return;
    const id = setInterval(() => { handleSaveRef.current(); }, settings.autosaveIntervalSeconds * 1000);
    return () => clearInterval(id);
  }, [settings.autosave, settings.autosaveIntervalSeconds, filePath, isDirty, showExternalChangeDialog]);

  const reloadExternalChange = useCallback(async () => {
    // Use the path captured when the dialog opened, not the
    // current filePathRef — the user may have navigated away.
    const path = externalChangePathRef.current;
    setShowExternalChangeDialog(false);
    if (!path) return;
    try {
      const newContent: string = await ipc.readFile(path);
      syncThemeFromContent(newContent);
      setContent(newContent);
      setIsDirty(false);
      diskContentRef.current = newContent;
    } catch (err) { console.error('Failed to reload file:', err); }
  }, [syncThemeFromContent]);

  const saveAsExternalChange = useCallback(async () => {
    setShowExternalChangeDialog(false);
    await handleSaveAs();
  }, [handleSaveAs]);

  const discardAndContinue = useCallback(() => {
    const a = confirmCloseAction;
    setConfirmCloseAction(null);
    a?.run();
  }, [confirmCloseAction]);

  const saveAndContinue = useCallback(async () => {
    const action = confirmCloseAction;
    setConfirmCloseAction(null);
    if (filePath) {
      const saved = await handleSave();
      if (!saved) return;
    } else {
      const saved = await handleSaveAs();
      if (!saved) return;
    }
    action?.run();
  }, [confirmCloseAction, filePath, handleSave, handleSaveAs]);

  const confirmDropOpen = useCallback(async () => {
    const path = dropConfirmPath;
    setDropConfirmPath(null);
    if (!path) return;
    try {
      await bestEffort(ipc.stopWatching(), 'stopWatching');
      const text: string = await ipc.readFile(path);
      await applyFileContent(text, path);
    } catch (err) {
      console.error('Drop open failed:', err);
      setRecents(removeRecentFile(path));
    }
  }, [dropConfirmPath, applyFileContent]);

  const clearRecents = useCallback(() => { clearRecentFiles(); setRecents([]); }, []);
  const startRename = useCallback((value: string) => { setRenameValue(value); setIsRenaming(true); }, []);
  const cancelRename = useCallback(() => setIsRenaming(false), []);
  const cancelConfirmClose = useCallback(() => setConfirmCloseAction(null), []);
  const closeExternalChange = useCallback(() => setShowExternalChangeDialog(false), []);
  const dismissExternalReloadBanner = useCallback(() => setShowExternalReloadBanner(false), []);
  const dismissMarpPrompt = useCallback(() => setMarpPrompt(null), []);
  const dismissMarpLoss = useCallback(() => setMarpLoss(null), []);
  const cancelDropConfirm = useCallback(() => setDropConfirmPath(null), []);

  return {
    filePath,
    content,
    setContent,
    contentRef,
    isDirty,
    setIsDirty,
    importDir,
    guardDirty,
    applyFileContent,
    handleContentChange,
    handleNewFile,
    handleOpenFile,
    handleSave,
    handleSaveAs,
    handleMarkdownDrop,
    openImported,
    handleImportMarp,
    marpPromptOpen: marpPrompt !== null,
    convertMarp,
    dismissMarpPrompt,
    marpLoss,
    dismissMarpLoss,
    recents,
    clearRecents,
    isRenaming,
    renameValue,
    startRename,
    setRenameValue,
    cancelRename,
    handleRenameCommit,
    confirmCloseOpen: confirmCloseAction !== null,
    cancelConfirmClose,
    discardAndContinue,
    saveAndContinue,
    externalChangeOpen: showExternalChangeDialog,
    closeExternalChange,
    reloadExternalChange,
    saveAsExternalChange,
    externalReloadBannerOpen: showExternalReloadBanner,
    dismissExternalReloadBanner,
    fileDragOver,
    dropConfirmPath,
    cancelDropConfirm,
    confirmDropOpen,
  };
}

/**
 * Keeps the last-session record current so it's accurate whenever the app
 * actually quits. Mirrors the literal on-screen state: clears the record
 * when there's no open file (e.g. after File > New) rather than leaving a
 * stale pointer to whatever was open before. Separate from useDocument
 * because the slide index is derived from the document's own content.
 */
export function useLastSessionRecord(filePath: string | null, slideIndex: number, coldPresent: boolean): void {
  const lastSessionMountedRef = useRef(false);
  useEffect(() => {
    // Skip the very first run: on mount, filePath/coldPresent are still
    // their initial values (null/false) regardless of launch type, because
    // the cold-start/restore effects only update them after an await.
    // Without this guard, that first pass unconditionally wrote
    // saveLastSession(null) — deleting any existing session — before the
    // restore effect or a CLI --present run had a chance to even read it.
    // For a normal restore this self-corrected a moment later when the
    // real filePath landed, but for --present it didn't: the restore effect
    // bails early once cli.present is set, and coldPresent stays true for
    // the rest of the process, so the deletion was never undone — running
    // --present was silently erasing the "reopen last file" record on every
    // launch (issue #185).
    if (!lastSessionMountedRef.current) {
      lastSessionMountedRef.current = true;
      return;
    }
    // A presentation-only run (kova --present) must not clobber the editor's
    // last-session record — the user never opened this file for editing.
    if (coldPresent) return;
    saveLastSession(filePath ? { path: filePath, slideIndex } : null);
  }, [filePath, slideIndex, coldPresent]);
}
