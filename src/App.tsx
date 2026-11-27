import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef, useDefaultLayout } from 'react-resizable-panels';

import { ThumbnailPanel } from './components/layout/ThumbnailPanel';
import { EditorPanel } from './components/layout/EditorPanel';
import type { EditorHandle, FormatCmd } from './components/layout/EditorPanel';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { StatusBar } from './components/layout/StatusBar';
import { PresentationOverlay } from './components/presentation/PresentationOverlay';
import { PresenterOverlay } from './components/presentation/PresenterOverlay';
import { SettingsModal } from './components/SettingsModal';
import { ThemeLibraryModal } from './components/inspector/ThemeLibraryModal';
import { ImportPptxModal } from './components/ImportPptxModal';
import { ImportUrlModal } from './components/ImportUrlModal';
import { FileMenu } from './components/app/FileMenu';
import { EditMenu } from './components/app/EditMenu';
import { WindowControls } from './components/app/WindowControls';
import { Toolbar } from './components/app/Toolbar';
import { FindReplaceDialog } from './components/app/FindReplaceDialog';
import { AppDialogs } from './components/app/AppDialogs';
import { basename, dirname, dirnameOn, pathSeparator } from './engine/paths';
import { loadSettings, saveSettings, EDITOR_FONT_OPTIONS } from './store/settings';
import { setDiagramRenderer } from './engine/export/diagramRenderer';
import type { AppSettings } from './store/settings';
import { loadLastSeenVersion, saveLastSeenVersion } from './store/lastSeenVersion';
import { buildMacMenu, delegateMenuActions } from './macMenu';
import type { MenuActions } from './macMenu';
import { loadKeybindings, matchShortcut, getCombo, isMac } from './engine/keybindings';
import type { Keybindings } from './engine/keybindings';
import { I18nProvider, useLocaleTranslator } from './i18n';
import { resolveDeckMeta } from './engine/render/slideModel';

import { parseDocument } from './engine/parser/markdownToSlides';
import { extractFrontmatter, patchFrontmatter } from './engine/parser/frontmatter';
import { fetchUpdate } from './engine/updater';
import { APP_VERSION } from './version';
import { sanitiseThemeOverrides, type ThemeOverridePatch } from './engine/theme';
import type { Slide, Frontmatter } from './engine/types';
import { parseAspectRatio, nextAspectRatio } from './engine/types';
import { getSlideStepCount } from './engine/layout/steps';
import { useResolvedSlides } from './hooks/useResolvedSlides';
import { useFindReplace } from './hooks/useFindReplace';
import { useOffscreenCapture } from './hooks/useOffscreenCapture';
import { useExports } from './hooks/useExports';
import { useThemeState } from './hooks/useThemeState';
import { useSlideEditing } from './hooks/useSlideEditing';
import { useDocument, useLastSessionRecord, type DocumentThemePort } from './hooks/useDocument';
import { usePresentationSession } from './hooks/usePresentationSession';
import { useColdStartState, useLocalMediaGate, useColdLoad, useColdExport } from './hooks/useColdStart';
import { getPendingCli } from './cli/coldStart';
import { OffscreenDeck } from './components/OffscreenDeck';
import { DeckProvider, useDeckContextValue } from './components/preview/DeckContext';

import './styles/global.css';

function countWords(text: string): number {
  return (text.match(/\b\w+\b/g) ?? []).length;
}

const EMPTY_SLIDES: Slide[] = [];
const EMPTY_FM: Frontmatter = {};

