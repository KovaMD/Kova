import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open, save, message } from '@tauri-apps/plugin-dialog';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef, useDefaultLayout } from 'react-resizable-panels';

import { ThumbnailPanel } from './components/layout/ThumbnailPanel';
import { EditorPanel } from './components/layout/EditorPanel';
import type { EditorHandle, FormatCmd } from './components/layout/EditorPanel';
import { resolveImagePathForMarkdown } from './components/editor/mediaSnippet';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { StatusBar } from './components/layout/StatusBar';
import { PresentationOverlay } from './components/presentation/PresentationOverlay';
import { PresenterOverlay } from './components/presentation/PresenterOverlay';
import type { PresentInitPayload } from './AudienceApp';
import { SettingsModal } from './components/SettingsModal';
import { ThemeLibraryModal } from './components/inspector/ThemeLibraryModal';
import { ImportPptxModal } from './components/ImportPptxModal';
import { ImportUrlModal } from './components/ImportUrlModal';
import { ModalShell } from './components/ModalShell';
import { InfoBanner } from './components/InfoBanner';
import { isMarp, importMarp } from './engine/import/marp';
import { parsePptx } from './engine/import/parsePptx';
import { toRawUrl } from './utils/toRawUrl';
import { pptxToMarkdown } from './engine/import/pptxToMarkdown';
import { MissingThemeBanner } from './components/MissingThemeBanner';
import { loadSettings, saveSettings, EDITOR_FONT_OPTIONS } from './store/settings';
import type { AppSettings } from './store/settings';
import { loadLastSession, saveLastSession } from './store/lastSession';
import { loadRecentFiles, addRecentFile, removeRecentFile, clearRecentFiles, recentFileBasename, recentFileMenuLabel } from './store/recentFiles';
import { buildMacMenu } from './macMenu';
import type { MacMenuHandlers } from './macMenu';
import { loadKeybindings, matchShortcut, getCombo, formatCombo, isMac } from './engine/keybindings';
import type { Keybindings } from './engine/keybindings';
import { I18nProvider, useLocaleTranslator, formatFallbackDate } from './i18n';

import { parseDocument } from './engine/parser/markdownToSlides';
import { collectDiagnostics, formatCheckReport } from './engine/parser/diagnostics';
import { evaluateImportCheck } from './engine/cli/importCheckGate';
import { extractFrontmatter, patchFrontmatter } from './engine/parser/frontmatter';
import { parseBgLine, formatBgLine } from './engine/parser/bgImage';
import { fetchUpdate } from './engine/updater';
import { exportToPptx } from './engine/export/exportPptx';
import { exportToPdf, printPresentation } from './engine/export/exportPdf';
import { exportPdfNative, buildPrintDocument, type PdfExportOpts } from './engine/export/exportPdfNative';
import { SlideRenderer } from './components/preview/SlideRenderer';
import { BUILT_IN_THEMES, DEFAULT_THEME, parseThemeYaml, sanitiseThemeOverrides, type ThemeParseResult } from './engine/theme';
import { registerBundledFonts, registerCachedFont } from './engine/bundledFonts';
import type { Slide, Frontmatter } from './engine/types';
import { parseAspectRatio } from './engine/types';
import { imageMime } from './engine/export/imageMime';
import type { Theme } from './engine/theme';
import { useResolvedSlides } from './hooks/useResolvedSlides';
import type { PendingCli, CliThemeArg, PendingImport, PendingExport } from './types/cli';

import './styles/global.css';

// Parent folder of a path (handles both separators); '' if it has none.
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(0, i) : '';
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

// take_pending_cli drains once on the Rust side (Option::take), so cache the
// promise at module level: StrictMode's double-mount and dep-driven effect
// re-runs all observe the same value instead of the second call's null.
let pendingCliPromise: Promise<PendingCli | null> | null = null;
function getPendingCli(): Promise<PendingCli | null> {
  pendingCliPromise ??= invoke<PendingCli | null>('take_pending_cli').catch(() => null);
  return pendingCliPromise;
}

// Resolve a --theme argument to a Theme, or report to the terminal and exit 1
// (returning null while the process shuts down). Named themes check built-ins
// first, then the installed community themes — loaded directly here rather
// than through the allThemes state, which may not have populated yet when the
// cold-start path runs. Path themes get a `cli:`-prefixed id so a file named
// light.yaml can never collide with (and silently lose to) a built-in id.
async function resolveCliTheme(arg: CliThemeArg): Promise<Theme | null> {
  const fail = async (message: string) => {
    await invoke('cli_exit', { message, code: 1 }).catch(() => {});
    return null;
  };
  if (arg.type === 'path') {
    let text: string;
    try {
      text = await invoke<string>('read_file', { path: arg.path });
    } catch {
      return fail(`cannot read theme '${arg.path}'`);
    }
    const base = arg.path.replace(/\\/g, '/').split('/').pop() ?? arg.path;
    const parsed = parseThemeYaml(`cli:${base.replace(/\.ya?ml$/i, '')}`, text);
    if (!parsed.ok) return fail(`invalid theme '${arg.path}': ${parsed.error}`);
    return parsed.theme;
  }
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === arg.name);
  if (builtIn) return builtIn;
  try {
    const [, entries] = await invoke<[string, Array<[string, string]>]>('load_custom_themes');
    for (const [id, yaml] of entries) {
      if (id !== arg.name) continue;
      const parsed = parseThemeYaml(id, yaml);
      if (parsed.ok) return parsed.theme;
      return fail(`invalid theme '${arg.name}': ${parsed.error}`);
    }
  } catch { /* fall through to unknown */ }
  return fail(`unknown theme '${arg.name}'`);
}

// Theme ids --check validates frontmatter `theme:` against — built-ins plus
// whatever community themes are installed in the config dir.
async function knownThemeIds(): Promise<string[]> {
  const ids = BUILT_IN_THEMES.map((t) => t.id);
  try {
    const [, entries] = await invoke<[string, Array<[string, string]>]>('load_custom_themes');
    return [...ids, ...entries.map(([id]) => id)];
  } catch {
    return ids;
  }
}

// kova --import marp|pptx|url IN OUT. Headless like standalone --check: the
// window is never shown (lib.rs keeps it hidden for any CLI action), this
// runs entirely outside React state, and the process exits from here.
// Mirrors the exact conversion each in-app import flow uses (ImportPptxModal,
// ImportUrlModal, the Marp-detection prompt) so CLI output matches the GUI's.
// When `--check` is also set, validate markdown before writing (issue #178).
async function runCliImport(imp: PendingImport, check: boolean): Promise<void> {
  const finish = async (report: string) => {
    await invoke('cli_stdout', { text: report }).catch(() => {});
    await invoke('cli_exit', { code: 0 }).catch(() => {});
  };
  const fail = async (message: string) => {
    await invoke('cli_exit', { message, code: 1 }).catch(() => {});
  };
  const checkCtx = async (docDir: string) => ({
    docDir,
    themeIds: await knownThemeIds(),
    fileExists: (p: string) =>
      invoke<boolean>('path_exists', { path: p }).then(Boolean).catch(() => false),
  });
  /** Run --check on markdown; returns false when the write must be skipped. */
  const gate = async (markdown: string, label: string, docDir: string): Promise<boolean> => {
    const result = await evaluateImportCheck(check, markdown, label, await checkCtx(docDir));
    if (!result.enabled) return true;
    await invoke('cli_stdout', { text: result.report }).catch(() => {});
    if (result.errors > 0) {
      await invoke('cli_exit', { code: 1 }).catch(() => {});
      return false;
    }
    return true;
  };

  try {
    if (imp.format === 'marp') {
      const text: string = await invoke('read_file', { path: imp.input });
      // Check the import input before converting / writing (issue #178).
      if (!(await gate(text, imp.input, dirOf(imp.input)))) return;
      const { markdown, dropped } = importMarp(text);
      await invoke('write_file', { path: imp.output, content: markdown });
      const suffix = dropped.length > 0 ? ` (simplified: ${dropped.join(', ')})` : '';
      await finish(`wrote '${imp.output}'${suffix}`);
      return;
    }
    if (imp.format === 'pptx') {
      // Media referenced by the deck is extracted alongside the output file,
      // same as the in-app import modal. PPTX itself isn't Markdown — check
      // the converted deck before writing so --check still gates the output.
      const parsed = await parsePptx(imp.input, dirOf(imp.output));
      const markdown = pptxToMarkdown(parsed);
      if (!(await gate(markdown, imp.output, dirOf(imp.output)))) return;
      await invoke('write_file', { path: imp.output, content: markdown });
      const lines = [`wrote '${imp.output}' (${parsed.slides.length} slides)`];
      for (const w of parsed.warnings) lines.push(`warning: ${w}`);
      await finish(lines.join('\n'));
      return;
    }
    // url — convert web blob URLs for Git hosts (matches ImportUrlModal)
    const targetUrl = toRawUrl(imp.input);
    const text: string = await invoke('fetch_url_text', { url: targetUrl });
    if (!(await gate(text, imp.output, dirOf(imp.output)))) return;
    await invoke('write_file', { path: imp.output, content: text });
    await finish(`wrote '${imp.output}'`);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Mirrors ImportPptxModal's special-case message for this common failure.
    const msg = imp.format === 'pptx' && /password|encrypted/i.test(raw)
      ? 'PPTX file is password-protected; remove protection before importing'
      : raw;
    await fail(msg);
  }
}

