import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef, useDefaultLayout } from 'react-resizable-panels';

import { ThumbnailPanel } from './components/layout/ThumbnailPanel';
import { EditorPanel } from './components/layout/EditorPanel';
import type { EditorHandle, FormatCmd } from './components/layout/EditorPanel';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { StatusBar } from './components/layout/StatusBar';
import { PresentationOverlay } from './components/presentation/PresentationOverlay';
import { PresenterOverlay } from './components/presentation/PresenterOverlay';
import type { PresentInitPayload } from './AudienceApp';
import { SettingsModal } from './components/SettingsModal';
import { ThemeLibraryModal } from './components/inspector/ThemeLibraryModal';
import { loadSettings, saveSettings, EDITOR_FONT_OPTIONS } from './store/settings';
import type { AppSettings } from './store/settings';
import { loadKeybindings, matchShortcut, getCombo, formatCombo } from './engine/keybindings';
import type { Keybindings } from './engine/keybindings';

import { parseDocument } from './engine/parser/markdownToSlides';
import { extractFrontmatter, patchFrontmatter } from './engine/parser/frontmatter';
import { fetchUpdate } from './engine/updater';
import { exportToPptx } from './engine/export/exportPptx';
import { BUILT_IN_THEMES, DEFAULT_THEME, parseThemeYaml } from './engine/theme';
import type { Slide, Frontmatter, ListItem } from './engine/types';
import { parseAspectRatio } from './engine/types';
import type { Theme } from './engine/theme';

import './styles/global.css';

const isMac = /Mac/i.test(navigator.platform);

function resolveImageSrc(src: string, docDir: string): string {
  if (/^(https?|data|asset|tauri):\/\//i.test(src)) return src;
  // Decode any percent-encoding written by the editor (e.g. %20 for spaces).
  let p = src;
  try { p = decodeURIComponent(src); } catch { /* malformed — use as-is */ }
  // Already absolute — convert directly, no docDir needed.
  if (p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p)) return convertFileSrc(p);
  // Relative path — only resolvable when we know the document location.
  if (!docDir) return p;
  const sep = docDir.includes('\\') ? '\\' : '/';
  return convertFileSrc(docDir + (docDir.endsWith(sep) ? '' : sep) + p);
}

function resolveHtmlSrcs(html: string, docDir: string): string {
  return html.replace(/src="([^"]*)"/g, (_, src) => `src="${resolveImageSrc(src, docDir)}"`);
}