export default function App() {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [focusMode, setFocusMode]         = useState(false);
  // Index into visibleSlides (hidden slides skipped) while presenting — kept
  // separate from currentSlideIndex (which indexes the full editor deck).
  const [presentIndex, setPresentIndex]   = useState(0);
  // Build-reveal step index for the *current* presented slide (see
  // usePresentationNav / engine/layout/steps.ts) — always reset to 0 whenever
  // presentIndex changes to a different slide.
  const [presentStep, setPresentStep]     = useState(0);
  // Single handler for both overlays' onNavigate — usePresentationNav always
  // supplies both index and step explicitly, never one without the other.
  const handlePresentNavigate = useCallback((index: number, step: number) => {
    setPresentIndex(index);
    setPresentStep(step);
  }, []);
  // CLI cold-start session flags (kova --present / --export).
  const coldStart = useColdStartState();
  const { coldPresent, coldExport } = coldStart;
  const [settings, setSettings]           = useState<AppSettings>(loadSettings);
  const t = useLocaleTranslator(settings.locale);
  const [showSettings, setShowSettings]   = useState(false);
  const [settingsScrollToUpdates, setSettingsScrollToUpdates] = useState(false);
  const [showThemeLibrary, setShowThemeLibrary] = useState(false);
  const [showImport, setShowImport]       = useState(false);
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null);
  const [keybindings, setKeybindings]     = useState<Keybindings>({ path: '', combos: {} });
  const [warnMessage, setWarnMessage]     = useState<string | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pdfOptionsOpen, setPdfOptionsOpen] = useState(false);
  const [pdfPerPage, setPdfPerPage]         = useState(1);
  const [pdfNotesOn, setPdfNotesOn]         = useState(false);
  const [resolvedUiTheme, setResolvedUiTheme] = useState<'dark' | 'light'>('dark');
  const {
    context: offscreenContext,
    capturing,
    runCapture: runOffscreenCapture,
    onSlideReady: onOffscreenSlideReady,
    setSlideRef: setOffscreenSlideRef,
  } = useOffscreenCapture();
  const [showWhatsNew, setShowWhatsNew]       = useState(false);
  const editorRef         = useRef<EditorHandle>(null);

  // The document lifecycle drives theme state that is itself derived from the
  // document (useThemeState below reads the content's frontmatter), so the
  // theme operations reach useDocument through this stable port, which
  // forwards to the latest useThemeState result. Only ever called from
  // handlers and effects, by which time the ref is populated.
  const themeApiRef = useRef<DocumentThemePort | null>(null);
  const documentThemePort = useMemo<DocumentThemePort>(() => ({
    syncThemeFromContent: (text) => themeApiRef.current?.syncThemeFromContent(text),
    isCliThemeActive: () => themeApiRef.current?.isCliThemeActive() ?? false,
    setActiveThemeId: (id) => themeApiRef.current?.setActiveThemeId(id),
    setMissingThemeId: (id) => themeApiRef.current?.setMissingThemeId(id),
  }), []);

  const {
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
    recents,
    ...doc
  } = useDocument({
    settings,
    theme: documentThemePort,
    setCurrentSlideIndex,
    editorRef,
    coldPresent,
    getPendingCli,
    setWarnMessage,
  });

  // A single parse of the raw frontmatter block, shared below instead of
  // each derived value re-running extractFrontmatter's YAML parse on its own
  // — this is on the hot path (every keystroke re-renders App with a new
  // `content`).
  const parsedFrontmatter = useMemo(() => extractFrontmatter(content), [content]);

  const {
    allThemes,
    setActiveThemeId,
    missingThemeId,
    setMissingThemeId,
    installedRemoteIds,
    themeOverrides,
    baseTheme,
    activeTheme,
    reloadCustomThemes,
    handleMissingThemeInstalled,
    syncThemeFromContent,
    cliThemeRef,
    applyCliTheme,
  } = useThemeState({
    rawThemeOverrides: parsedFrontmatter.frontmatter.theme_overrides,
    onWarn: setWarnMessage,
  });
  themeApiRef.current = {
    syncThemeFromContent,
    isCliThemeActive: () => !!cliThemeRef.current,
    setActiveThemeId,
    setMissingThemeId,
  };

  // Persist panel layout across sessions and inspector toggle/hide.
  // The guard blocks saves while focus mode is active: collapse() fires the
  // onLayoutChanged callback synchronously (via the library's event emitter)
  // before React re-renders, so checking a ref inside the callback is too
  // early. Blocking at setItem — which runs inside the library's 100 ms
  // debounce — guarantees React has already committed focusModeRef.current.
  const PANEL_IDS = ['thumb', 'editor', 'inspector'] as const;
  const focusModeRef = useRef(false);
  focusModeRef.current = focusMode;
  const guardedStorage = useMemo<Storage>(() => ({
    get length()            { return localStorage.length; },
    clear()                 { localStorage.clear(); },
    key(i: number)          { return localStorage.key(i); },
    removeItem(key: string) { localStorage.removeItem(key); },
    getItem(key: string) {
      const val = localStorage.getItem(key);
      if (val) {
        try {
          const parsed = JSON.parse(val) as Record<string, unknown>;
          // Any panel at size 0 means the layout was saved while collapsed in
          // focus mode (a previous bug). Discard it so panels restore to their
          // defaultSize props rather than being invisible on next launch.
          if (Object.values(parsed).some(v => v === 0)) {
            localStorage.removeItem(key);
            return null;
          }
        } catch { /* non-JSON key — pass through */ }
      }
      return val;
    },
    setItem(key: string, val: string) {
      if (!focusModeRef.current) localStorage.setItem(key, val);
    },
  }), []);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'kova-main',
    panelIds: [...PANEL_IDS],
    storage: guardedStorage,
  });

  // Panel refs for Focus Mode collapse
  const thumbPanelRef     = usePanelRef();
  const inspectorPanelRef = usePanelRef();

  const handleFormat = useCallback((cmd: FormatCmd) => {
    editorRef.current?.runFormat(cmd);
  }, []);

  const handleThumbnailSelect = useCallback((index: number) => {
    setCurrentSlideIndex(index);
    editorRef.current?.scrollToSlide(index);
  }, []);

  const { slides: rawSlides, frontmatter } = useMemo(() => {
    if (!content.trim()) return { slides: EMPTY_SLIDES, frontmatter: EMPTY_FM };
    try { return parseDocument(content); }
    catch { return { slides: EMPTY_SLIDES, frontmatter: EMPTY_FM }; }
  }, [content]);

  // Body-only view for the editor — frontmatter is managed by the inspector.
  const editorBody = parsedFrontmatter.body;

  const editorContent = settings.showFrontmatter ? content : editorBody;

  const docDir = useMemo(
    () => (filePath ? dirname(filePath, importDir) : importDir),
    [filePath, importDir],
  );

  const slides = useResolvedSlides(rawSlides, docDir);

  // Compute a safe index in the same render as slides so children never receive
  // an out-of-bounds value during the frame before the clamp useEffect fires.
  const safeSlideIndex = slides.length > 0
    ? Math.min(currentSlideIndex, slides.length - 1)
    : 0;

  // Deck used for presentation + export — hidden slides removed. Reference-equal
  // to entries in `slides`, so index translation uses indexOf/indexOf.
  const visibleSlides = useMemo(() => slides.filter((s) => !s.hidden), [slides]);

  // Bounded wait for local media before a CLI cold export (useColdExport).
  const mediaGate = useLocalMediaGate(visibleSlides);
  const safePresentIndex = visibleSlides.length > 0
    ? Math.min(presentIndex, visibleSlides.length - 1)
    : 0;
  // Defensive clamp mirrors safePresentIndex — a slide's step count can only
  // shrink out from under presentStep via a hot-reloaded/edited-while-cold-
  // presenting deck, but the overlays should never receive an out-of-range value.
  const safePresentStep = visibleSlides[safePresentIndex]
    ? Math.min(presentStep, getSlideStepCount(visibleSlides[safePresentIndex]))
    : 0;

  // {title}/{author}/{date} for header/footer templates, resolved exactly as
  // the PPTX export does (resolveDeckMeta): {title} falls back to the cover
  // slide's H1 when frontmatter has none (issue #55), {date} to today.
  const { title: docTitle, author: docAuthor, date: docDate } = resolveDeckMeta(frontmatter, rawSlides, settings.locale);

  const aspectRatio = useMemo(
    () => parseAspectRatio(frontmatter.aspect_ratio as string | undefined),
    [frontmatter.aspect_ratio],
  );
  // Deck-wide render inputs for every SlideRenderer host (DeckContext).
  const deck = useDeckContextValue(activeTheme, docTitle, docAuthor, docDate, aspectRatio);

  const wordCount = useMemo(() => countWords(editorBody), [editorBody]);

  // Count image references that live outside the document's own folder.
  // These display fine locally but break if the .md file is moved without its images.
  // Debounced (unlike a plain useMemo on `content`) since a full-document
  // regex scan on every single keystroke adds up in a large deck — the
  // count only needs to settle a moment after the user stops typing, not
  // track every keystroke live.
  const [externalImageCount, setExternalImageCount] = useState(0);
  useEffect(() => {
    if (!filePath) { setExternalImageCount(0); return; }
    const id = setTimeout(() => {
      const docDir = dirnameOn(filePath, pathSeparator(filePath));
      const IMG_RE = /!\[[^\]]*\]\(([^\s)]+)/g;
      let count = 0;
      let m: RegExpExecArray | null;
      while ((m = IMG_RE.exec(content)) !== null) {
        const src = m[1];
        if (/^(https?|data|asset|tauri):\/\//i.test(src)) continue; // web / already-converted
        if (/^[A-Za-z]:[/\\]/.test(src) || src.startsWith('/')) {
          if (!src.startsWith(docDir)) count++;           // absolute path outside doc dir
        } else if (src.startsWith('..')) {
          count++;                                         // relative path escaping doc dir
        }
      }
      setExternalImageCount(count);
    }, 400);
    return () => clearTimeout(id);
  }, [content, filePath]);
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  // Load keybindings from the platform config dir on startup
  useEffect(() => {
    loadKeybindings().then(setKeybindings).catch(() => {});
  }, []);

  // Startup update check (only when opt-in setting is enabled)
  useEffect(() => {
    if (!settings.checkForUpdates) return;
    fetchUpdate()
      .then((update) => { if (update) setAvailableUpdate(update.version); })
      .catch((err) => console.error('[updater] startup check failed:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // "What's new" notice: fires the first launch after APP_VERSION changes,
  // regardless of how the update was installed (self-updater, APT/RPM,
  // Flatpak). A missing lastSeenVersion means a fresh install, not an
  // update, so it's recorded silently without a notice.
  // Always fires in dev (import.meta.env.DEV) so the notice can be eyeballed
  // without hand-editing localStorage — excluded from production builds.
  useEffect(() => {
    const lastSeen = loadLastSeenVersion();
    saveLastSeenVersion(APP_VERSION);
    const isNewVersion = lastSeen !== null && lastSeen !== APP_VERSION;
    if ((isNewVersion || import.meta.env.DEV) && settings.notifyWhatsNew) {
      setShowWhatsNew(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // Window title — used by the taskbar/switcher/Mission Control. On macOS the
  // title text is hidden at the NSWindow level (see lib.rs setup) so it doesn't
  // duplicate the in-app centered doctitle next to the traffic lights.
  useEffect(() => {
    const name = frontmatter.title ?? (filePath != null ? basename(filePath) : undefined) ?? 'Kova';
    getCurrentWindow().setTitle(isDirty ? `${name} • — Kova` : `${name} — Kova`).catch(() => {});
  }, [filePath, frontmatter.title, isDirty]);

  // Clamp slide index
  useEffect(() => {
    if (slides.length > 0 && currentSlideIndex >= slides.length) {
      setCurrentSlideIndex(slides.length - 1);
    }
  }, [slides.length, currentSlideIndex]);

  // Focus Mode: collapse/expand side panels
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      if (next) {
        thumbPanelRef.current?.collapse();
        inspectorPanelRef.current?.collapse();
      } else {
        thumbPanelRef.current?.expand();
        if (showInspector) inspectorPanelRef.current?.expand();
      }
      return next;
    });
  }, [thumbPanelRef, inspectorPanelRef, showInspector]);

  // Declared above usePresentationSession so its stable-identity useCallback
  // can be passed in without a temporal-dead-zone reference.
  const handleWarn = useCallback((msg: string) => {
    setWarnMessage(msg);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setWarnMessage(null), 6000);
  }, []);

  const { presentMode, presenterMode, handlePresentEnter, handlePresentExit } = usePresentationSession({
    slides,
    visibleSlides,
    safeSlideIndex,
    safePresentIndex,
    setCurrentSlideIndex,
    setPresentIndex,
    setPresentStep,
    activeTheme,
    aspectRatio,
    docTitle,
    docAuthor,
    docDate,
    settings,
    coldPresent,
    filePath,
    onWarn: handleWarn,
    t,
  });

  const actuallyCloseWindow = useCallback(async () => {
    // Unconditional: guarantees the macOS `caffeinate` child (and the Linux
    // DBus screensaver inhibit) are released on every normal quit path, not
    // just the ones that remembered to flip presentMode/presenterMode off
    // first. A crash/kill -9 can't be intercepted from user space — this only
    // covers the normal "ask before quit" paths below.
    await invoke('set_wake_lock', { active: false }).catch(() => {});
    // confirm_exit sets exit_confirmed=true then calls app.exit(0). Using
    // destroy() here instead causes a race on Linux: GTK's window teardown is
    // async relative to Tauri's registry, so get_webview_window("main") still
    // returns Some during ExitRequested and prevent_exit() is called — leaving
    // the process alive with no visible window.
    await invoke('confirm_exit').catch(() => {});
  }, []);

  const actuallyExitApp = useCallback(async () => {
    await invoke('set_wake_lock', { active: false }).catch(() => {});
    await invoke('confirm_exit').catch(() => {});
  }, []);

  // OS-level close: Alt+F4, taskbar "Close window", compositor gestures, etc.
  // Kova's own close button calls guardDirty(actuallyCloseWindow) directly so it
  // never reaches this path. Tauri automatically calls prevent_close() while a JS
  // listener is registered; event.preventDefault() makes that explicit so the
  // contract doesn't depend on that implementation detail.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      guardDirty(actuallyCloseWindow);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [guardDirty, actuallyCloseWindow]);

  // App-level quit (Cmd+Q / Dock "Quit" on macOS, or any other path that exits
  // the whole app rather than just this window) — see the matching
  // RunEvent::ExitRequested handler in lib.rs. This never fires for the
  // window-level close above, so both need their own guard.
  useEffect(() => {
    const unlisten = listen('app-exit-requested', () => { guardDirty(actuallyExitApp); });
    return () => { unlisten.then((fn) => fn()); };
  }, [guardDirty, actuallyExitApp]);

  // When the audience window has OS focus (common on Wayland where compositors
  // ignore focus:false), forward its keydown events so arrow-key navigation
  // works in the presenter without requiring a manual click.
  useEffect(() => {
    if (!presentMode && !presenterMode) return;
    const unlisten = listen<{ key: string }>('audience:key', (e) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: e.payload.key, bubbles: true, cancelable: true }));
    });
    const unlistenWheel = listen<{ deltaY: number }>('audience:wheel', (e) => {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: e.payload.deltaY, bubbles: true, cancelable: true }));
    });
    // Table-of-contents clicks on the audience-facing screen — the audience
    // window has already resolved the ToC entry to a visible-slide index.
    const unlistenNavigate = listen<{ index: number; step: number }>('audience:navigate', (e) => {
      setPresentIndex(e.payload.index);
      setPresentStep(e.payload.step);
    });
    return () => {
      unlisten.then((fn) => fn());
      unlistenWheel.then((fn) => fn());
      unlistenNavigate.then((fn) => fn());
    };
  }, [presentMode, presenterMode]);

  // Mirror mode: keep the audience window in sync with the presenter's slide.
  // Dual mode sync is handled by PresenterOverlay; this covers mirror mode where
  // PresentationOverlay drives navigation but never emits present:navigate.
  useEffect(() => {
    if (!presentMode) return;
    emitTo('audience', 'present:navigate', { index: safePresentIndex, step: safePresentStep }).catch(() => {});
  }, [presentMode, safePresentIndex, safePresentStep]);

  const handleThemeSelect = useCallback((id: string) => {
    setActiveThemeId(id);
    setContent((prev) => {
      // Preserve user-configured values across theme switches: header/footer/toc
      // content, font choices (issue #281) and any logo the user explicitly
      // chose. Colour overrides are cleared since they were customising the
      // old theme's palette.
      const cur = sanitiseThemeOverrides(
        extractFrontmatter(prev).frontmatter.theme_overrides as Record<string, unknown> ?? {},
      );
      const kept: Record<string, unknown> = {};
      if (cur.fonts !== undefined) kept.fonts = cur.fonts;
      if (cur.header !== undefined) kept.header = cur.header;
      if (cur.footer !== undefined) kept.footer = cur.footer;
      if (cur.toc !== undefined) kept.toc = cur.toc;
      if ('logo' in cur) kept.logo = cur.logo ?? null;
      if (cur.logo_position !== undefined) kept.logo_position = cur.logo_position;
      if (cur.logo_opacity !== undefined) kept.logo_opacity = cur.logo_opacity;
      const patched = patchFrontmatter(prev, {
        theme: id,
        theme_overrides: Object.keys(kept).length > 0 ? kept : null,
      });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, [setActiveThemeId, setContent, setIsDirty]);

  // Apply one inspector edit to the document's `theme_overrides`. Colours and
  // fonts merge key-by-key (a single tweak never rewrites the whole palette);
  // an `undefined` value clears that key. Writing straight to the frontmatter
  // keeps the editor's YAML and the inspector in lock-step.
  const handleThemeChange = useCallback((patch: ThemeOverridePatch) => {
    setContent((prev) => {
      const raw = extractFrontmatter(prev).frontmatter.theme_overrides;
      const cur: Record<string, unknown> =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {};
      for (const [key, value] of Object.entries(patch) as [keyof ThemeOverridePatch, unknown][]) {
        if (key === 'colors' || key === 'fonts') {
          const base = cur[key] && typeof cur[key] === 'object' ? cur[key] as Record<string, unknown> : {};
          const next: Record<string, unknown> = { ...base, ...(value as Record<string, unknown>) };
          for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
          if (Object.keys(next).length > 0) cur[key] = next; else delete cur[key];
        } else if (key === 'logo') {
          // A `logo` key in the patch is always deliberate: a path sets it,
          // anything else clears it (`null` = "hide the base theme's logo too").
          cur.logo = typeof value === 'string' && value ? value : null;
        } else if (value === undefined) {
          delete cur[key];
        } else {
          cur[key] = value;
        }
      }
      const patched = patchFrontmatter(prev, {
        theme_overrides: Object.keys(cur).length > 0 ? cur : null,
      });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, [setContent, setIsDirty]);

  const handleMetaChange = useCallback((field: 'title' | 'author' | 'date', value: string) => {
    setContent((prev) => {
      const patched = patchFrontmatter(prev, { [field]: value.trim() || null });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, [setContent, setIsDirty]);

  const handleAspectRatioCycle = useCallback(() => {
    setContent((prev) => {
      const { frontmatter: fm } = extractFrontmatter(prev);
      const current = fm.aspect_ratio as string | undefined;
      // 16:9 is the default, so cycling back to it removes the key.
      const nextAr = nextAspectRatio(current);
      const next = nextAr === '16:9' ? null : nextAr;
      const patched = patchFrontmatter(prev, { aspect_ratio: next });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, [setContent, setIsDirty]);

  // Cold-start load (kova --present / --check / --import / --export); the
  // auto-enter for --present lives in usePresentationSession.
  useColdLoad({ cold: coldStart, applyFileContent, applyCliTheme });

  // Keep the last-session record current so it's accurate whenever the app
  // actually quits (see useLastSessionRecord).
  useLastSessionRecord(filePath, safeSlideIndex, coldPresent);

  const handleImportComplete = useCallback(async (markdown: string, savedPath: string) => {
    setShowImport(false);
    await openImported(markdown, savedPath);
  }, [openImported]);

  const handleImportFromUrl = useCallback(async (text: string) => {
    setShowImportUrl(false);
    await openImported(text, '');
  }, [openImported]);

  const {
    exportPptx: handleExport,
    exportPdf: handleExportPdf,
    exportHtml: handleExportHtml,
    print: handlePrint,
    copyWithAssets: handleCopyWithAssets,
    runPdfExportCapture,
    runHtmlExportCapture,
  } = useExports({
    visibleSlides,
    frontmatter,
    activeTheme,
    aspectRatio,
    locale: settings.locale,
    filePath,
    contentRef,
    t,
    offscreen: { capturing, runCapture: runOffscreenCapture },
  });

  // Cold-start export (kova --export pptx|pdf|html FILE OUT): fires once the
  // deck loaded by useColdLoad has resolved.
  useColdExport({
    coldExport,
    filePath,
    mediaGate,
    visibleSlides,
    frontmatter,
    activeTheme,
    locale: settings.locale,
    pdfPageSize: settings.pdfPageSize,
    runPdfExportCapture,
    runHtmlExportCapture,
  });

  const {
    handleSlideReorder,
    handleDuplicateSlide,
    handleNewSlide,
    handleDeleteSlide,
    handleDeleteMultiple,
    handleReorderMultiple,
    handleToggleHidden,
    handleToggleTodo,
    handleSetSlideBackground,
    handleClearSlideBackground,
  } = useSlideEditing({
    setContent,
    setIsDirty,
    setCurrentSlideIndex,
    editorRef,
    slideCount: slides.length,
    filePath,
    onWarn: handleWarn,
    t,
  });

  const findReplace = useFindReplace({ editorRef, slideCount: slides.length, onSelectSlide: setCurrentSlideIndex });

  const handleSettingsChange = useCallback((s: AppSettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  useEffect(() => { setDiagramRenderer(settings.diagramRenderer); }, [settings.diagramRenderer]);

  // Apply UI theme class to root element; 'auto' follows the OS preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved: 'dark' | 'light' =
        settings.uiTheme === 'light' ? 'light' :
        settings.uiTheme === 'dark'  ? 'dark'  :
        mq.matches ? 'dark' : 'light';
      setResolvedUiTheme(resolved);
      document.documentElement.classList.toggle('theme-light', resolved === 'light');
    };
    apply();
    if (settings.uiTheme === 'auto') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [settings.uiTheme]);

  // Apply UI scale via the --ui-scale var (drives `html { zoom }` in global.css)
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  }, [settings.uiScale]);

  // Export menu items are enabled when there is something to export and no PDF
  // export is already running (Print additionally waits for a running print).
  const canExport = slides.length > 0 && capturing !== 'export';

  // ── Menu actions (native macOS menu bar + in-window FileMenu) ──────────────
  // Latest menu actions, refreshed every render. The native menu is rebuilt only
  // when `recents` changes, so its items delegate through this ref (below) to
  // always run current logic without rebuilding on every keystroke.
  const menuHandlersRef = useRef<MenuActions>({} as MenuActions);
  menuHandlersRef.current = {
    newFile: handleNewFile,
    openFile: handleOpenFile,
    openRecent: handleMarkdownDrop,
    clearRecent: doc.clearRecents,
    save: handleSave,
    saveAs: () => { void handleSaveAs(); },
    copyWithAssets: () => { void handleCopyWithAssets(); },
    import: () => guardDirty(() => setShowImport(true)),
    importUrl: () => guardDirty(() => setShowImportUrl(true)),
    importMarp: handleImportMarp,
    export: handleExport,
    exportPdf: () => { setPdfPerPage(1); setPdfNotesOn(false); setPdfOptionsOpen(true); },
    exportHtml: handleExportHtml,
    print: handlePrint,
    exit: () => guardDirty(actuallyCloseWindow),
    present: () => { void handlePresentEnter(); },
    toggleInspector: () => setShowInspector((v) => !v),
    openSettings: () => setShowSettings(true),
    installCli: () => {
      void (async () => {
        try {
          const dir = await invoke<string>('install_cli_symlink');
          await message(t('app.cliInstallSuccess', { dir }), { title: 'Kova' });
        } catch (e) {
          await message(t('app.cliInstallFailure', { command: String(e) }), {
            title: 'Kova',
            kind: 'error',
          });
        }
      })();
    },
  };
  const menuActions = useRef(delegateMenuActions(menuHandlersRef)).current;

  useEffect(() => {
    if (!isMac) return;
    void buildMacMenu(menuActions, recents, {
      present: t('macMenu.present'),
      view: t('macMenu.view'),
      toggleInspector: t('macMenu.toggleInspector'),
      installCli: t('macMenu.installCli'),
      file: t('app.menuFile'),
      edit: t('app.menuEdit'),
      newFile: t('app.menuNew'),
      open: t('app.menuOpen'),
      openRecent: t('app.menuOpenRecent'),
      noRecentFiles: t('app.menuNoRecentFiles'),
      clearMenu: t('app.menuClearMenu'),
      save: t('app.menuSave'),
      saveAs: t('app.menuSaveAs'),
      import: t('app.menuImport'),
      importFromPowerPoint: t('app.menuImportFromPowerPoint'),
      importFromUrl: t('app.menuImportFromUrl'),
      importFromMarp: t('app.menuImportFromMarp'),
      export: t('app.menuExport'),
      exportPowerpoint: t('app.menuExportPowerpoint'),
      exportPdf: t('app.menuExportPdf'),
      exportHtml: t('app.menuExportHtml'),
      print: t('app.menuPrint'),
    });
  }, [recents, menuActions, t]);

  useEffect(() => {
    const sc = (id: string) => getCombo(keybindings.combos, id);
    const handler = (e: KeyboardEvent) => {
      if (presentMode || presenterMode) return;
      // Default keybindings all require a modifier, but keybindings.combos is
      // loaded from a user-editable file with no enforcement that a binding
      // include one — a bare-key rebind must not fire while the user is
      // typing into an input (mirrors the same guard in PresentationOverlay/
      // PresenterOverlay).
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'F5') { e.preventDefault(); void handlePresentEnter(e.shiftKey); return; }
      if (matchShortcut(e, sc('newFile')))   { e.preventDefault(); handleNewFile(); }
      if (matchShortcut(e, sc('openFile')))  { e.preventDefault(); handleOpenFile(); }
      if (matchShortcut(e, sc('save')))      { e.preventDefault(); if (filePath) handleSave(); else handleSaveAs(); }
      if (matchShortcut(e, sc('saveAs')))    { e.preventDefault(); handleSaveAs(); }
      if (matchShortcut(e, sc('focusMode'))) { e.preventDefault(); toggleFocusMode(); }
      if (matchShortcut(e, sc('hideSlide')) && slides.length > 0) {
        e.preventDefault();
        handleToggleHidden(safeSlideIndex);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [presentMode, presenterMode, keybindings.combos, filePath, slides.length, safeSlideIndex, handleNewFile, handleOpenFile, handleSave, handleSaveAs, toggleFocusMode, handlePresentEnter, handleToggleHidden]);



  const presentationOverlays = (
    <>
      {presentMode && (
        <PresentationOverlay
          slides={visibleSlides}
          currentIndex={safePresentIndex}
          currentStep={safePresentStep}
          laserColor={settings.laserColor}
          showTimer={settings.presenterShowTimer}
          countdownMinutes={settings.presenterCountdownMinutes}
          showProgressBar={settings.presentationShowProgressBar}
          onNavigate={handlePresentNavigate}
          onExit={handlePresentExit}
        />
      )}
      {presenterMode && (
        <PresenterOverlay
          slides={visibleSlides}
          currentIndex={safePresentIndex}
          currentStep={safePresentStep}
          showNextSlide={settings.presenterShowNextSlide}
          showTimer={settings.presenterShowTimer}
          countdownMinutes={settings.presenterCountdownMinutes}
          notesFontSize={settings.presenterNotesFontSize}
          laserColor={settings.laserColor}
          onNavigate={handlePresentNavigate}
          onExit={handlePresentExit}
        />
      )}
    </>
  );

  // Cold-start present (kova --present FILE): the editor chrome never mounts.
  // Before presentation starts this renders a minimal loading surface (only
  // visible for the instant between the window being shown and the overlay
  // mounting); during presentation it renders just the overlays, so nothing
  // editor-shaped can flash behind them or during exit.
  if (coldPresent) {
    return (
      <I18nProvider locale={settings.locale}>
        <DeckProvider value={deck}>
        <div className="app">
          {presentationOverlays}
          {!presentMode && !presenterMode && (
            <div style={{
              height: '100vh',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ opacity: 0.6, fontSize: 14 }}>{t('app.presentLoading')}</span>
            </div>
          )}
        </div>
        </DeckProvider>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider locale={settings.locale}>
    <DeckProvider value={deck}>
    <div className="app">
      {doc.fileDragOver && !presentMode && !presenterMode && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 5000, pointerEvents: 'none',
          border: '2px dashed #D94F00', borderRadius: 4,
          background: 'rgba(217,79,0,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#D94F00', fontSize: 14, fontWeight: 500 }}>{t('app.dropToOpen')}</span>
        </div>
      )}
      {presentationOverlays}
      <Toolbar
        menus={!isMac && (
          <>
            <FileMenu
              actions={menuActions}
              recents={recents}
              filePath={filePath}
              isDirty={isDirty}
              hasContent={!!content}
              canExport={canExport}
              pdfExporting={capturing === 'export'}
              printing={capturing === 'print'}
              combos={keybindings.combos}
            />
            <EditMenu editorRef={editorRef} onFind={findReplace.openDialog} />
          </>
        )}
        windowControls={!isMac && <WindowControls onClose={menuActions.exit} />}
        filePath={filePath}
        isDirty={isDirty}
        isRenaming={doc.isRenaming}
        renameValue={doc.renameValue}
        onRenameStart={doc.startRename}
        onRenameChange={doc.setRenameValue}
        onRenameCommit={doc.handleRenameCommit}
        onRenameCancel={doc.cancelRename}
        canPresent={slides.length > 0}
        onPresent={handlePresentEnter}
        focusMode={focusMode}
        focusModeCombo={getCombo(keybindings.combos, 'focusMode')}
        onToggleFocusMode={toggleFocusMode}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector((v) => !v)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="app-panels">
        <PanelGroup
          orientation="horizontal"
          style={{ height: '100%' }}
          id="kova-main"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel id="thumb" panelRef={thumbPanelRef} defaultSize={22} minSize={8} collapsible>
            <ThumbnailPanel
              slides={slides}
              currentIndex={safeSlideIndex}
              onSelect={handleThumbnailSelect}
              onReorder={handleSlideReorder}
              onDuplicate={handleDuplicateSlide}
              onNewSlide={handleNewSlide}
              onToggleHidden={handleToggleHidden}
              onToggleTodo={handleToggleTodo}
              onSetBackground={handleSetSlideBackground}
              onClearBackground={handleClearSlideBackground}
              onDelete={handleDeleteSlide}
              onDeleteMultiple={handleDeleteMultiple}
              onReorderMultiple={handleReorderMultiple}
            />
          </Panel>

          <PanelResizeHandle />

          <Panel id="editor" defaultSize={64} minSize={20}>
            <EditorPanel
              ref={editorRef}
              content={editorContent}
              onChange={handleContentChange}
              onCursorSlide={setCurrentSlideIndex}
              onWarn={handleWarn}
              onSaveAs={handleSaveAs}
              onRequestFind={findReplace.openDialog}
              focusMode={focusMode}
              filePath={filePath}
              uiTheme={resolvedUiTheme}
              editorFontFamily={EDITOR_FONT_OPTIONS.find(o => o.value === settings.editorFont)?.family}
              wordWrap={settings.editorWordWrap}
              contentWidth={settings.editorContentWidth}
              spellCheckEnabled={settings.spellCheckEnabled}
              spellCheckLanguage={settings.spellCheckLanguage}
            />
          </Panel>

          {showInspector && <PanelResizeHandle />}

          {showInspector && (
            <Panel id="inspector" panelRef={inspectorPanelRef} defaultSize={14} minSize={8} collapsible>
              <InspectorPanel
                filePath={filePath}
                slideCount={slides.length}
                frontmatter={frontmatter}
                theme={activeTheme}
                baseTheme={baseTheme}
                themeOverrides={themeOverrides}
                allThemes={allThemes}
                onThemeSelect={handleThemeSelect}
                onThemeChange={handleThemeChange}
                onMetaChange={handleMetaChange}
                onFormat={handleFormat}
                onOpenLibrary={() => setShowThemeLibrary(true)}
              />
            </Panel>
          )}
        </PanelGroup>
      </div>

      <StatusBar
        currentSlide={safeSlideIndex + 1}
        totalSlides={slides.length}
        layoutName={slides[safeSlideIndex]?.layout}
        layoutOverridden={slides[safeSlideIndex]?.layoutOverride !== undefined}
        wordCount={wordCount}
        isDirty={isDirty}
        filePath={filePath}
        externalImageCount={externalImageCount}
        aspectRatioLabel={`${aspectRatio.w}:${aspectRatio.h}`}
        onAspectRatioCycle={handleAspectRatioCycle}
        availableUpdate={availableUpdate}
        onVersionClick={availableUpdate ? () => { setShowSettings(true); setSettingsScrollToUpdates(true); } : undefined}
        locale={settings.locale}
      />

      <FindReplaceDialog findReplace={findReplace} />

      {showSettings && (
        <SettingsModal
          settings={settings}
          availableUpdate={availableUpdate}
          allThemes={allThemes}
          isDirty={isDirty}
          scrollToUpdates={settingsScrollToUpdates}
          onChange={handleSettingsChange}
          onUpdateChecked={setAvailableUpdate}
          onClose={() => { setShowSettings(false); setSettingsScrollToUpdates(false); }}
        />
      )}

      {showThemeLibrary && (
        <ThemeLibraryModal
          installedIds={installedRemoteIds}
          onThemesChanged={reloadCustomThemes}
          onClose={() => setShowThemeLibrary(false)}
        />
      )}

      {showImport && (
        <ImportPptxModal
          onImported={handleImportComplete}
          onClose={() => setShowImport(false)}
        />
      )}

      {showImportUrl && (
        <ImportUrlModal
          onImported={handleImportFromUrl}
          onClose={() => setShowImportUrl(false)}
        />
      )}

      <AppDialogs
        marpPromptOpen={doc.marpPromptOpen}
        onMarpConvert={doc.convertMarp}
        onMarpDismiss={doc.dismissMarpPrompt}
        marpLoss={doc.marpLoss}
        onMarpLossDismiss={doc.dismissMarpLoss}
        missingThemeId={missingThemeId}
        onMissingThemeInstalled={handleMissingThemeInstalled}
        onMissingThemeDismiss={() => setMissingThemeId(null)}
        showWhatsNew={showWhatsNew}
        onWhatsNewOpen={() => {
          // /releases/latest always redirects to the newest published release —
          // more robust than building a /releases/tag/vX.Y.Z URL from APP_VERSION,
          // which would 404 if the two ever drift (e.g. a local dev build).
          openUrl('https://github.com/KovaMD/Kova/releases/latest').catch(() => {});
          setShowWhatsNew(false);
        }}
        onWhatsNewDismiss={() => setShowWhatsNew(false)}
        warnMessage={warnMessage}
        externalChangeOpen={doc.externalChangeOpen}
        onExternalChangeClose={doc.closeExternalChange}
        onExternalChangeReload={doc.reloadExternalChange}
        onExternalChangeSaveAs={doc.saveAsExternalChange}
        externalReloadBannerOpen={doc.externalReloadBannerOpen}
        onExternalReloadBannerDismiss={doc.dismissExternalReloadBanner}
        pdfOptionsOpen={pdfOptionsOpen}
        pdfPerPage={pdfPerPage}
        pdfNotesOn={pdfNotesOn}
        pdfHasNotes={pdfOptionsOpen && visibleSlides.some((s) => s.speakerNotes.trim())}
        onPdfPerPageChange={(n) => { setPdfPerPage(n); if (n !== 1) setPdfNotesOn(false); }}
        onPdfNotesChange={setPdfNotesOn}
        onPdfOptionsClose={() => setPdfOptionsOpen(false)}
        onPdfExport={() => {
          setPdfOptionsOpen(false);
          const notes = pdfPerPage === 1 && pdfNotesOn ? visibleSlides.map((s) => s.speakerNotes) : undefined;
          void handleExportPdf({ perPage: pdfPerPage, notes, paper: settings.pdfPageSize });
        }}
        confirmCloseOpen={doc.confirmCloseOpen}
        onConfirmCloseCancel={doc.cancelConfirmClose}
        onConfirmCloseDiscard={doc.discardAndContinue}
        onConfirmCloseSave={doc.saveAndContinue}
        dropConfirmPath={doc.dropConfirmPath}
        onDropConfirmCancel={doc.cancelDropConfirm}
        onDropConfirmOpen={doc.confirmDropOpen}
      />

      {/* Off-screen slide rendering for PDF/HTML export and Print */}
      {offscreenContext && (
        <OffscreenDeck
          slides={offscreenContext.slides}
          setSlideRef={setOffscreenSlideRef}
          onSlideReady={onOffscreenSlideReady}
        />
      )}
    </div>
    </DeckProvider>
    </I18nProvider>
  );
}