export default function App() {
  const [filePath, setFilePath]           = useState<string | null>(null);
  const [content, setContent]             = useState('');
  const [isDirty, setIsDirty]             = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [focusMode, setFocusMode]         = useState(false);
  const [presentMode, setPresentMode]     = useState(false);
  // Index into visibleSlides (hidden slides skipped) while presenting — kept
  // separate from currentSlideIndex (which indexes the full editor deck).
  const [presentIndex, setPresentIndex]   = useState(0);
  // Session was started via `kova --present FILE` (docs/plans/kova-cli.md,
  // Phase B): the editor chrome is never shown, presentation starts as soon as
  // the deck resolves, and exiting quits the process instead of revealing the
  // editor. Stays true for the whole session once set.
  const [coldPresent, setColdPresent]     = useState(false);
  // Session was started via `kova --export pptx|pdf FILE OUT`: set once the
  // deck has loaded (by the same effect that handles --present), consumed by
  // the cold-export effect below the export handlers once slides resolve.
  const [coldExport, setColdExport]       = useState<PendingExport | null>(null);
  const [settings, setSettings]           = useState<AppSettings>(loadSettings);
  const t = useLocaleTranslator(settings.locale);
  const [showSettings, setShowSettings]   = useState(false);
  const [settingsScrollToUpdates, setSettingsScrollToUpdates] = useState(false);
  const [showThemeLibrary, setShowThemeLibrary] = useState(false);
  const [showImport, setShowImport]       = useState(false);
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [marpPrompt, setMarpPrompt] = useState<{ text: string; dir: string } | null>(null);
  const [marpLoss, setMarpLoss]     = useState<number | null>(null);
  // Source folder of an imported deck. The import lands in an untitled buffer
  // (no filePath), but its relative image paths must still resolve against the
  // original .md's location, so the doc-dir falls back to this when unsaved.
  const [importDir, setImportDir]   = useState('');
  const [showInspector, setShowInspector] = useState(true);
  const [recents, setRecents] = useState<string[]>(() => loadRecentFiles());
  const [presenterMode, setPresenterMode] = useState(false);
  const [confirmCloseAction, setConfirmCloseAction] = useState<(() => void) | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null);
  const [keybindings, setKeybindings]     = useState<Keybindings>({ path: '', combos: {} });
  const [warnMessage, setWarnMessage]     = useState<string | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findMode, setFindMode] = useState<'text' | 'slide'>('text');
  const [findQuery, setFindQuery] = useState('');
  const findInputRef = useRef<HTMLInputElement>(null);
  const [showExternalChangeDialog, setShowExternalChangeDialog] = useState(false);
  const [pdfOptionsOpen, setPdfOptionsOpen] = useState(false);
  const [pdfPerPage, setPdfPerPage]         = useState(1);
  const [pdfNotesOn, setPdfNotesOn]         = useState(false);
  const [isRenaming, setIsRenaming]       = useState(false);
  const [renameValue, setRenameValue]     = useState('');
  const [resolvedUiTheme, setResolvedUiTheme] = useState<'dark' | 'light'>('dark');
  const [fileMenuOpen, setFileMenuOpen]       = useState(false);
  const [importSubmenuOpen, setImportSubmenuOpen] = useState(false);
  const [recentSubmenuOpen, setRecentSubmenuOpen] = useState(false);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [editMenuOpen, setEditMenuOpen]       = useState(false);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const [pdfExportContext, setPdfExportContext] = useState<{ slides: Slide[]; savePath: string } | null>(null);
  const pdfSlideRefs         = useRef<Map<number, HTMLElement>>(new Map());
  const pdfExportRunnerRef   = useRef<(() => Promise<void>) | null>(null);
  const pdfSlideReadyCount   = useRef(0);
  const pdfSlideReadyTotal   = useRef(0);
  const [printContext, setPrintContext] = useState<{ slides: Slide[] } | null>(null);
  const printSlideRefs       = useRef<Map<number, HTMLElement>>(new Map());
  const printExportRunnerRef = useRef<(() => Promise<void>) | null>(null);
  const printSlideReadyCount = useRef(0);
  const printSlideReadyTotal = useRef(0);
  const [fileDragOver, setFileDragOver]       = useState(false);
  const [dropConfirmPath, setDropConfirmPath] = useState<string | null>(null);

  // Theme state: active theme id + per-session overrides
  const [allThemes, setAllThemes]         = useState<Theme[]>(BUILT_IN_THEMES);
  const allThemesRef = useRef(BUILT_IN_THEMES as Theme[]);
  useEffect(() => { allThemesRef.current = allThemes; }, [allThemes]);
  const [activeThemeId, setActiveThemeId] = useState<string>(DEFAULT_THEME.id);
  const [themeOverrides, setThemeOverrides] = useState<Partial<Theme>>({});
  const [missingThemeId, setMissingThemeId]   = useState<string | null>(null);
  const [resolvedLogoUrl, setResolvedLogoUrl] = useState<string | undefined>(undefined);

  const installedRemoteIds = useMemo(
    () => new Set(allThemes.filter((t) => !BUILT_IN_THEMES.some((b) => b.id === t.id)).map((t) => t.id)),
    [allThemes],
  );

  // Resolved theme = base theme merged with overrides
  const activeTheme = useMemo<Theme>(() => {
    const base = allThemes.find((t) => t.id === activeThemeId) ?? DEFAULT_THEME;
    const merged: Theme = { ...base, ...themeOverrides,
      colors: { ...base.colors, ...(themeOverrides.colors ?? {}) },
      fonts:  { ...base.fonts,  ...(themeOverrides.fonts  ?? {}) },
      header: { ...base.header, ...(themeOverrides.header ?? {}) },
      footer: { ...base.footer, ...(themeOverrides.footer ?? {}) },
      toc: { ...base.toc, ...(themeOverrides.toc ?? {}) },
    };
    // Swap in the pre-resolved data URL for the logo. The asset protocol cannot
    // reliably serve absolute Windows paths outside the home directory, so we
    // read the file via IPC (see the useEffect below) and embed it as base64.
    return { ...merged, logo: resolvedLogoUrl };
  }, [allThemes, activeThemeId, themeOverrides, resolvedLogoUrl]);

  // Effective raw logo: override wins; fall back to the base theme's logo when
  // the user hasn't explicitly set or cleared it in this session.
  const rawLogoSrc = useMemo(() => {
    if ('logo' in themeOverrides) return themeOverrides.logo;
    const base = allThemes.find((t) => t.id === activeThemeId) ?? DEFAULT_THEME;
    return base.logo;
  }, [themeOverrides, allThemes, activeThemeId]);

  // Resolve the raw logo path to a data URL via IPC so the image works in both
  // windows regardless of asset-protocol scope restrictions on Windows.
  useEffect(() => {
    const raw = rawLogoSrc;
    if (!raw) { setResolvedLogoUrl(undefined); return; }
    if (/^(https?:|data:)/i.test(raw)) { setResolvedLogoUrl(raw); return; }
    const mime = imageMime(raw);
    invoke<string>('read_file_b64', { path: raw })
      .then((b64) => setResolvedLogoUrl(`data:${mime};base64,${b64}`))
      .catch(() => setResolvedLogoUrl(undefined));
  }, [rawLogoSrc]);

  useEffect(() => {
    if (activeTheme.bundledFonts?.length) {
      registerBundledFonts(activeTheme.bundledFonts);
    }
  }, [activeTheme.bundledFonts]);

  // Download-once, verify, and register any remote fonts declared by the active theme.
  // Re-runs only on theme identity change since remoteFonts are theme-level, not overrides.
  useEffect(() => {
    const fonts = activeTheme.remoteFonts;
    if (!fonts?.length) return;
    for (const font of fonts) {
      invoke<string>('download_and_cache_font', { url: font.url, sha256: font.sha256 })
        .then((cachedPath) => {
          registerCachedFont(font.family, cachedPath, font.weight, font.style, font.sha256, convertFileSrc);
        })
        .catch((err) => {
          console.warn(`[kova] remote font "${font.family}" failed: ${err}`);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThemeId]);

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

  // Body-only view for the editor — frontmatter is managed by the inspector.
  const editorBody = useMemo(() => extractFrontmatter(content).body, [content]);

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
  const externalChangeDialogRef = useRef(showExternalChangeDialog);
  externalChangeDialogRef.current = showExternalChangeDialog;
  // Captures the file path at the moment the external-change dialog is opened,
  // so the Reload button always reloads the file that triggered the alert even
  // if the user somehow navigates to a different file before clicking.
  const externalChangePathRef = useRef<string | null>(null);
  const editorContent = settings.showFrontmatter ? content : editorBody;

  const docDir = useMemo(() => {
    const lastSlash = filePath
      ? Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
      : -1;
    return lastSlash >= 0 ? filePath!.substring(0, lastSlash) : importDir;
  }, [filePath, importDir]);

  const slides = useResolvedSlides(rawSlides, docDir);

  // Compute a safe index in the same render as slides so children never receive
  // an out-of-bounds value during the frame before the clamp useEffect fires.
  const safeSlideIndex = slides.length > 0
    ? Math.min(currentSlideIndex, slides.length - 1)
    : 0;

  // Deck used for presentation + export — hidden slides removed. Reference-equal
  // to entries in `slides`, so index translation uses indexOf/indexOf.
  const visibleSlides = useMemo(() => slides.filter((s) => !s.hidden), [slides]);
  const safePresentIndex = visibleSlides.length > 0
    ? Math.min(presentIndex, visibleSlides.length - 1)
    : 0;

  // {title} in header/footer templates falls back to the deck's cover slide
  // (first non-hidden H1) when frontmatter has no explicit `title:` — most
  // decks only ever get a title via a heading, never via frontmatter, and a
  // silently blank footer segment (issue #55) is worse than this guess.
  const docTitle = frontmatter.title ?? rawSlides.find((s) => !s.hidden && s.titleLevel === 1)?.title ?? '';
  const docDate = (frontmatter.date as string | undefined) ?? formatFallbackDate(settings.locale);

  const aspectRatio = useMemo(
    () => parseAspectRatio(frontmatter.aspect_ratio as string | undefined),
    [frontmatter.aspect_ratio],
  );

  const wordCount = useMemo(() => countWords(editorBody), [editorBody]);

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
      .then(([, entries]) => {
        const results: ThemeParseResult[] = entries.map(([id, yaml]) => parseThemeYaml(id, yaml));
        const custom = results.filter((r): r is Extract<ThemeParseResult, { ok: true }> => r.ok).map((r) => r.theme);
        const errors = results.filter((r): r is Extract<ThemeParseResult, { ok: false }> => !r.ok).map((r) => r.error);
        setAllThemes(() => {
          const base = custom.length > 0 ? [...BUILT_IN_THEMES, ...custom] : BUILT_IN_THEMES;
          // Keep a --theme=path/to.yaml theme alive: it lives outside the
          // config dir, so rebuilding the list from disk would drop it.
          const cliTheme = cliThemeRef.current;
          return cliTheme && !base.some((t) => t.id === cliTheme.id) ? [...base, cliTheme] : base;
        });
        if (errors.length > 0) setWarnMessage(`Theme parse error:\n${errors.join('\n')}`);
      })
      .catch(() => {});
  }, []);

  const handleMissingThemeInstalled = useCallback((themeId: string) => {
    reloadCustomThemes();
    setActiveThemeId(themeId);
    setThemeOverrides({});
    setMissingThemeId(null);
  }, [reloadCustomThemes]);

  // Load custom themes from the platform config dir on startup
  useEffect(() => { reloadCustomThemes(); }, [reloadCustomThemes]);

  // Resolve a formerly-missing theme once custom themes finish loading.
  // Fixes a startup race: if the session file loads before load_custom_themes
  // returns, applyFileContent marks the theme missing even though it is installed.
  useEffect(() => {
    if (!missingThemeId) return;
    const found = allThemes.find((t) => t.id === missingThemeId);
    if (!found) return;
    const { frontmatter: fm } = extractFrontmatter(contentRef.current);
    setActiveThemeId(found.id);
    setMissingThemeId(null);
    setThemeOverrides(sanitiseThemeOverrides(fm.theme_overrides as Record<string, unknown> ?? {}));
  }, [allThemes, missingThemeId]);

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

  // Window title — used by the taskbar/switcher/Mission Control. On macOS the
  // title text is hidden at the NSWindow level (see lib.rs setup) so it doesn't
  // duplicate the in-app centered doctitle next to the traffic lights.
  useEffect(() => {
    const name = frontmatter.title ?? filePath?.split(/[\\/]/).pop() ?? 'Kova';
    getCurrentWindow().setTitle(isDirty ? `${name} • — Kova` : `${name} — Kova`).catch(() => {});
  }, [filePath, frontmatter.title, isDirty]);

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
        newContent = await invoke('read_file', { path });
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
        if (!cliThemeRef.current) syncThemeFromContent(newContent);
        setContent(newContent);
        setIsDirty(false);
        diskContentRef.current = newContent;
        externalChangePathRef.current = path;
        setShowExternalChangeDialog(true);
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
      setActiveThemeId(settings.defaultThemeId);
      setThemeOverrides({});
      setMissingThemeId(null);
    });
  }, [guardDirty, settings.defaultThemeId]);

  // Cold-start present guards: the load must run once (applyFileContent's
  // identity changes re-run the drain effect) and presentation must be
  // entered exactly once (visibleSlides/handlePresentEnter identity changes
  // re-run the auto-enter effect).
  const coldLoadStartedRef = useRef(false);
  const coldEnterFiredRef = useRef(false);
  // Theme resolved from --theme, if any. Consulted by reloadCustomThemes (so
  // a later community-theme reload doesn't drop it from allThemes) and by the
  // watcher's silent-reload path (an external file edit re-syncing the theme
  // from frontmatter must not clobber the CLI override mid-presentation).
  const cliThemeRef = useRef<Theme | null>(null);
  // Render-updated mirror of coldPresent for the audience window's
  // tauri://error and tauri://destroyed once-handlers, whose closures
  // outlive the render that registered them.
  const coldPresentRef = useRef(coldPresent);
  coldPresentRef.current = coldPresent;
  // Prevents double-exit when the audience window is closed externally while
  // handlePresentExit is already in flight.
  const isExitingRef = useRef(false);
  // Incremented each time a presentation session starts so that a stale
  // tauri://destroyed handler from a previous session (e.g. close of a leftover
  // audience window) can detect it is out of date and skip its state reset.
  const presentSessionRef = useRef(0);

  const handlePresentExit = useCallback(async () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    await emit('present:exit', null).catch(() => {});
    // Close the audience window directly — the present:exit event may not be
    // processed promptly if macOS App Nap has throttled the window's WebView
    // after extended idle time (typically 10+ minutes on an external display).
    try {
      const audienceWin = await WebviewWindow.getByLabel('audience');
      if (audienceWin) await audienceWin.close().catch(() => {});
    } catch { /* ignore */ }
    // Cold-started session (kova --present): exiting the presentation is
    // exiting the app — there is no editor session to return to. Release the
    // wake lock explicitly first: cli_exit is a hard process exit, so the
    // effect that normally releases it on presentMode→false never runs, and
    // an orphaned macOS caffeinate child would keep the machine awake.
    if (coldPresent) {
      await invoke('set_wake_lock', { active: false }).catch(() => {});
      await invoke('cli_exit', { code: 0 }).catch(() => {});
      return;
    }
    setPresentMode(false);
    setPresenterMode(false);
    // Land the editor on whatever slide we exited on (translate visible→full).
    const full = slides.indexOf(visibleSlides[safePresentIndex]);
    if (full >= 0) setCurrentSlideIndex(full);
    await getCurrentWindow().setFullscreen(false).catch(() => {});
    isExitingRef.current = false;
  }, [slides, visibleSlides, safePresentIndex, coldPresent]);

  const handlePresentEnter = useCallback(async (eOrFromCurrent?: React.MouseEvent | boolean) => {
    if (visibleSlides.length === 0) return;
    isExitingRef.current = false;
    const sessionId = ++presentSessionRef.current;
    // "Present from current" — accepts a boolean (keyboard path) or a MouseEvent
    // (alt+click path). If a hidden slide is current, indexOf is -1 → first visible.
    const fromCurrent = typeof eOrFromCurrent === 'boolean' ? eOrFromCurrent : eOrFromCurrent?.altKey ?? false;
    const startIndex = fromCurrent ? Math.max(0, visibleSlides.indexOf(slides[safeSlideIndex])) : 0;
    setPresentIndex(startIndex);

    // Resolve 'auto': detect monitors first, then pick mode.
    // Use currentMonitor() (not primaryMonitor()) to find the monitor Kova is
    // running on — on Wayland, primaryMonitor() returns null for both monitors
    // because "primary" is an X11 concept the compositor doesn't expose.
    let all: Awaited<ReturnType<typeof availableMonitors>> = [];
    let currentMon: Awaited<ReturnType<typeof currentMonitor>> = null;
    try {
      [all, currentMon] = await Promise.all([availableMonitors(), currentMonitor()]);
    } catch { /* ignore */ }
    const external = (() => {
      if (all.length <= 1) return null;
      if (currentMon) {
        // Name-based match works on macOS and Windows.
        return all.find((m) => m.name !== currentMon.name) ?? null;
      }
      // Wayland: currentMonitor() returns null because "primary" is an X11 concept.
      // Heuristic: the secondary monitor is typically to the right or below, so
      // pick the one whose origin is furthest from (0, 0).
      return all.reduce((best, m) =>
        (m.position.x + m.position.y) > (best.position.x + best.position.y) ? m : best
      );
    })();

    const rawMode = settings.presentationMode;
    const mode: Exclude<typeof rawMode, 'auto'> =
      rawMode === 'auto' ? (external ? 'dual' : 'single') : rawMode;

    if (mode === 'dual' || mode === 'mirror') {

      if (external) {
        const initPayload: PresentInitPayload = {
          slides: visibleSlides,
          theme: activeTheme,
          index: startIndex,
          aspectRatio,
          docTitle,
          docDate,
        };

        // Close any stale audience window from a previous failed session to
        // prevent a name collision that would silence window creation errors.
        try {
          const stale = await WebviewWindow.getByLabel('audience');
          if (stale) await stale.close().catch(() => {});
        } catch { /* ignore */ }

        // Register ready listener BEFORE creating the window to avoid missing the event.
        // Use `let` so the timeout callback can also reach it.
        let unlistenReady: (() => void) | undefined;
        const readyTimeoutId = setTimeout(() => {
          // present:ready never fired — window creation silently failed.
          // Clean up the dangling listener so a future attempt starts fresh.
          unlistenReady?.();
        }, 10_000);

        unlistenReady = await listen('present:ready', async () => {
          clearTimeout(readyTimeoutId);
          unlistenReady?.();
          await emitTo('audience', 'present:init', initPayload);

          // Drive positioning + fullscreen via Rust.
          const logX = external.position.x / external.scaleFactor;
          const logY = external.position.y / external.scaleFactor;
          await invoke('setup_audience_window', {
            x: logX,
            y: logY,
            physicalX: external.position.x,
            physicalY: external.position.y,
          }).catch(() => {});
          // Reclaim focus on the presenter window — the audience window creation
          // may steal it even with focus:false, depending on the compositor.
          await getCurrentWindow().setFocus().catch(() => {});
        });

        const audienceWin = new WebviewWindow('audience', {
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

        // If window creation fails, clean up the ready listener and reset state.
        // Cold-started sessions have no editor to fall back to — report and quit.
        audienceWin.once('tauri://error', () => {
          clearTimeout(readyTimeoutId);
          unlistenReady?.();
          if (coldPresentRef.current) {
            invoke('set_wake_lock', { active: false }).catch(() => {});
            invoke('cli_exit', {
              message: 'failed to create the presentation window',
              code: 1,
            }).catch(() => {});
            return;
          }
          setPresentMode(false);
          setPresenterMode(false);
          getCurrentWindow().setFullscreen(false).catch(() => {});
        }).catch(() => {});

        // If the audience window is closed externally (compositor, Alt+F4, etc.),
        // exit presentation mode so the main window doesn't stay stuck fullscreened.
        // The sessionId guard ensures a stale handler from a previous session
        // (triggered by closing a leftover window at the start of a new session)
        // does not reset state that the new session just set.
        audienceWin.once('tauri://destroyed', () => {
          if (isExitingRef.current) return; // normal exit already in progress
          if (presentSessionRef.current !== sessionId) return; // stale session
          // Cold-started session: the audience window going away ends the
          // presentation, and ending the presentation ends the app.
          if (coldPresentRef.current) {
            invoke('set_wake_lock', { active: false }).catch(() => {});
            invoke('cli_exit', { code: 0 }).catch(() => {});
            return;
          }
          setPresentMode(false);
          setPresenterMode(false);
          getCurrentWindow().setFullscreen(false).catch(() => {});
        }).catch(() => {});

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
  }, [slides, visibleSlides, safeSlideIndex, activeTheme, aspectRatio, docTitle, docDate, settings.presentationMode]);

  // Cold-start present: enter presentation exactly once, as soon as the file
  // content has been applied (filePath set in the same batch as content).
  // Slide count is synchronous with content — useResolvedSlides only swaps
  // media srcs asynchronously — so an empty visibleSlides here is a genuinely
  // empty deck, not a deck that hasn't resolved yet. The window is hidden
  // until this point (lib.rs setup skips show() for CLI actions); show it
  // before entering so monitor detection and fullscreen behave normally.
  useEffect(() => {
    if (!coldPresent || coldEnterFiredRef.current || !filePath) return;
    coldEnterFiredRef.current = true;
    if (visibleSlides.length === 0) {
      invoke('cli_exit', {
        message: `'${filePath}' contains no visible slides`,
        code: 1,
      }).catch(() => {});
      return;
    }
    (async () => {
      await getCurrentWindow().show().catch(() => {});
      await handlePresentEnter(false);
    })();
  }, [coldPresent, filePath, visibleSlides, handlePresentEnter]);

  // Prevent display sleep while presenting; release on exit.
  // Covers all exit paths (normal, error, external window close).
  useEffect(() => {
    invoke('set_wake_lock', { active: presentMode || presenterMode }).catch(() => {});
  }, [presentMode, presenterMode]);

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
    const unlistenNavigate = listen<{ index: number }>('audience:navigate', (e) => {
      setPresentIndex(e.payload.index);
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
    emitTo('audience', 'present:navigate', { index: safePresentIndex }).catch(() => {});
  }, [presentMode, safePresentIndex]);

  const handleThemeSelect = useCallback((id: string) => {
    setActiveThemeId(id);
    // Preserve user-configured values across theme switches: header/footer/toc
    // content and any logo the user explicitly chose. Color/font overrides
    // are cleared since they were customising the old theme's palette.
    setThemeOverrides((prev) => {
      const preserved: Partial<Theme> = {};
      if (prev.header !== undefined) preserved.header = prev.header;
      if (prev.footer !== undefined) preserved.footer = prev.footer;
      if (prev.toc !== undefined) preserved.toc = prev.toc;
      if ('logo' in prev) preserved.logo = prev.logo;
      if (prev.logo_position !== undefined) preserved.logo_position = prev.logo_position;
      if (prev.logo_opacity !== undefined) preserved.logo_opacity = prev.logo_opacity;
      return preserved;
    });
    setContent((prev) => {
      const patched = patchFrontmatter(prev, { theme: id, theme_overrides: null });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, []);

  const handleThemeChange = useCallback((patch: Partial<Theme>) => {
    setThemeOverrides((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
  }, []);

  const handleMetaChange = useCallback((field: 'title' | 'author' | 'date', value: string) => {
    setContent((prev) => {
      const patched = patchFrontmatter(prev, { [field]: value.trim() || null });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, []);

  const handleAspectRatioCycle = useCallback(() => {
    setContent((prev) => {
      const { frontmatter: fm } = extractFrontmatter(prev);
      const current = fm.aspect_ratio as string | undefined;
      const next = current === '4:3' ? '16:10' : current === '16:10' ? null : '4:3';
      const patched = patchFrontmatter(prev, { aspect_ratio: next });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
  }, []);

  // Restore theme + theme_overrides from a document's frontmatter. Overrides
  // (footer/header/logo/etc.) apply on top of whichever theme is active and
  // must be restored regardless of whether an explicit `theme:` key is
  // present — discarding them here caused saved footer/header customisations
  // on the default theme to silently revert on reopen (#55).
  const syncThemeFromContent = useCallback((text: string) => {
    const { frontmatter: fm } = extractFrontmatter(text);
    if (typeof fm.theme === 'string') {
      const found = allThemesRef.current.find((t) => t.id === fm.theme);
      if (found) {
        setActiveThemeId(found.id);
        setMissingThemeId(null);
      } else {
        setMissingThemeId(fm.theme);
        setThemeOverrides({});
        return;
      }
    } else {
      setActiveThemeId(DEFAULT_THEME.id);
      setMissingThemeId(null);
    }
    setThemeOverrides(sanitiseThemeOverrides(fm.theme_overrides as Record<string, unknown> ?? {}));
  }, []);

  // Shared post-load sequence: apply theme, content, and watcher for a file that
  // has already been read (or generated) and saved to disk.
  const applyFileContent = useCallback(async (text: string, path: string) => {
    syncThemeFromContent(text);
    setFilePath(path);
    setContent(text);
    setIsDirty(false);
    diskContentRef.current = text;
    setCurrentSlideIndex(0);
    if (path) await invoke('start_watching', { path }).catch(console.error);
    setMarpPrompt(isMarp(text) ? { text, dir: dirOf(path) } : null);
    setImportDir('');
    setMarpLoss(null);
  }, [syncThemeFromContent]);

  // Cold-start present (kova --present FILE): load the file through the same
  // post-read sequence as a normal open so docDir, theme sync, and the watcher
  // all populate identically; the auto-enter effect below the present handlers
  // starts the presentation once the deck is derived. Errors report to the
  // launching terminal — the window is still hidden here, so a GUI dialog
  // could be invisible; stderr is the CLI user's surface anyway.
  useEffect(() => {
    if (coldLoadStartedRef.current) return;
    (async () => {
      const cli = await getPendingCli();
      if (coldLoadStartedRef.current) return;
      // kova --import: fully headless, no editor state or window involved —
      // runs and exits before any of the present/check logic below.
      if (cli?.import) {
        coldLoadStartedRef.current = true;
        await runCliImport(cli.import, cli.check);
        return;
      }
      // --present FILE, standalone --check FILE (which never shows a window:
      // the loading branch renders behind a window that lib.rs never shows, and
      // the process exits from this effect), or --export's input file (the
      // window also stays hidden — export_pdf_native always prints via its
      // own separate hidden window regardless, and PPTX needs no window at
      // all — the cold-export effect below picks this up once slides resolve).
      const target = cli?.present ?? cli?.check_only ?? cli?.export?.input;
      if (!cli || !target) return;
      coldLoadStartedRef.current = true;
      if (cli.present) setColdPresent(true);
      // Resolve --theme before loading the deck: theme errors are fail-fast
      // (stderr + exit 1) like a missing presentation file, and nothing has
      // rendered yet at this point. Applies to present and export — not
      // import, which never renders anything a theme could affect.
      let cliTheme: Theme | null = null;
      if (cli.theme && (cli.present || cli.export)) {
        cliTheme = await resolveCliTheme(cli.theme);
        if (!cliTheme) return; // reported and exiting
      }
      try {
        const text: string = await invoke('read_file', { path: target });
        // --check: validate before anything renders. The report goes to
        // stdout (it is data; errors about the invocation itself go to
        // stderr). Standalone check exits either way; as a gate before
        // --present, errors abort with exit 1 and warnings continue into
        // the presentation.
        if (cli.check || cli.check_only) {
          const diags = await collectDiagnostics(text, {
            docDir: dirOf(target),
            themeIds: await knownThemeIds(),
            fileExists: (p) =>
              invoke<boolean>('path_exists', { path: p }).then(Boolean).catch(() => false),
          });
          const { report, errors } = formatCheckReport(target, diags);
          await invoke('cli_stdout', { text: report }).catch(() => {});
          if (cli.check_only || errors > 0) {
            await invoke('cli_exit', { code: errors > 0 ? 1 : 0 }).catch(() => {});
            return;
          }
        }
        await invoke('stop_watching').catch(() => {});
        await applyFileContent(text, target);
        if (cliTheme) {
          // --theme replaces the deck's *base* theme; frontmatter
          // theme_overrides still apply on top. Set overrides explicitly:
          // syncThemeFromContent (inside applyFileContent) skips them when
          // the frontmatter theme is missing from the library, and that
          // missing-theme state is irrelevant under a CLI override.
          cliThemeRef.current = cliTheme;
          const id = cliTheme.id;
          setAllThemes((prev) => prev.some((t) => t.id === id) ? prev : [...prev, cliTheme]);
          setActiveThemeId(id);
          setMissingThemeId(null);
          const { frontmatter: fm } = extractFrontmatter(text);
          setThemeOverrides(sanitiseThemeOverrides(fm.theme_overrides as Record<string, unknown> ?? {}));
        }
        if (cli.export) setColdExport(cli.export);
      } catch {
        await invoke('cli_exit', {
          message: `cannot read '${target}'`,
          code: 1,
        }).catch(() => {});
      }
    })();
  }, [applyFileContent]);

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
        const text: string = await invoke('read_file', { path: session.path });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // Keep the last-session record current so it's accurate whenever the app
  // actually quits. Mirrors the literal on-screen state: clears the record
  // when there's no open file (e.g. after File > New) rather than leaving a
  // stale pointer to whatever was open before.
  useEffect(() => {
    // A presentation-only run (kova --present) must not clobber the editor's
    // last-session record — the user never opened this file for editing.
    if (coldPresent) return;
    saveLastSession(filePath ? { path: filePath, slideIndex: safeSlideIndex } : null);
  }, [filePath, safeSlideIndex, coldPresent]);

  // Maintain the "Open Recent" list whenever a file becomes the open document.
  useEffect(() => {
    if (filePath) setRecents(addRecentFile(filePath));
  }, [filePath]);

  const handleMarkdownDrop = useCallback((path: string) => {
    const doOpen = async () => {
      const myGeneration = ++loadGenerationRef.current;
      try {
        await invoke('stop_watching').catch(() => {});
        const text: string = await invoke('read_file', { path });
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

  const handleImportComplete = useCallback(async (markdown: string, savedPath: string) => {
    setShowImport(false);
    await invoke('stop_watching').catch(() => {});
    await applyFileContent(markdown, savedPath);
  }, [applyFileContent]);

  const handleImportFromUrl = useCallback(async (text: string) => {
    setShowImportUrl(false);
    await invoke('stop_watching').catch(() => {});
    await applyFileContent(text, '');
  }, [applyFileContent]);

  const handleImportMarp = useCallback(() => {
    guardDirty(async () => { try {
      const selected = await open({
        filters: [{ name: 'Marp Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      await invoke('stop_watching').catch(() => {});
      const text: string = await invoke('read_file', { path: selected });
      const { markdown, dropped } = importMarp(text);
      await applyFileContent(markdown, '');
      setImportDir(dirOf(selected));
      setMarpPrompt(null);
      setMarpLoss(dropped.length);
    } catch (err) { console.error('Marp import failed:', err); } });
  }, [guardDirty, applyFileContent]);

  const handleOpenFile = useCallback(() => {
    guardDirty(async () => { try {
      const selected = await open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      await invoke('stop_watching').catch(() => {});
      const text: string = await invoke('read_file', { path: selected });
      await applyFileContent(text, selected);
    } catch (err) { console.error('Open failed:', err); setWarnMessage(`Could not open file: ${err}`); }});
  }, [guardDirty, applyFileContent]);

  const buildSaveContent = useCallback(() => {
    const overridePatch: Record<string, unknown> = {};
    if (themeOverrides.colors && Object.keys(themeOverrides.colors).length > 0)
      overridePatch.colors = themeOverrides.colors;
    if (themeOverrides.fonts && Object.keys(themeOverrides.fonts).length > 0)
      overridePatch.fonts = themeOverrides.fonts;
    if ('logo' in themeOverrides)
      overridePatch.logo = themeOverrides.logo ?? null;
    if (themeOverrides.logo_position !== undefined)
      overridePatch.logo_position = themeOverrides.logo_position;
    if (themeOverrides.logo_opacity !== undefined)
      overridePatch.logo_opacity = themeOverrides.logo_opacity;
    if (themeOverrides.header !== undefined)
      overridePatch.header = themeOverrides.header;
    if (themeOverrides.footer !== undefined)
      overridePatch.footer = themeOverrides.footer;
    if (themeOverrides.toc !== undefined)
      overridePatch.toc = themeOverrides.toc;
    const hasOverrides = Object.keys(overridePatch).length > 0;
    return hasOverrides
      ? patchFrontmatter(content, { theme_overrides: overridePatch })
      : patchFrontmatter(content, { theme_overrides: null });
  }, [content, themeOverrides]);

  const handleRenameCommit = useCallback(async () => {
    setIsRenaming(false);
    if (!filePath) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    const sep = filePath.includes('\\') ? '\\' : '/';
    const dir = filePath.substring(0, filePath.lastIndexOf(sep));
    const ext = filePath.match(/\.(md|markdown)$/i)?.[0] ?? '.md';
    const newPath = `${dir}${sep}${trimmed}${ext}`;
    if (newPath === filePath) return;
    try {
      await invoke('stop_watching').catch(() => {});
      await invoke('rename_file', { oldPath: filePath, newPath });
      setFilePath(newPath);
      await invoke('start_watching', { path: newPath }).catch(console.error);
    } catch (err) {
      console.error('Rename failed:', err);
      setWarnMessage(`Rename failed: ${err}`);
    }
  }, [filePath, renameValue]);

  const handleSave = useCallback(async () => {
    if (!filePath) return;
    // Optimistic: mark clean before the write so that when the OS file-watcher
    // fires (during the IPC round-trip) isDirtyRef.current is already false and
    // the event is treated as a silent no-op reload rather than a warning.
    // React renders this state change before Rust's disk I/O + IPC completes.
    setIsDirty(false);
    try {
      const toWrite = buildSaveContent();
      await invoke('write_file', { path: filePath, content: toWrite });
      if (toWrite !== content) setContent(toWrite);
      diskContentRef.current = toWrite;
      // Re-register the watcher: atomic_write replaces the file's inode via
      // rename, which causes inotify to drop the watch on the old inode.
      // Explicitly re-watching after each save ensures external changes are
      // detected regardless of how the OS / notify crate handles the rename.
      await invoke('start_watching', { path: filePath }).catch(console.error);
      // Saving resolves any pending external-change conflict: the user's edits
      // win. Dismiss the dialog so the confirmCloseAction "Save" path can
      // proceed with the close, and so Ctrl+S while the dialog is open doesn't
      // leave a stale conflict prompt on screen.
      setShowExternalChangeDialog(false);
    } catch (err) {
      setIsDirty(true);
      console.error('Save failed:', err);
      setWarnMessage(`Save failed: ${err}`);
    }
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
      diskContentRef.current = toWrite;
      await invoke('start_watching', { path: target }).catch(console.error);
      return target;
    } catch (err) { console.error('Save As failed:', err); setWarnMessage(`Save failed: ${err}`); return null; }
  }, [filePath, content, buildSaveContent]);

  const handleExport = useCallback(async () => {
    if (visibleSlides.length === 0) return;
    try {
      const { base64, warnings } = await exportToPptx(visibleSlides, frontmatter, activeTheme, settings.locale);
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
        window.alert(t('app.exportCompleteWithWarnings', { count: warnings.length, warnings: warnings.join('\n') }));
      }
    } catch (err) {
      console.error('Export failed:', err);
      window.alert(t('app.pptxExportFailed', { error: String(err) }));
    }
  }, [visibleSlides, frontmatter, activeTheme, filePath, settings.locale, t]);

  // Called by each SlideRenderer when all its Mermaid diagrams have rendered.
  const onPdfSlideReady = useRef(() => {
    pdfSlideReadyCount.current += 1;
    if (pdfSlideReadyCount.current >= pdfSlideReadyTotal.current) {
      const fn = pdfExportRunnerRef.current;
      pdfExportRunnerRef.current = null;
      // Defer to a task (not a microtask) so React StrictMode's simulated
      // unmount+remount cycle completes before we read element dimensions.
      // Without this, StrictMode detaches the off-screen slide elements between
      // the runner firing and captureSlide reading offsetWidth, producing a
      // 0×0 canvas and a blank PDF.
      if (fn) setTimeout(() => void fn(), 0);
    }
  });
  const onPrintSlideReady = useRef(() => {
    printSlideReadyCount.current += 1;
    if (printSlideReadyCount.current >= printSlideReadyTotal.current) {
      const fn = printExportRunnerRef.current;
      printExportRunnerRef.current = null;
      if (fn) setTimeout(() => void fn(), 0);
    }
  });

  // Shared by the button (handleExportPdf) and the headless CLI export path:
  // mounts the off-screen slide list, waits for it to render (native print
  // first, raster fallback on failure), writes the file, and reports back
  // what happened rather than alerting — each caller handles that its own
  // way (a dialog here, stdout/stderr for the CLI). Throws only on total
  // failure (both native and the raster fallback failed).
  const runPdfExportCapture = useCallback(async (
    visSlides: Slide[],
    savePath: string,
    opts: PdfExportOpts,
  ): Promise<{ warnings: string[]; usedFallback: boolean; fallbackReason?: string }> => {
    pdfSlideRefs.current.clear();
    pdfSlideReadyCount.current = 0;
    pdfSlideReadyTotal.current = visSlides.length;
    return new Promise((resolve, reject) => {
      pdfExportRunnerRef.current = async () => {
        try {
          const elements = Array.from(
            { length: visSlides.length },
            (_, i) => pdfSlideRefs.current.get(i),
          ).filter((el): el is HTMLElement => Boolean(el));

          try {
            await exportPdfNative(elements, aspectRatio, savePath, opts);
            resolve({ warnings: [], usedFallback: false });
          } catch (nativeErr) {
            // Native backend unavailable/failed — degrade to the raster renderer.
            // It's one-slide-per-page and ignores handout/N-up/paper options.
            const { base64, warnings } = await exportToPdf(elements, activeTheme, aspectRatio);
            await invoke('write_file_bytes', { path: savePath, data: base64 });
            resolve({ warnings, usedFallback: true, fallbackReason: String(nativeErr) });
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setPdfExportContext(null);
          pdfSlideRefs.current.clear();
          pdfExportRunnerRef.current = null;
        }
      };
      setPdfExportContext({ slides: visSlides, savePath });
    });
  }, [aspectRatio, activeTheme]);

  const handleExportPdf = useCallback(async (opts: PdfExportOpts = {}) => {
    if (visibleSlides.length === 0) return;
    // The in-window buttons disable while an export is already in flight, but
    // the macOS native menu bar has no such guard (its items are always
    // enabled) — without this, triggering a second export via the menu while
    // one is running clobbers the first's shared in-flight refs/state.
    if (pdfExportContext !== null || printContext !== null) return;
    const defaultPath = filePath
      ? filePath.replace(/\.(md|markdown)$/i, '.pdf')
      : 'presentation.pdf';
    const target = await save({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      defaultPath,
    });
    if (!target) return;
    const savePath = target.toLowerCase().endsWith('.pdf') ? target : `${target}.pdf`;

    try {
      const outcome = await runPdfExportCapture([...visibleSlides], savePath, opts);
      if (outcome.usedFallback) {
        console.error('Native PDF failed, falling back to raster:', outcome.fallbackReason);
        window.alert(
          t('app.pdfExportFallback') +
          `\n\n${t('app.pdfExportFallbackReason', { error: outcome.fallbackReason ?? '' })}` +
          (outcome.warnings.length ? `\n\n${outcome.warnings.join('\n')}` : ''),
        );
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      window.alert(t('app.pdfExportFailed', { error: String(err) }));
    }
  }, [visibleSlides, filePath, runPdfExportCapture, t, pdfExportContext, printContext]);

  // Cold-start export (kova --export pptx|pdf FILE OUT): the load effect
  // above applies --theme and loads the deck; this fires once slides are
  // resolved. PPTX needs no rendered DOM (exportToPptx works from slide data
  // directly); PDF reuses the exact capture path the button uses above,
  // native print against the hidden dedicated print window (export_pdf_native
  // already always creates one, whether launched from the GUI or the CLI)
  // with the same raster fallback on failure.
  const coldExportFiredRef = useRef(false);
  useEffect(() => {
    if (!coldExport || coldExportFiredRef.current || !filePath) return;
    coldExportFiredRef.current = true;
    if (visibleSlides.length === 0) {
      invoke('cli_exit', {
        message: `'${filePath}' contains no visible slides`,
        code: 1,
      }).catch(() => {});
      return;
    }
    const finish = async (report: string) => {
      await invoke('cli_stdout', { text: report }).catch(() => {});
      await invoke('cli_exit', { code: 0 }).catch(() => {});
    };
    const fail = async (message: string) => {
      await invoke('cli_exit', { message, code: 1 }).catch(() => {});
    };
    (async () => {
      try {
        if (coldExport.format === 'pptx') {
          const { base64, warnings } = await exportToPptx(visibleSlides, frontmatter, activeTheme, settings.locale);
          await invoke('write_file_bytes', { path: coldExport.output, data: base64 });
          const lines = [`wrote '${coldExport.output}'`, ...warnings.map((w) => `warning: ${w}`)];
          await finish(lines.join('\n'));
          return;
        }
        const outcome = await runPdfExportCapture([...visibleSlides], coldExport.output, {});
        const lines = [`wrote '${coldExport.output}'`];
        if (outcome.usedFallback) {
          lines.push(`note: native PDF export failed, used raster fallback (${outcome.fallbackReason})`);
        }
        lines.push(...outcome.warnings.map((w) => `warning: ${w}`));
        await finish(lines.join('\n'));
      } catch (err) {
        await fail(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [coldExport, filePath, visibleSlides, frontmatter, activeTheme, settings.locale, runPdfExportCapture]);

  const handleExportHtml = useCallback(async () => {
    if (visibleSlides.length === 0) return;
    if (pdfExportContext !== null || printContext !== null) return;
    const defaultPath = filePath
      ? filePath.replace(/\.(md|markdown)$/i, '.html')
      : 'presentation.html';
    const target = await save({
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath,
    });
    if (!target) return;
    const savePath = target.toLowerCase().endsWith('.html') ? target : `${target}.html`;
    const visSlides = [...visibleSlides];
    pdfSlideRefs.current.clear();
    pdfSlideReadyCount.current = 0;
    pdfSlideReadyTotal.current = visSlides.length;
    await new Promise<void>(resolve => {
      pdfExportRunnerRef.current = async () => {
        try {
          const elements = Array.from(
            { length: visSlides.length },
            (_, i) => pdfSlideRefs.current.get(i),
          ).filter((el): el is HTMLElement => Boolean(el));

          const html = await buildPrintDocument(elements, aspectRatio, { fullBleed: true });
          await invoke('write_file', { path: savePath, content: html });
        } catch (err) {
          console.error('HTML export failed:', err);
          window.alert(t('app.htmlExportFailed', { error: String(err) }));
        } finally {
          setPdfExportContext(null);
          pdfSlideRefs.current.clear();
          pdfExportRunnerRef.current = null;
          resolve();
        }
      };
      setPdfExportContext({ slides: visSlides, savePath });
    });
  }, [visibleSlides, filePath, aspectRatio, t, pdfExportContext, printContext]);

  const handlePrint = useCallback(async () => {
    if (visibleSlides.length === 0) return;
    if (pdfExportContext !== null || printContext !== null) return;
    const visSlides = [...visibleSlides];
    printSlideRefs.current.clear();
    printSlideReadyCount.current = 0;
    printSlideReadyTotal.current = visSlides.length;
    await new Promise<void>(resolve => {
      printExportRunnerRef.current = async () => {
        try {
          const elements = Array.from(
            { length: visSlides.length },
            (_, i) => printSlideRefs.current.get(i),
          ).filter((el): el is HTMLElement => Boolean(el));
          const { warnings } = await printPresentation(elements, activeTheme, aspectRatio);
          if (warnings.length > 0) {
            window.alert(t('app.printCompleteWithWarnings', { count: warnings.length, warnings: warnings.join('\n') }));
          }
        } catch (err) {
          console.error('Print failed:', err);
        } finally {
          setPrintContext(null);
          printSlideRefs.current.clear();
          printExportRunnerRef.current = null;
          resolve();
        }
      };
      setPrintContext({ slides: visSlides });
    });
  }, [visibleSlides, activeTheme, aspectRatio, t, pdfExportContext, printContext]);

  const handleCopyWithAssets = useCallback(async () => {
    if (!filePath) return;
    const defaultPath = filePath.replace(/\.(md|markdown)$/i, '') + '-copy.md';
    const target = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath,
    });
    if (!target) return;
    const destPath = target.toLowerCase().endsWith('.md') ? target : `${target}.md`;
    const src = contentRef.current;
    const seen = new Set<string>();
    const WEB_URL = /^(https?|data|asset|tauri):\/\//i;
    // Rust re-validates and is the real security boundary (asset refs must
    // resolve to a plain relative path under src/dest dir) — this just avoids
    // surfacing a Rust-side error for the common case of a malformed doc.
    const isLocalRelativeRef = (ref: string) => !ref.startsWith('/') && !ref.split(/[/\\]/).includes('..');
    for (const m of src.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const ref = decodeURIComponent(m[1]);
      if (!WEB_URL.test(ref) && isLocalRelativeRef(ref)) seen.add(ref);
    }
    for (const m of src.matchAll(/<img[^>]+src=["']([^"']+)["']/g)) {
      const ref = decodeURIComponent(m[1]);
      if (!WEB_URL.test(ref) && isLocalRelativeRef(ref)) seen.add(ref);
    }
    try {
      await invoke('copy_file_with_assets', {
        srcPath: filePath,
        content: src,
        destPath,
        assetRefs: Array.from(seen),
      });
    } catch (err) { console.error('Copy with assets failed:', err); }
  }, [filePath]);

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

  const handleSlideReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setContent((prev) => {
      const fmMatch = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const fmBlock = fmMatch ? fmMatch[0] : '';
      const body = prev.slice(fmBlock.length);
      const segments = body.split(/^---$/m);
      if (fromIndex < 0 || fromIndex >= segments.length || toIndex < 0 || toIndex >= segments.length) return prev;
      const reordered = [...segments];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      // Trim each segment and rejoin with normalized separators so the result
      // is always valid regardless of which segment ends up at which position.
      return fmBlock + reordered.map((s) => s.trim()).join('\n\n---\n\n') + '\n';
    });
    setIsDirty(true);
    setCurrentSlideIndex(toIndex);
    setTimeout(() => editorRef.current?.scrollToSlide(toIndex), 50);
  }, []);

  const handleDuplicateSlide = useCallback((index: number) => {
    setContent((prev) => {
      const fmMatch = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const fmBlock = fmMatch ? fmMatch[0] : '';
      const body = prev.slice(fmBlock.length);
      const segments = body.split(/^---$/m);
      if (index < 0 || index >= segments.length) return prev;
      const next = [...segments];
      next.splice(index + 1, 0, segments[index]);
      return fmBlock + next.map((s) => s.trim()).join('\n\n---\n\n') + '\n';
    });
    setIsDirty(true);
    setCurrentSlideIndex(index + 1);
    setTimeout(() => editorRef.current?.scrollToSlide(index + 1), 50);
  }, []);

  const handleNewSlide = useCallback((index: number) => {
    setContent((prev) => {
      const fmMatch = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const fmBlock = fmMatch ? fmMatch[0] : '';
      const body = prev.slice(fmBlock.length);
      const segments = body.split(/^---$/m);
      if (index < 0 || index >= segments.length) return prev;
      const next = [...segments];
      next.splice(index + 1, 0, '');
      return fmBlock + next.map((s) => s.trim()).join('\n\n---\n\n') + '\n';
    });
    setIsDirty(true);
    setCurrentSlideIndex(index + 1);
    setTimeout(() => editorRef.current?.scrollToSlide(index + 1), 50);
  }, []);

  const handleDeleteSlide = useCallback((index: number) => {
    setContent((prev) => {
      const fmMatch = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const fmBlock = fmMatch ? fmMatch[0] : '';
      const body = prev.slice(fmBlock.length);
      const segments = body.split(/^---$/m);
      if (index < 0 || index >= segments.length || segments.length <= 1) return prev;
      const next = [...segments];
      next.splice(index, 1);
      return fmBlock + next.map((s) => s.trim()).join('\n\n---\n\n') + '\n';
    });
    setIsDirty(true);
    const newIndex = Math.max(0, Math.min(index, slides.length - 2));
    setCurrentSlideIndex(newIndex);
    setTimeout(() => editorRef.current?.scrollToSlide(newIndex), 50);
  }, [slides.length]);

  const handleToggleHidden = useCallback((index: number) => {
    setContent((prev) => {
      const fmMatch = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const fmBlock = fmMatch ? fmMatch[0] : '';
      const body = prev.slice(fmBlock.length);
      // Edit ONLY the target segment; keep every other segment + the `---`
      // delimiters byte-identical so the parser's positional cache still hits
      // for unchanged slides (no thumbnail remount → scroll position preserved).
      const segments = body.split(/^---$/m);
      if (index < 0 || index >= segments.length) return prev;
      const seg = segments[index];
      segments[index] = /<!--\s*hidden\s*-->/.test(seg)
        ? seg.replace(/[ \t]*<!--\s*hidden\s*-->[ \t]*\r?\n?/, '')
        : seg.replace(/^(\s*)/, '$1<!-- hidden -->\n');
      return fmBlock + segments.join('---');
    });
    setIsDirty(true);
  }, []);

  const handleWarn = useCallback((msg: string) => {
    setWarnMessage(msg);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setWarnMessage(null), 6000);
  }, []);

  function setSlideBackgroundInRaw(raw: string, src: string | null): string {
    // Keep formatting stable: only touch bg lines; keep other lines byte-identical.
    const lines = raw.split('\n');
    const out: string[] = [];
    let inFence = false;
    let handled = false;

    for (const line of lines) {
      const t = line.trim();
      if (/^(`{3,}|~{3,})/.test(t)) {
        inFence = !inFence;
        out.push(line);
        continue;
      }
      if (!inFence) {
        const parsed = parseBgLine(t);
        if (parsed) {
          if (src && !handled) {
            const indent = line.match(/^\s*/)?.[0] ?? '';
            out.push(`${indent}${formatBgLine({ ...parsed, src })}`);
          }
          handled = true;
          continue; // remove original bg line(s)
        }
      }
      out.push(line);
    }

    if (src && !handled) {
      // Insert near the top, after leading blanks and a `<!-- hidden -->` marker if present.
      let i = 0;
      while (i < out.length && out[i].trim() === '') i++;
      if ((out[i]?.trim() ?? '') === '<!-- hidden -->') i++;
      out.splice(i, 0, formatBgLine({ src, size: 'cover' }));
      if (out[i + 1] && out[i + 1].trim() !== '') out.splice(i + 1, 0, '');
    }

    return out.join('\n');
  }

  const handleSetSlideBackground = useCallback(async (index: number) => {
    if (!filePath) {
      handleWarn(t('editor.saveFirstDropMedia'));
      return;
    }
    const selected = await open({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return;

    const relPath = await resolveImagePathForMarkdown(selected, filePath, handleWarn);
    if (!relPath) return;

    setContent((prev) => {
      const fmMatch = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const fmBlock = fmMatch ? fmMatch[0] : '';
      const body = prev.slice(fmBlock.length);
      // Edit ONLY the target segment; keep every other segment + the `---`
      // delimiters byte-identical so the parser's positional cache still hits.
      const segments = body.split(/^---$/m);
      if (index < 0 || index >= segments.length) return prev;
      segments[index] = setSlideBackgroundInRaw(segments[index], relPath);
      return fmBlock + segments.join('---');
    });
    setIsDirty(true);
    setCurrentSlideIndex(index);
    setTimeout(() => editorRef.current?.scrollToSlide(index), 50);
  }, [filePath, handleWarn, t]);

  const handleClearSlideBackground = useCallback((index: number) => {
    setContent((prev) => {
      const fmMatch = prev.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const fmBlock = fmMatch ? fmMatch[0] : '';
      const body = prev.slice(fmBlock.length);
      const segments = body.split(/^---$/m);
      if (index < 0 || index >= segments.length) return prev;
      segments[index] = setSlideBackgroundInRaw(segments[index], null);
      return fmBlock + segments.join('---');
    });
    setIsDirty(true);
    setCurrentSlideIndex(index);
    setTimeout(() => editorRef.current?.scrollToSlide(index), 50);
  }, []);

  const openFindDialog = useCallback(() => {
    setFindOpen(true);
    setTimeout(() => findInputRef.current?.select(), 0);
  }, []);

  const runFind = useCallback((dir: 1 | -1 = 1) => {
    if (findMode === 'slide') {
      const trimmed = findQuery.trim();
      if (!/^\d+$/.test(trimmed)) return;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 1 || n > slides.length) return;
      const idx = n - 1;
      setCurrentSlideIndex(idx);
      setTimeout(() => editorRef.current?.scrollToSlide(idx), 50);
      setFindOpen(false);
      editorRef.current?.focus();
      return;
    }
    editorRef.current?.findNext(findQuery, dir);
  }, [findMode, findQuery, slides.length]);

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

  // Apply UI scale via the --ui-scale var (drives `html { zoom }` in global.css)
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  }, [settings.uiScale]);

  // handleSave gets a new identity on every keystroke (it depends on `content`
  // via buildSaveContent). A ref lets the autosave timer below call the latest
  // save logic without including that ever-changing identity in its own
  // dependency array — see the effect's comment for why that matters.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  // ── macOS native menu bar ──────────────────────────────────────────────────
  // Latest menu actions, refreshed every render. The native menu is rebuilt only
  // when `recents` changes, so its items delegate through this ref (below) to
  // always run current logic without rebuilding on every keystroke.
  const menuHandlersRef = useRef<MacMenuHandlers>({} as MacMenuHandlers);
  menuHandlersRef.current = {
    newFile: handleNewFile,
    openFile: handleOpenFile,
    openRecent: handleMarkdownDrop,
    clearRecent: () => { clearRecentFiles(); setRecents([]); },
    save: handleSave,
    saveAs: () => { void handleSaveAs(); },
    import: () => guardDirty(() => setShowImport(true)),
    importUrl: () => guardDirty(() => setShowImportUrl(true)),
    importMarp: handleImportMarp,
    export: handleExport,
    exportPdf: () => { setPdfPerPage(1); setPdfNotesOn(false); setPdfOptionsOpen(true); },
    exportHtml: handleExportHtml,
    print: handlePrint,
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
  const stableMenuHandlers = useRef<MacMenuHandlers>({
    newFile: () => menuHandlersRef.current.newFile(),
    openFile: () => menuHandlersRef.current.openFile(),
    openRecent: (p) => menuHandlersRef.current.openRecent(p),
    clearRecent: () => menuHandlersRef.current.clearRecent(),
    save: () => menuHandlersRef.current.save(),
    saveAs: () => menuHandlersRef.current.saveAs(),
    import: () => menuHandlersRef.current.import(),
    importUrl: () => menuHandlersRef.current.importUrl(),
    importMarp: () => menuHandlersRef.current.importMarp(),
    export: () => menuHandlersRef.current.export(),
    exportPdf: () => menuHandlersRef.current.exportPdf(),
    exportHtml: () => menuHandlersRef.current.exportHtml(),
    print: () => menuHandlersRef.current.print(),
    present: () => menuHandlersRef.current.present(),
    toggleInspector: () => menuHandlersRef.current.toggleInspector(),
    openSettings: () => menuHandlersRef.current.openSettings(),
    installCli: () => menuHandlersRef.current.installCli(),
  }).current;

  useEffect(() => {
    if (!isMac) return;
    void buildMacMenu(stableMenuHandlers, recents, {
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
  }, [recents, stableMenuHandlers, t]);

  // File association: open files delivered via double-click / "Open With".
  // On macOS, paths arrive via RunEvent::Opened; on Linux/Windows, via CLI arg
  // buffered in lib.rs setup. Drain on mount, then listen for live macOS opens.
  // Opens the first path only — single-window editor, no tabs.
  useEffect(() => {
    invoke<string[]>('take_pending_open')
      .then((paths) => { if (paths[0]) handleMarkdownDrop(paths[0]); })
      .catch(() => {});
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

  useEffect(() => {
    const sc = (id: string) => getCombo(keybindings.combos, id);
    const handler = (e: KeyboardEvent) => {
      if (presentMode) return;
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
  }, [presentMode, keybindings.combos, filePath, slides.length, safeSlideIndex, handleNewFile, handleOpenFile, handleSave, handleSaveAs, toggleFocusMode, handlePresentEnter, handleToggleHidden]);

  // Close menus when the user clicks outside them.
  useEffect(() => {
    if (!fileMenuOpen) {
      setImportSubmenuOpen(false);
      setExportSubmenuOpen(false);
      setRecentSubmenuOpen(false);
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [fileMenuOpen]);

  useEffect(() => {
    if (!editMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) {
        setEditMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editMenuOpen]);


  const presentationOverlays = (
    <>
      {presentMode && (
        <PresentationOverlay
          slides={visibleSlides}
          currentIndex={safePresentIndex}
          theme={activeTheme}
          docTitle={docTitle}
          docDate={docDate}
          aspectRatio={aspectRatio}
          laserColor={settings.laserColor}
          showTimer={settings.presenterShowTimer}
          onNavigate={setPresentIndex}
          onExit={handlePresentExit}
        />
      )}
      {presenterMode && (
        <PresenterOverlay
          slides={visibleSlides}
          currentIndex={safePresentIndex}
          theme={activeTheme}
          docTitle={docTitle}
          docDate={docDate}
          aspectRatio={aspectRatio}
          showNextSlide={settings.presenterShowNextSlide}
          showTimer={settings.presenterShowTimer}
          notesFontSize={settings.presenterNotesFontSize}
          laserColor={settings.laserColor}
          onNavigate={setPresentIndex}
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
      </I18nProvider>
    );
  }

  return (
    <I18nProvider locale={settings.locale}>
    <div className="app">
      {fileDragOver && !presentMode && !presenterMode && (
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
      <div className="app-toolbar">
        {/* macOS uses native traffic lights (titleBarStyle: Overlay) + the native
            menu bar, so reserve a draggable strip for the lights and drop the
            custom window buttons + in-window File/Edit menus here. */}
        {isMac && <div className="mac-traffic-pad" data-tauri-drag-region />}
        {!isMac && <div className="btn-group" ref={fileMenuRef}>
          <button className="btn" onClick={() => setFileMenuOpen((o) => !o)}>
            {t('app.menuFile')}
          </button>
          {fileMenuOpen && (
            <div className="btn-group-menu">
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setFileMenuOpen(false); handleNewFile(); }}>
                {t('app.menuNew')} <span>{formatCombo(getCombo(keybindings.combos, 'newFile'))}</span>
              </button>
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setFileMenuOpen(false); handleOpenFile(); }}>
                {t('app.menuOpen')} <span>{formatCombo(getCombo(keybindings.combos, 'openFile'))}</span>
              </button>
              <div style={{ position: 'relative' }} onMouseEnter={() => setRecentSubmenuOpen(true)} onMouseLeave={() => setRecentSubmenuOpen(false)}>
                <button
                  className="btn-group-menu-item btn-group-menu-item--shortcut"
                  aria-haspopup="true"
                  aria-expanded={recentSubmenuOpen}
                  onClick={() => setRecentSubmenuOpen((p) => !p)}
                  onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') setRecentSubmenuOpen(true); }}
                >
                  {t('app.menuOpenRecent')} <span>›</span>
                </button>
                {recentSubmenuOpen && (
                  <div className="btn-group-menu btn-group-menu--sub">
                    {recents.length === 0 ? (
                      <button className="btn-group-menu-item" disabled>{t('app.menuNoRecentFiles')}</button>
                    ) : (
                      <>
                        {recents.map((p) => (
                          <button
                            key={p}
                            className="btn-group-menu-item"
                            title={p}
                            onClick={() => { setFileMenuOpen(false); menuHandlersRef.current.openRecent(p); }}
                          >
                            {recentFileMenuLabel(p, recents)}
                          </button>
                        ))}
                        <div className="btn-group-menu-separator" />
                        <button
                          className="btn-group-menu-item"
                          onClick={() => { setFileMenuOpen(false); menuHandlersRef.current.clearRecent(); }}
                        >
                          {t('app.menuClearMenu')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative' }} onMouseEnter={() => setImportSubmenuOpen(true)} onMouseLeave={() => setImportSubmenuOpen(false)}>
                <button
                  className="btn-group-menu-item btn-group-menu-item--shortcut"
                  aria-haspopup="true"
                  aria-expanded={importSubmenuOpen}
                  onClick={() => setImportSubmenuOpen((p) => !p)}
                  onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') setImportSubmenuOpen(true); }}
                >
                  {t('app.menuImport')} <span>›</span>
                </button>
                {importSubmenuOpen && (
                  <div className="btn-group-menu btn-group-menu--sub">
                    <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); guardDirty(() => setShowImport(true)); }}>
                      {t('app.menuImportFromPowerPoint')}
                    </button>
                    <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); guardDirty(() => setShowImportUrl(true)); }}>
                      {t('app.menuImportFromUrl')}
                    </button>
                    <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); handleImportMarp(); }}>
                      {t('app.menuImportFromMarp')}
                    </button>
                  </div>
                )}
              </div>
              <div className="btn-group-menu-separator" />
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" disabled={!filePath || !isDirty} onClick={() => { setFileMenuOpen(false); handleSave(); }}>
                {t('app.menuSave')} <span>{formatCombo(getCombo(keybindings.combos, 'save'))}</span>
              </button>
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" disabled={!content} onClick={() => { setFileMenuOpen(false); handleSaveAs(); }}>
                {t('app.menuSaveAs')} <span>{formatCombo(getCombo(keybindings.combos, 'saveAs'))}</span>
              </button>
              <button className="btn-group-menu-item" disabled={!filePath} onClick={() => { setFileMenuOpen(false); handleCopyWithAssets(); }}>
                {t('app.menuCopyWithAssets')}
              </button>
              <div className="btn-group-menu-separator" />
              <div style={{ position: 'relative' }} onMouseEnter={() => setExportSubmenuOpen(true)} onMouseLeave={() => setExportSubmenuOpen(false)}>
                <button
                  className="btn-group-menu-item btn-group-menu-item--shortcut"
                  aria-haspopup="true"
                  aria-expanded={exportSubmenuOpen}
                  disabled={slides.length === 0 || pdfExportContext !== null}
                  onClick={() => setExportSubmenuOpen((p) => !p)}
                  onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') setExportSubmenuOpen(true); }}
                >
                  {t('app.menuExport')} <span>›</span>
                </button>
                {exportSubmenuOpen && (
                  <div className="btn-group-menu btn-group-menu--sub">
                    <button className="btn-group-menu-item" disabled={slides.length === 0 || pdfExportContext !== null} onClick={() => { setFileMenuOpen(false); handleExport(); }}>
                      {t('app.menuExportPowerpoint')}
                    </button>
                    <button className="btn-group-menu-item" disabled={slides.length === 0 || pdfExportContext !== null} onClick={() => { setFileMenuOpen(false); setPdfPerPage(1); setPdfNotesOn(false); setPdfOptionsOpen(true); }}>
                      {pdfExportContext ? t('app.menuExportingPdf') : t('app.menuExportPdf')}
                    </button>
                    <button className="btn-group-menu-item" disabled={slides.length === 0 || pdfExportContext !== null} onClick={() => { setFileMenuOpen(false); handleExportHtml(); }}>
                      {pdfExportContext ? t('app.menuExporting') : t('app.menuExportHtml')}
                    </button>
                  </div>
                )}
              </div>
              <button className="btn-group-menu-item" disabled={slides.length === 0 || pdfExportContext !== null || printContext !== null} onClick={() => { setFileMenuOpen(false); handlePrint(); }}>
                {printContext ? t('app.menuPreparingPrint') : t('app.menuPrint')}
              </button>
              <div className="btn-group-menu-separator" />
              <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); guardDirty(actuallyCloseWindow); }}>
                {t('app.menuExit')}
              </button>
            </div>
          )}
        </div>}
        {!isMac && <div className="btn-group" ref={editMenuRef}>
          <button className="btn" onClick={() => setEditMenuOpen((o) => !o)}>
            {t('app.menuEdit')}
          </button>
          {editMenuOpen && (
            <div className="btn-group-menu">
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); editorRef.current?.undo(); }}>
                {t('app.menuUndo')} <span>{formatCombo('ctrl+z')}</span>
              </button>
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); editorRef.current?.redo(); }}>
                {t('app.menuRedo')} <span>{formatCombo(isMac ? 'meta+shift+z' : 'ctrl+y')}</span>
              </button>
              <div className="btn-group-menu-separator" />
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); setTimeout(() => { editorRef.current?.focus(); document.execCommand('cut'); }, 0); }}>
                {t('app.menuCut')} <span>{formatCombo('ctrl+x')}</span>
              </button>
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); setTimeout(() => { editorRef.current?.focus(); document.execCommand('copy'); }, 0); }}>
                {t('app.menuCopy')} <span>{formatCombo('ctrl+c')}</span>
              </button>
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); setTimeout(() => { editorRef.current?.focus(); document.execCommand('paste'); }, 0); }}>
                {t('app.menuPaste')} <span>{formatCombo('ctrl+v')}</span>
              </button>
              <div className="btn-group-menu-separator" />
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); editorRef.current?.selectAll(); }}>
                {t('app.menuSelectAll')} <span>{formatCombo('ctrl+a')}</span>
              </button>
              <div className="btn-group-menu-separator" />
              <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); openFindDialog(); }}>
                {t('editor.findDialogTitle')} <span>{formatCombo('ctrl+f')}</span>
              </button>
            </div>
          )}
        </div>}
        <div className="toolbar-spacer" data-tauri-drag-region />
        {isRenaming ? (
          <input
            className="toolbar-doctitle toolbar-doctitle--editing"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleRenameCommit(); }
              if (e.key === 'Escape') { e.preventDefault(); setIsRenaming(false); }
            }}
          />
        ) : (
          <div
            className="toolbar-doctitle"
            onDoubleClick={() => {
              if (!filePath) return;
              const base = filePath.split(/[/\\]/).pop() ?? '';
              setRenameValue(base.replace(/\.(md|markdown)$/i, ''));
              setIsRenaming(true);
            }}
          >
            {filePath ? filePath.split(/[\\/]/).pop() : t('app.untitledFilename')}{isDirty ? ' *' : ''}
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={handlePresentEnter}
          disabled={slides.length === 0}
          title={t('app.presentButtonTitle')}
        >{t('app.presentButton')}</button>
        <button
          className="wm-btn"
          onClick={toggleFocusMode}
          title={focusMode
            ? t('app.exitFocusMode', { combo: formatCombo(getCombo(keybindings.combos, 'focusMode')) })
            : t('app.enterFocusMode', { combo: formatCombo(getCombo(keybindings.combos, 'focusMode')) })}
          style={{ marginLeft: 4, color: focusMode ? 'var(--accent)' : undefined }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
            <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
            <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
            <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
          </svg>
        </button>
        <button
          className={`wm-btn${showInspector ? ' wm-btn--active' : ''}`}
          onClick={() => setShowInspector((v) => !v)}
          title={t('app.toggleInspector')}
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
          title={t('app.settingsButtonTitle')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        {!isMac && (
          <div className="wm-controls">
            <button
              className="wm-btn"
              onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().minimize(); }}
              title={t('app.minimise')}
            >
              <svg width="12" height="2" viewBox="0 0 12 2"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
            </button>
            <button
              className="wm-btn"
              onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().toggleMaximize(); }}
              title={t('app.maximiseRestore')}
            >
              <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
            <button
              className="wm-btn wm-btn--close"
              onMouseDown={(e) => {
                e.preventDefault();
                guardDirty(actuallyCloseWindow);
              }}
              title={t('app.windowClose')}
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
          <Panel id="thumb" panelRef={thumbPanelRef} defaultSize={22} minSize={8} collapsible>
            <ThumbnailPanel
              slides={slides}
              currentIndex={safeSlideIndex}
              onSelect={handleThumbnailSelect}
              onReorder={handleSlideReorder}
              onDuplicate={handleDuplicateSlide}
              onNewSlide={handleNewSlide}
              onToggleHidden={handleToggleHidden}
              onSetBackground={handleSetSlideBackground}
              onClearBackground={handleClearSlideBackground}
              onDelete={handleDeleteSlide}
              theme={activeTheme}
              docTitle={docTitle}
              docDate={docDate}
              aspectRatio={aspectRatio}
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
              onRequestFind={openFindDialog}
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

      {findOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
          onMouseDown={(e) => { e.preventDefault(); setFindOpen(false); editorRef.current?.focus(); }}
        >
          <div
            role="dialog"
            aria-label={t('editor.findDialogTitle')}
            onMouseDown={(e) => e.stopPropagation()}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setFindOpen(false);
                editorRef.current?.focus();
              }
            }}
            style={{
              position: 'fixed',
              left: '50%',
              top: 18,
              transform: 'translateX(-50%)',
              width: 420,
              maxWidth: 'calc(100vw - 32px)',
              padding: 10,
              borderRadius: 10,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-alt)',
              boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{t('editor.findDialogTitle')}</div>
              <button
                className="btn"
                onClick={() => { setFindOpen(false); editorRef.current?.focus(); }}
                aria-label={t('common.close')}
              >{t('common.close')}</button>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="find-mode"
                  checked={findMode === 'text'}
                  onChange={() => setFindMode('text')}
                />
                {t('editor.findModeText')}
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="find-mode"
                  checked={findMode === 'slide'}
                  onChange={() => {
                    setFindMode('slide');
                    setFindQuery((q) => q.replace(/\D+/g, ''));
                  }}
                />
                {t('editor.findModeSlide')}
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={findInputRef}
                value={findQuery}
                placeholder={findMode === 'slide'
                  ? t('editor.findPlaceholderSlide', { total: slides.length })
                  : t('editor.findPlaceholderText')}
                onChange={(e) => {
                  const next = e.target.value;
                  setFindQuery(findMode === 'slide' ? next.replace(/\D+/g, '') : next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); editorRef.current?.focus(); }
                  if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? -1 : 1); }
                }}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              {findMode === 'text' ? (
                <>
                  <button
                    className="btn"
                    onClick={() => runFind(-1)}
                  >
                    {t('editor.findPrevious')}
                  </button>
                  <button
                    className="btn btn--primary"
                    onClick={() => runFind(1)}
                  >
                    {t('editor.findNext')}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn--primary"
                  onClick={() => runFind(1)}
                >
                  {t('common.ok')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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

      {marpPrompt && (
        <InfoBanner
          message={t('app.marpDetected')}
          actions={[{
            label: t('app.marpConvert'),
            onClick: async () => {
              const { text, dir } = marpPrompt;
              const { markdown, dropped } = importMarp(text);
              setMarpPrompt(null);
              await invoke('stop_watching').catch(() => {});
              await applyFileContent(markdown, '');
              setImportDir(dir);
              setMarpLoss(dropped.length);
            },
          }]}
          onDismiss={() => setMarpPrompt(null)}
        />
      )}
      {marpLoss != null && marpLoss > 0 && (
        <InfoBanner
          message={t('app.marpImported', { count: marpLoss })}
          onDismiss={() => setMarpLoss(null)}
        />
      )}

      {missingThemeId && (
        <MissingThemeBanner
          themeId={missingThemeId}
          onInstalled={handleMissingThemeInstalled}
          onDismiss={() => setMissingThemeId(null)}
        />
      )}


      {warnMessage && (
        <div style={{
          position: 'fixed', bottom: 36, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-elevated)', border: '1px solid var(--dirty-color)',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 3000,
          padding: '10px 16px', fontSize: 12, color: 'var(--dirty-color)',
          maxWidth: 480, textAlign: 'center', pointerEvents: 'none', whiteSpace: 'pre-wrap',
        }}>
          {warnMessage}
        </div>
      )}

      {showExternalChangeDialog && (
        <ModalShell
          onClose={() => setShowExternalChangeDialog(false)}
          dismissOnBackdropClick={false}
          dismissOnEscape={false}
          width={340}
          maxWidth="90vw"
          ariaLabel={t('app.fileChangedExternally')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('app.fileChangedExternally')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              {isDirty
                ? t('app.fileChangedExternallyDirty')
                : t('app.fileChangedExternallyClean')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {isDirty && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      // Use the path captured when the dialog opened, not the
                      // current filePathRef — the user may have navigated away.
                      const path = externalChangePathRef.current;
                      setShowExternalChangeDialog(false);
                      if (!path) return;
                      try {
                        const newContent: string = await invoke('read_file', { path });
                        syncThemeFromContent(newContent);
                        setContent(newContent);
                        setIsDirty(false);
                        diskContentRef.current = newContent;
                      } catch (err) { console.error('Failed to reload file:', err); }
                    }}
                  >{t('common.reload')}</button>
                  <button
                    className="btn"
                    onClick={async () => {
                      setShowExternalChangeDialog(false);
                      await handleSaveAs();
                    }}
                  >{t('common.saveAs')}</button>
                </>
              )}
              {!isDirty && (
                <button className="btn btn-primary" onClick={() => setShowExternalChangeDialog(false)}>
                  {t('common.ok')}
                </button>
              )}
            </div>
        </ModalShell>
      )}

      {pdfOptionsOpen && (
        <ModalShell
          onClose={() => setPdfOptionsOpen(false)}
          width={360}
          maxWidth="90vw"
          ariaLabel={t('app.exportPdfTitle')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
              {t('app.exportPdfTitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-label)', marginBottom: 8 }}>{t('app.slidesPerPage')}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[1, 2, 4, 6].map((n) => (
                <button
                  key={n}
                  className={pdfPerPage === n ? 'btn btn-primary' : 'btn'}
                  style={{ flex: 1 }}
                  onClick={() => { setPdfPerPage(n); if (n !== 1) setPdfNotesOn(false); }}
                >{n}</button>
              ))}
            </div>
            {(() => {
              const hasNotes = visibleSlides.some((s) => s.speakerNotes.trim());
              const notesOk = pdfPerPage === 1 && hasNotes;
              return (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: notesOk ? 'var(--text-primary)' : 'var(--text-secondary)', opacity: notesOk ? 1 : 0.5, marginBottom: 20 }}>
                  <input
                    type="checkbox"
                    checked={notesOk && pdfNotesOn}
                    disabled={!notesOk}
                    onChange={(e) => setPdfNotesOn(e.target.checked)}
                  />
                  {t('app.includeSpeakerNotes', { noneNote: pdfPerPage === 1 && !hasNotes ? t('app.includeSpeakerNotesNone') : '' })}
                </label>
              );
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setPdfOptionsOpen(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setPdfOptionsOpen(false);
                  const notes = pdfPerPage === 1 && pdfNotesOn ? visibleSlides.map((s) => s.speakerNotes) : undefined;
                  void handleExportPdf({ perPage: pdfPerPage, notes, paper: settings.pdfPageSize });
                }}
              >{t('app.exportAction')}</button>
            </div>
        </ModalShell>
      )}

      {confirmCloseAction && (
        <ModalShell
          onClose={() => setConfirmCloseAction(null)}
          width={320}
          maxWidth="90vw"
          ariaLabel={t('app.unsavedChangesTitle')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('app.unsavedChangesTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              {t('app.unsavedChangesMessage')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmCloseAction(null)}>{t('common.cancel')}</button>
              <button
                className="btn"
                style={{ background: '#c0392b', borderColor: '#c0392b', color: '#fff' }}
                onClick={() => { const a = confirmCloseAction; setConfirmCloseAction(null); a(); }}
              >{t('common.discard')}</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const action = confirmCloseAction;
                  setConfirmCloseAction(null);
                  if (filePath) {
                    await handleSave();
                  } else {
                    const saved = await handleSaveAs();
                    if (!saved) return;
                  }
                  action?.();
                }}
              >{t('common.save')}</button>
            </div>
        </ModalShell>
      )}

      {dropConfirmPath && (
        <ModalShell
          onClose={() => setDropConfirmPath(null)}
          width={340}
          maxWidth="90vw"
          ariaLabel={t('app.openFileTitle')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('app.openFileTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              {t('app.openFileReplaceWarningPrefix')} <strong>{recentFileBasename(dropConfirmPath)}</strong> {t('app.openFileReplaceWarningSuffix')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setDropConfirmPath(null)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const path = dropConfirmPath;
                  setDropConfirmPath(null);
                  try {
                    await invoke('stop_watching').catch(() => {});
                    const text: string = await invoke('read_file', { path });
                    await applyFileContent(text, path);
                  } catch (err) {
                    console.error('Drop open failed:', err);
                    setRecents(removeRecentFile(path));
                  }
                }}
              >{t('common.open')}</button>
            </div>
        </ModalShell>
      )}

      {/* Off-screen slide rendering for Print */}
      {printContext && (() => {
        const SLIDE_W = 960;
        const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);
        return (
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: -99999,
              left: -99999,
              width: SLIDE_W,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'none',
            }}
          >
            {printContext.slides.map((slide, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) printSlideRefs.current.set(i, el);
                  else printSlideRefs.current.delete(i);
                }}
                style={{ width: SLIDE_W, height: slideH, flexShrink: 0, overflow: 'hidden' }}
              >
                <SlideRenderer
                  slide={slide}
                  theme={activeTheme}
                  slideNumber={i + 1}
                  totalSlides={printContext.slides.length}
                  docTitle={docTitle}
                  docDate={docDate}
                  onAllDiagramsReady={onPrintSlideReady.current}
                />
              </div>
            ))}
          </div>
        );
      })()}

      {/* Off-screen slide rendering for PDF export */}
      {pdfExportContext && (() => {
        const SLIDE_W = 960;
        const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);
        return (
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: -99999,
              left: -99999,
              width: SLIDE_W,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'none',
            }}
          >
            {pdfExportContext.slides.map((slide, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) pdfSlideRefs.current.set(i, el);
                  else pdfSlideRefs.current.delete(i);
                }}
                style={{ width: SLIDE_W, height: slideH, flexShrink: 0, overflow: 'hidden' }}
              >
                <SlideRenderer
                  slide={slide}
                  theme={activeTheme}
                  slideNumber={i + 1}
                  totalSlides={pdfExportContext.slides.length}
                  docTitle={docTitle}
                  docDate={docDate}
                  onAllDiagramsReady={onPdfSlideReady.current}
                />
              </div>
            ))}
          </div>
        );
      })()}
    </div>
    </I18nProvider>
  );
}