function makeStarter() {
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

function countWords(text: string): number {
  return (text.match(/\b\w+\b/g) ?? []).length;
}

const EMPTY_SLIDES: Slide[] = [];
const EMPTY_FM: Frontmatter = {};

export default function App() {
  const [filePath, setFilePath]           = useState<string | null>(null);
  const [content, setContent]             = useState('');
  const [isDirty, setIsDirty]             = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [focusMode, setFocusMode]         = useState(false);
  const [presentMode, setPresentMode]     = useState(false);
  const [settings, setSettings]           = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings]   = useState(false);
  const [showThemeLibrary, setShowThemeMarketplace] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [presenterMode, setPresenterMode] = useState(false);
  const [confirmCloseAction, setConfirmCloseAction] = useState<(() => void) | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null);
  const [keybindings, setKeybindings]     = useState<Keybindings>({ path: '', combos: {} });
  const [warnMessage, setWarnMessage]     = useState<string | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resolvedUiTheme, setResolvedUiTheme] = useState<'dark' | 'light'>('dark');

  // Theme state: active theme id + per-session overrides
  const [allThemes, setAllThemes]         = useState<Theme[]>(BUILT_IN_THEMES);
  const [activeThemeId, setActiveThemeId] = useState<string>(DEFAULT_THEME.id);
  const [themeOverrides, setThemeOverrides] = useState<Partial<Theme>>({});
  const [themesDir, setThemesDir]         = useState<string>('');
  const [themeLoadErrors, setThemeLoadErrors] = useState<string[]>([]);

  const installedRemoteIds = useMemo(
    () => new Set(allThemes.filter((t) => !BUILT_IN_THEMES.some((b) => b.id === t.id)).map((t) => t.id)),
    [allThemes],
  );

  // Resolved theme = base theme merged with overrides
  const activeTheme = useMemo<Theme>(() => {
    const base = allThemes.find((t) => t.id === activeThemeId) ?? DEFAULT_THEME;
    return { ...base, ...themeOverrides,
      colors: { ...base.colors, ...(themeOverrides.colors ?? {}) },
      fonts:  { ...base.fonts,  ...(themeOverrides.fonts  ?? {}) },
      header: { ...base.header, ...(themeOverrides.header ?? {}) },
      footer: { ...base.footer, ...(themeOverrides.footer ?? {}) },
    };
  }, [allThemes, activeThemeId, themeOverrides]);

  // Persist panel layout across sessions and inspector toggle/hide
  const PANEL_IDS = ['thumb', 'editor', 'inspector'] as const;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'kova-main',
    panelIds: [...PANEL_IDS],
  });

  // Panel refs for Focus Mode collapse
  const thumbPanelRef     = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const editorRef         = useRef<EditorHandle>(null);

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

  // Rewrite relative image srcs to asset:// URLs so Tauri's WebView can load them.
  // Always runs — absolute paths need convertFileSrc even when no file is open.
  const slides = useMemo<Slide[]>(() => {
    const lastSlash = filePath
      ? Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
      : -1;
    const docDir = lastSlash >= 0 ? filePath!.substring(0, lastSlash) : '';

    function resolveItem(item: ListItem): ListItem {
      return { ...item, html: resolveHtmlSrcs(item.html, docDir), children: item.children.map(resolveItem) };
    }

    return rawSlides.map((slide) => ({
      ...slide,
      elements: slide.elements.map((el) => {
        if (el.type === 'image')     return { ...el, src: resolveImageSrc(el.src, docDir) };
        if (el.type === 'paragraph') return { ...el, html: resolveHtmlSrcs(el.html, docDir) };
        if (el.type === 'list')      return { ...el, items: el.items.map(resolveItem) };
        return el;
      }),
    }));
  }, [rawSlides, filePath]);

  // Compute a safe index in the same render as slides so children never receive
  // an out-of-bounds value during the frame before the clamp useEffect fires.
  const safeSlideIndex = slides.length > 0
    ? Math.min(currentSlideIndex, slides.length - 1)
    : 0;

  const aspectRatio = useMemo(
    () => parseAspectRatio(frontmatter.aspect_ratio as string | undefined),
    [frontmatter.aspect_ratio],
  );

  const wordCount = countWords(content);

  // Count image references that live outside the document's own folder.
  // These display fine locally but break if the .md file is moved without its images.
  const externalImageCount = useMemo(() => {
    if (!filePath) return 0;
    const sep = filePath.includes('\\') ? '\\' : '/';
    const docDir = filePath.substring(0, filePath.lastIndexOf(sep));
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
    return count;
  }, [content, filePath]);
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  const reloadCustomThemes = useCallback(() => {
    invoke<[string, Array<[string, string]>]>('load_custom_themes')
      .then(([dir, entries]) => {
        setThemesDir(dir);
        const errors: string[] = [];
        const custom = entries
          .map(([id, yaml]) => {
            const t = parseThemeYaml(id, yaml);
            if (!t) errors.push(id);
            return t;
          })
          .filter((t): t is Theme => t !== null);
        setThemeLoadErrors(errors);
        setAllThemes(custom.length > 0 ? [...BUILT_IN_THEMES, ...custom] : BUILT_IN_THEMES);
      })
      .catch(() => {});
  }, []);

  // Load custom themes from ~/.kova/themes/ on startup
  useEffect(() => { reloadCustomThemes(); }, [reloadCustomThemes]);

  // Load keybindings from ~/.kova/keybindings.yaml on startup
  useEffect(() => {
    loadKeybindings().then(setKeybindings).catch(() => {});
  }, []);

  // Startup update check (only when opt-in setting is enabled)
  useEffect(() => {
    if (!settings.checkForUpdates) return;
    fetchUpdate()
      .then((update) => { if (update) setAvailableUpdate(update.version); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // Window title
  useEffect(() => {
    const name = frontmatter.title ?? filePath?.split('/').pop() ?? 'Kova';
    getCurrentWindow().setTitle(isDirty ? `${name} • — Kova` : `${name} — Kova`).catch(() => {});
  }, [filePath, frontmatter.title, isDirty]);

  // File-changed event from Rust watcher → reload
  useEffect(() => {
    const unlisten = listen<void>('file-changed', async () => {
      const path = filePathRef.current;
      if (!path) return;
      try {
        const newContent: string = await invoke('read_file', { path });
        setContent(newContent);
        setIsDirty(false);
      } catch (err) {
        console.error('Failed to reload file:', err);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

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

  const guardDirty = useCallback((action: () => void) => {
    if (isDirty && settings.confirmOnClose) {
      setConfirmCloseAction(() => action);
    } else {
      action();
    }
  }, [isDirty, settings.confirmOnClose]);

  const handleNewFile = useCallback(() => {
    guardDirty(async () => {
      await invoke('stop_watching').catch(() => {});
      setFilePath(null);
      setContent(makeStarter());
      setIsDirty(false);
      setCurrentSlideIndex(0);
      setActiveThemeId(DEFAULT_THEME.id);
      setThemeOverrides({});
    });
  }, [guardDirty]);

  const handlePresentEnter = useCallback(async (e?: React.MouseEvent) => {
    if (slides.length === 0) return;
    const startIndex = e?.altKey ? safeSlideIndex : 0;
    if (!e?.altKey) setCurrentSlideIndex(0);

    // Resolve 'auto': detect monitors first, then pick mode.
    // Use currentMonitor() (not primaryMonitor()) to find the monitor Kova is
    // running on — on Wayland, primaryMonitor() returns null for both monitors
    // because "primary" is an X11 concept the compositor doesn't expose.
    let all: Awaited<ReturnType<typeof availableMonitors>> = [];
    let currentMon: Awaited<ReturnType<typeof currentMonitor>> = null;
    try {
      [all, currentMon] = await Promise.all([availableMonitors(), currentMonitor()]);
    } catch { /* ignore */ }
    const external = all.length > 1
      ? (all.find((m) => m.name !== currentMon?.name) ?? all[all.length - 1])
      : null;

    const rawMode = settings.presentationMode;
    const mode: Exclude<typeof rawMode, 'auto'> =
      rawMode === 'auto' ? (external ? 'dual' : 'single') : rawMode;

    if (mode === 'dual' || mode === 'mirror') {

      if (external) {
        const initPayload: PresentInitPayload = {
          slides,
          theme: activeTheme,
          index: startIndex,
          aspectRatio,
          docTitle: frontmatter.title,
          slideTransition: settings.slideTransition,
        };

        // Register ready listener BEFORE creating the window to avoid missing the event
        const unlistenReady = await listen('present:ready', async () => {
          unlistenReady();
          await emitTo('audience', 'present:init', initPayload);

          // Drive positioning + fullscreen via Rust — the 250 ms blocking sleep
          // on the Rust side is more reliable than JS setTimeout for convincing
          // the X11 WM to process XMoveWindow before _NET_WM_STATE_FULLSCREEN.
          const logX = external.position.x / external.scaleFactor;
          const logY = external.position.y / external.scaleFactor;
          await invoke('setup_audience_window', { x: logX, y: logY }).catch(() => {});
          // Reclaim focus on the presenter window — the audience window creation
          // may steal it even with focus:false, depending on the compositor.
          await getCurrentWindow().setFocus().catch(() => {});
        });

        new WebviewWindow('audience', {
          url: '/#audience',
          x: external.position.x / external.scaleFactor,
          y: external.position.y / external.scaleFactor,
          width: external.size.width / external.scaleFactor,
          height: external.size.height / external.scaleFactor,
          // No fullscreen:true — on Linux that ignores x/y and captures the primary monitor.
          // Fullscreen is applied via setup_audience_window after present:ready fires.
          decorations: false,
          title: 'Kova — Presentation',
          resizable: false,
          focus: false,
        });

        if (mode === 'dual') {
          setPresenterMode(true);
          await getCurrentWindow().setFullscreen(true).catch(() => {});
          return;
        }
        // Mirror: audience window shows slide, main window also fullscreens with normal overlay
      }
      // Fall through to single if no external monitor
    }

    setPresentMode(true);
    await getCurrentWindow().setFullscreen(true).catch(() => {});
  }, [slides, safeSlideIndex, activeTheme, aspectRatio, frontmatter.title, settings.presentationMode]);

  const handlePresentExit = useCallback(async () => {
    // Close audience window if open
    await emit('present:exit', null).catch(() => {});
    setPresentMode(false);
    setPresenterMode(false);
    await getCurrentWindow().setFullscreen(false).catch(() => {});
  }, []);

  // When the audience window has OS focus (common on Wayland where compositors
  // ignore focus:false), forward its keydown events so arrow-key navigation
  // works in the presenter without requiring a manual click.
  useEffect(() => {
    if (!presentMode && !presenterMode) return;
    const unlisten = listen<{ key: string }>('audience:key', (e) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: e.payload.key, bubbles: true, cancelable: true }));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [presentMode, presenterMode]);

  // Mirror mode: keep the audience window in sync with the presenter's slide.
  // Dual mode sync is handled by PresenterOverlay; this covers mirror mode where
  // PresentationOverlay drives navigation but never emits present:navigate.
  useEffect(() => {
    if (!presentMode) return;
    emitTo('audience', 'present:navigate', { index: safeSlideIndex }).catch(() => {});
  }, [presentMode, safeSlideIndex]);

  const handleThemeSelect = useCallback((id: string) => {
    setActiveThemeId(id);
    setThemeOverrides({});
    setContent((prev) => {
      const patched = patchFrontmatter(prev, { theme: id, theme_overrides: null });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, []);

  const handleThemeChange = useCallback((patch: Partial<Theme>) => {
    setThemeOverrides((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleOpenFile = useCallback(() => {
    guardDirty(async () => { try {
      const selected = await open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      const text: string = await invoke('read_file', { path: selected });
      const { frontmatter: fm } = extractFrontmatter(text);
      if (typeof fm.theme === 'string') {
        const found = allThemes.find((t) => t.id === fm.theme);
        if (found) {
          setActiveThemeId(found.id);
          const overrides = fm.theme_overrides ?? {};
          setThemeOverrides({
            ...(overrides.colors ? { colors: overrides.colors as never } : {}),
            ...(overrides.fonts  ? { fonts:  overrides.fonts  as never } : {}),
          });
        } else {
          setThemeOverrides({});
        }
      } else {
        setActiveThemeId(DEFAULT_THEME.id);
        setThemeOverrides({});
      }
      setFilePath(selected);
      setContent(text);
      setIsDirty(false);
      setCurrentSlideIndex(0);
      await invoke('start_watching', { path: selected }).catch(console.error);
    } catch (err) { console.error('Open failed:', err); }});
  }, [guardDirty, allThemes]);

  const buildSaveContent = useCallback(() => {
    const overridePatch: Record<string, unknown> = {};
    if (themeOverrides.colors && Object.keys(themeOverrides.colors).length > 0)
      overridePatch.colors = themeOverrides.colors;
    if (themeOverrides.fonts && Object.keys(themeOverrides.fonts).length > 0)
      overridePatch.fonts = themeOverrides.fonts;
    const hasOverrides = Object.keys(overridePatch).length > 0;
    return hasOverrides
      ? patchFrontmatter(content, { theme_overrides: overridePatch })
      : patchFrontmatter(content, { theme_overrides: null });
  }, [content, themeOverrides]);

  const handleSave = useCallback(async () => {
    if (!filePath) return;
    try {
      const toWrite = buildSaveContent();
      await invoke('write_file', { path: filePath, content: toWrite });
      if (toWrite !== content) setContent(toWrite);
      setIsDirty(false);
    } catch (err) { console.error('Save failed:', err); }
  }, [filePath, content, buildSaveContent]);

  const handleSaveAs = useCallback(async (): Promise<string | null> => {
    try {
      const target = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: filePath ?? undefined,
      });
      if (!target) return null;
      const toWrite = buildSaveContent();
      await invoke('write_file', { path: target, content: toWrite });
      if (toWrite !== content) setContent(toWrite);
      setFilePath(target);
      setIsDirty(false);
      await invoke('start_watching', { path: target }).catch(console.error);
      return target;
    } catch (err) { console.error('Save As failed:', err); return null; }
  }, [filePath, content, buildSaveContent]);

  const handleExport = useCallback(async () => {
    if (slides.length === 0) return;
    try {
      const { base64, warnings } = await exportToPptx(slides, frontmatter, activeTheme);
      const defaultPath = filePath
        ? filePath.replace(/\.(md|markdown)$/i, '.pptx')
        : 'presentation.pptx';
      const target = await save({
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
        defaultPath,
      });
      if (!target) return;
      const savePath = target.toLowerCase().endsWith('.pptx') ? target : `${target}.pptx`;
      await invoke('write_file_bytes', { path: savePath, data: base64 });
      if (warnings.length > 0) {
        window.alert(`Export complete with ${warnings.length} warning(s):\n\n${warnings.join('\n')}`);
      }
    } catch (err) { console.error('Export failed:', err); }
  }, [slides, frontmatter, activeTheme, filePath]);

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    setIsDirty(true);
  }, []);

  const handleWarn = useCallback((msg: string) => {
    setWarnMessage(msg);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setWarnMessage(null), 6000);
  }, []);

  const handleSettingsChange = useCallback((s: AppSettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

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

  // Autosave — only when enabled, a file path exists, and there are unsaved changes
  useEffect(() => {
    if (!settings.autosave || !filePath || !isDirty) return;
    const id = setInterval(handleSave, settings.autosaveIntervalSeconds * 1000);
    return () => clearInterval(id);
  }, [settings.autosave, settings.autosaveIntervalSeconds, filePath, isDirty, handleSave]);

  useEffect(() => {
    const sc = (id: string) => getCombo(keybindings.combos, id);
    const handler = (e: KeyboardEvent) => {
      if (presentMode) return;
      if (matchShortcut(e, sc('newFile')))   { e.preventDefault(); handleNewFile(); }
      if (matchShortcut(e, sc('openFile')))  { e.preventDefault(); handleOpenFile(); }
      if (matchShortcut(e, sc('save')))      { e.preventDefault(); if (filePath) handleSave(); else handleSaveAs(); }
      if (matchShortcut(e, sc('saveAs')))    { e.preventDefault(); handleSaveAs(); }
      if (matchShortcut(e, sc('focusMode'))) { e.preventDefault(); toggleFocusMode(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [presentMode, keybindings.combos, filePath, handleNewFile, handleOpenFile, handleSave, handleSaveAs, toggleFocusMode]);

  return (
    <div className="app">
      {presentMode && (
        <PresentationOverlay
          slides={slides}
          currentIndex={safeSlideIndex}
          theme={activeTheme}
          docTitle={frontmatter.title}
          aspectRatio={aspectRatio}
          slideTransition={settings.slideTransition}
          onNavigate={setCurrentSlideIndex}
          onExit={handlePresentExit}
        />
      )}
      {presenterMode && (
        <PresenterOverlay
          slides={slides}
          currentIndex={safeSlideIndex}
          theme={activeTheme}
          docTitle={frontmatter.title}
          aspectRatio={aspectRatio}
          showNextSlide={settings.presenterShowNextSlide}
          showTimer={settings.presenterShowTimer}
          notesFontSize={settings.presenterNotesFontSize}
          onNavigate={setCurrentSlideIndex}
          onExit={handlePresentExit}
        />
      )}
      <div className="app-toolbar">
        {isMac && (
          <div className="wm-controls wm-controls--mac">
            <button
              className="wm-btn wm-btn--close"
              onMouseDown={(e) => { e.preventDefault(); guardDirty(() => getCurrentWindow().close()); }}
              title="Close"
            >
              <svg width="11" height="11" viewBox="0 0 11 11">
                <line x1="1" y1="1" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="10" y1="1" x2="1" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              className="wm-btn"
              onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().minimize(); }}
              title="Minimise"
            >
              <svg width="12" height="2" viewBox="0 0 12 2"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
            </button>
            <button
              className="wm-btn"
              onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().toggleMaximize(); }}
              title="Maximise / Restore"
            >
              <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
          </div>
        )}
        <button className="btn" onClick={handleNewFile} title={`New (${formatCombo(getCombo(keybindings.combos, 'newFile'))})`}>New</button>
        <button className="btn" onClick={handleOpenFile} title={`Open (${formatCombo(getCombo(keybindings.combos, 'openFile'))})`}>Open</button>
        <button className="btn" onClick={handleSave} disabled={!filePath || !isDirty} title={`Save (${formatCombo(getCombo(keybindings.combos, 'save'))})`}>Save</button>
        <button className="btn" onClick={handleSaveAs} disabled={!content} title={`Save As (${formatCombo(getCombo(keybindings.combos, 'saveAs'))})`}>Save As</button>
        <div className="toolbar-spacer" data-tauri-drag-region />
        <div className="toolbar-doctitle" data-tauri-drag-region>
          {filePath ? filePath.split('/').pop() : 'Untitled.md'}{isDirty ? ' *' : ''}
        </div>
        <button
          className="btn btn-primary"
          onClick={handlePresentEnter}
          disabled={slides.length === 0}
          title="Present from slide 1 (Alt+click to start from current slide)"
        >▶ Present</button>
        <button
          className={`wm-btn${showInspector ? ' wm-btn--active' : ''}`}
          onClick={() => setShowInspector((v) => !v)}
          title="Toggle inspector"
          style={{ marginLeft: 4 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="8" strokeWidth="2"/>
            <line x1="12" y1="12" x2="12" y2="16"/>
          </svg>
        </button>
        <button
          className="wm-btn"
          onClick={() => setShowSettings(true)}
          title={availableUpdate ? `Settings (update ${availableUpdate} available)` : 'Settings'}
          style={{ position: 'relative' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          {availableUpdate && (
            <span style={{
              position: 'absolute', top: 3, right: 3,
              width: 6, height: 6, borderRadius: '50%',
              background: '#D94F00', pointerEvents: 'none',
            }} />
          )}
        </button>
        {!isMac && (
          <div className="wm-controls">
            <button
              className="wm-btn"
              onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().minimize(); }}
              title="Minimise"
            >
              <svg width="12" height="2" viewBox="0 0 12 2"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
            </button>
            <button
              className="wm-btn"
              onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().toggleMaximize(); }}
              title="Maximise / Restore"
            >
              <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
            <button
              className="wm-btn wm-btn--close"
              onMouseDown={(e) => {
                e.preventDefault();
                guardDirty(() => getCurrentWindow().close());
              }}
              title="Close"
            >
              <svg width="11" height="11" viewBox="0 0 11 11">
                <line x1="1" y1="1" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="10" y1="1" x2="1" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="app-panels">
        <PanelGroup
          orientation="horizontal"
          style={{ height: '100%' }}
          id="kova-main"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel id="thumb" panelRef={thumbPanelRef} defaultSize={14} minSize={8} collapsible>
            <ThumbnailPanel
              slides={slides}
              currentIndex={safeSlideIndex}
              onSelect={handleThumbnailSelect}
              theme={activeTheme}
              docTitle={frontmatter.title}
              aspectRatio={aspectRatio}
            />
          </Panel>

          <PanelResizeHandle />

          <Panel id="editor" defaultSize={72} minSize={20}>
            <EditorPanel
              ref={editorRef}
              content={content}
              onChange={handleContentChange}
              onCursorSlide={setCurrentSlideIndex}
              onWarn={handleWarn}
              onSaveAs={handleSaveAs}
              focusMode={focusMode}
              filePath={filePath}
              uiTheme={resolvedUiTheme}
              editorFontFamily={EDITOR_FONT_OPTIONS.find(o => o.value === settings.editorFont)?.family}
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
                allThemes={allThemes}
                onThemeSelect={handleThemeSelect}
                onThemeChange={handleThemeChange}
                onFormat={handleFormat}
                onExport={handleExport}
                onOpenLibrary={() => setShowThemeMarketplace(true)}
              />
            </Panel>
          )}
        </PanelGroup>
      </div>

      <StatusBar
        currentSlide={safeSlideIndex + 1}
        totalSlides={slides.length}
        wordCount={wordCount}
        isDirty={isDirty}
        filePath={filePath}
        externalImageCount={externalImageCount}
      />

      {showSettings && (
        <SettingsModal
          settings={settings}
          keybindingsPath={keybindings.path}
          themesDir={themesDir}
          themeLoadErrors={themeLoadErrors}
          availableUpdate={availableUpdate}
          onChange={handleSettingsChange}
          onUpdateChecked={setAvailableUpdate}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showThemeLibrary && (
        <ThemeLibraryModal
          installedIds={installedRemoteIds}
          onThemesChanged={reloadCustomThemes}
          onClose={() => setShowThemeMarketplace(false)}
        />
      )}

      {warnMessage && (
        <div style={{
          position: 'fixed', bottom: 36, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-elevated)', border: '1px solid var(--dirty-color)',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 3000,
          padding: '10px 16px', fontSize: 12, color: 'var(--dirty-color)',
          maxWidth: 480, textAlign: 'center', pointerEvents: 'none',
        }}>
          {warnMessage}
        </div>
      )}

      {confirmCloseAction && (
        <>
          <div
            onClick={() => setConfirmCloseAction(null)}
            style={{ position: 'fixed', inset: 0, background: 'var(--backdrop)', zIndex: 2000 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 16px 48px rgba(0,0,0,0.6)', zIndex: 2001,
            padding: '24px 28px', width: 320, maxWidth: '90vw',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              Unsaved changes
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              You have unsaved changes. Close anyway?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmCloseAction(null)}>Cancel</button>
              <button
                className="btn"
                style={{ background: '#c0392b', borderColor: '#c0392b', color: '#fff' }}
                onClick={() => { const a = confirmCloseAction; setConfirmCloseAction(null); a(); }}
              >Close anyway</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
