import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
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
import { FileMenu } from './components/app/FileMenu';
import { EditMenu } from './components/app/EditMenu';
import { WindowControls } from './components/app/WindowControls';
import { Toolbar } from './components/app/Toolbar';
import { FindReplaceDialog } from './components/app/FindReplaceDialog';
import { AppDialogs } from './components/app/AppDialogs';
import { isMarp, importMarp } from './engine/import/marp';
import { parsePptx } from './engine/import/parsePptx';
import { pptxToMarkdown } from './engine/import/pptxToMarkdown';
import { toRawUrl } from './engine/import/toRawUrl';
import { IMAGE_DIALOG_FILTER } from './engine/mediaTypes';
import { basename, dirname, dirnameOn, pathSeparator, toForwardSlashes } from './engine/paths';
import { loadSettings, saveSettings, EDITOR_FONT_OPTIONS } from './store/settings';
import { setDiagramRenderer } from './engine/export/diagramRenderer';
import type { AppSettings } from './store/settings';
import { loadLastSession, saveLastSession } from './store/lastSession';
import { loadLastSeenVersion, saveLastSeenVersion } from './store/lastSeenVersion';
import { loadRecentFiles, addRecentFile, removeRecentFile, clearRecentFiles } from './store/recentFiles';
import { buildMacMenu, delegateMenuActions } from './macMenu';
import type { MenuActions } from './macMenu';
import { loadKeybindings, matchShortcut, getCombo, isMac } from './engine/keybindings';
import type { Keybindings } from './engine/keybindings';
import { I18nProvider, useLocaleTranslator, formatFallbackDate } from './i18n';

import { parseDocument, splitIntoRawSlides } from './engine/parser/markdownToSlides';
import { collectDiagnostics, formatCheckReport } from './engine/parser/diagnostics';
import { evaluateImportCheck } from './engine/cli/importCheckGate';
import { extractFrontmatter, patchFrontmatter, frontmatterBlockLength } from './engine/parser/frontmatter';
import { parseBgLine, formatBgLine } from './engine/parser/bgImage';
import { fetchUpdate } from './engine/updater';
import { APP_VERSION } from './version';
import { exportToPptx } from './engine/export/pptx';
import { BUILT_IN_THEMES, parseThemeYaml, resolveCustomThemeLibrary, sanitiseThemeOverrides, type ThemeOverridePatch, type ThemeLibrary } from './engine/theme';
import type { Slide, ListItem, Frontmatter } from './engine/types';
import { parseAspectRatio, nextAspectRatio } from './engine/types';
import { getSlideStepCount } from './engine/layout/steps';
import type { Theme } from './engine/theme';
import { useResolvedSlides } from './hooks/useResolvedSlides';
import { useFindReplace } from './hooks/useFindReplace';
import { useOffscreenCapture } from './hooks/useOffscreenCapture';
import { useExports } from './hooks/useExports';
import { useThemeState } from './hooks/useThemeState';
import { OffscreenDeck } from './components/OffscreenDeck';
import type { PendingCli, CliThemeArg, PendingImport, PendingExport } from './types/cli';

import './styles/global.css';

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
    const normalisedPath = toForwardSlashes(arg.path);
    const base = basename(normalisedPath);
    const dir = dirname(normalisedPath, undefined);
    // Load the installed library too so this file's own `extends:` can name
    // an installed custom theme, not just a built-in (issue #249) — matching
    // the `arg.type === 'name'` path below.
    let library: ThemeLibrary | undefined;
    try {
      const [libDir, entries] = await invoke<[string, Array<[string, string]>]>('load_custom_themes');
      library = { entries, dir: libDir };
    } catch { /* no installed themes available — extends still falls back to built-ins */ }
    const parsed = parseThemeYaml(`cli:${base.replace(/\.ya?ml$/i, '')}`, text, dir, undefined, library);
    if (!parsed.ok) return fail(`invalid theme '${arg.path}': ${parsed.error}`);
    return parsed.theme;
  }
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === arg.name);
  if (builtIn) return builtIn;
  try {
    const [dir, entries] = await invoke<[string, Array<[string, string]>]>('load_custom_themes');
    const idx = entries.findIndex(([id]) => id === arg.name);
    if (idx !== -1) {
      // Resolve the whole installed library together so extends: can target
      // another installed theme, not just a built-in (issue #249).
      const { results } = resolveCustomThemeLibrary(entries, dir);
      const parsed = results[idx];
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
    urlReachable: (url: string) =>
      invoke('probe_url', { url })
        .then(() => null)
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          return msg.replace(/^Error invoking command '[^']+':\s*/i, '');
        }),
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
      if (!(await gate(text, imp.input, dirname(imp.input)))) return;
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
      const parsed = await parsePptx(imp.input, dirname(imp.output));
      const markdown = pptxToMarkdown(parsed);
      if (!(await gate(markdown, imp.output, dirname(imp.output)))) return;
      await invoke('write_file', { path: imp.output, content: markdown });
      const lines = [`wrote '${imp.output}' (${parsed.slides.length} slides)`];
      for (const w of parsed.warnings) lines.push(`warning: ${w}`);
      await finish(lines.join('\n'));
      return;
    }
    // url — rewrite GitHub/GitLab/Bitbucket blob URLs to raw (same as ImportUrlModal).
    // Marp detection still happens on open, not on fetch.
    const text: string = await invoke('fetch_url_text', { url: toRawUrl(imp.input) });
    if (!(await gate(text, imp.output, dirname(imp.output)))) return;
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

// Shared by the 7 slide-editing handlers below: pulls the frontmatter block
// off `prev`, splits the body into per-slide segments via the *same*
// fence-aware splitIntoRawSlides the real parser uses (not a hand-rolled
// body.split(/^---$/m), which would mis-split on a literal '---' line
// inside a fenced code sample — segment N would then silently stop matching
// the slide the user actually sees as N), lets `edit` transform the segment
// array, and rejoins. `edit` returning null means "no-op" (e.g. an
// out-of-range index) and `prev` is returned unchanged. Module-level (not a
// hook/closure) since it has no dependency on component state — also makes
// it directly unit-testable without rendering the component.
//
// `rejoin: 'trim'` normalises each segment's surrounding whitespace — for
// operations that already restructure the segment list (reorder/duplicate/
// insert/delete), where exact byte preservation isn't meaningful since
// indices shift anyway.
// `rejoin: 'preserve'` keeps every segment's exact original bytes (only the
// edited segment's own text changes) — for in-place edits (toggle hidden,
// set/clear background), so every *other* segment stays byte-identical and
// the parser's positional cache still hits for them (no thumbnail remount /
// scroll-position loss on an unrelated slide's edit). splitIntoRawSlides
// strips each '---' boundary line rather than leaving it attached to a
// segment, so 'preserve' reinserts it with '\n---\n'.
export function editSlideSegments(
  prev: string,
  edit: (segments: string[]) => string[] | null,
  rejoin: 'trim' | 'preserve',
): string {
  const fmBlock = prev.slice(0, frontmatterBlockLength(prev));
  const body = prev.slice(fmBlock.length);
  const segments = splitIntoRawSlides(body);
  const next = edit(segments);
  if (next === null) return prev;
  return rejoin === 'trim'
    ? fmBlock + next.map((s) => s.trim()).join('\n\n---\n\n') + '\n'
    : fmBlock + next.join('\n---\n');
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
  // Wrapped in `{ run }` rather than storing the bare function: a bare
  // `useState<() => void>` makes `setConfirmCloseAction(action)` look correct
  // while actually invoking React's functional-updater form instead of
  // storing it. The wrapper removes that footgun entirely.
  const [confirmCloseAction, setConfirmCloseAction] = useState<{ run: () => void } | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null);
  const [keybindings, setKeybindings]     = useState<Keybindings>({ path: '', combos: {} });
  const [warnMessage, setWarnMessage]     = useState<string | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showExternalChangeDialog, setShowExternalChangeDialog] = useState(false);
  const [showExternalReloadBanner, setShowExternalReloadBanner] = useState(false);
  const [pdfOptionsOpen, setPdfOptionsOpen] = useState(false);
  const [pdfPerPage, setPdfPerPage]         = useState(1);
  const [pdfNotesOn, setPdfNotesOn]         = useState(false);
  const [isRenaming, setIsRenaming]       = useState(false);
  const [renameValue, setRenameValue]     = useState('');
  const [resolvedUiTheme, setResolvedUiTheme] = useState<'dark' | 'light'>('dark');
  const {
    context: offscreenContext,
    capturing,
    runCapture: runOffscreenCapture,
    onSlideReady: onOffscreenSlideReady,
    setSlideRef: setOffscreenSlideRef,
  } = useOffscreenCapture();
  const [fileDragOver, setFileDragOver]       = useState(false);
  const [dropConfirmPath, setDropConfirmPath] = useState<string | null>(null);
  const [showWhatsNew, setShowWhatsNew]       = useState(false);

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
  const editorBody = parsedFrontmatter.body;

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

  // useResolvedSlides swaps local media srcs from a placeholder (used while the
  // async read_file_b64 load is in flight) to data: URLs once loaded. The
  // placeholder is convertFileSrc's asset:// URL on macOS/Linux, but Windows'
  // WebView2 can't load custom schemes directly, so Tauri rewrites it there to
  // http://asset.localhost/... instead — both forms must be recognised or this
  // gate never fires on Windows, the platform the CLI export bug targets. A
  // cold-start CLI export can otherwise fire its capture the instant slides
  // resolve, racing that load — the button-triggered export never hits this
  // because by the time a user clicks it, the deck has been open long enough
  // for local media to have already resolved.
  const hasPendingLocalMedia = useMemo(() => {
    const isPending = (src: string) => src.startsWith('asset://') || src.startsWith('http://asset.localhost/');
    const htmlIsPending = (html: string) => /src="(?:asset:\/\/|http:\/\/asset\.localhost\/)/.test(html);
    const itemIsPending = (item: ListItem): boolean =>
      htmlIsPending(item.html) || item.children.some(itemIsPending);
    return visibleSlides.some((slide) => {
      if (slide.backgroundImage && isPending(slide.backgroundImage.src)) return true;
      return slide.elements.some((el) => {
        if (el.type === 'image' || el.type === 'video') return isPending(el.src);
        if (el.type === 'paragraph') return htmlIsPending(el.html);
        if (el.type === 'list') return el.items.some(itemIsPending);
        return false;
      });
    });
  }, [visibleSlides]);

  // Bounded wait for the gate above: if read_file_b64 fails for a missing or
  // mistyped path, that src never becomes a data: URL and hasPendingLocalMedia
  // would otherwise stay true forever, hanging a CLI export silently. This
  // timer is wall-clock (not dependent on further slide/media changes to
  // re-fire), so it still fires even if nothing else ever triggers a re-render.
  const MEDIA_WAIT_TIMEOUT_MS = 5_000;
  const [mediaWaitExpired, setMediaWaitExpired] = useState(false);
  useEffect(() => {
    if (!hasPendingLocalMedia) { setMediaWaitExpired(false); return; }
    const timer = setTimeout(() => setMediaWaitExpired(true), MEDIA_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hasPendingLocalMedia]);
  const safePresentIndex = visibleSlides.length > 0
    ? Math.min(presentIndex, visibleSlides.length - 1)
    : 0;
  // Defensive clamp mirrors safePresentIndex — a slide's step count can only
  // shrink out from under presentStep via a hot-reloaded/edited-while-cold-
  // presenting deck, but the overlays should never receive an out-of-range value.
  const safePresentStep = visibleSlides[safePresentIndex]
    ? Math.min(presentStep, getSlideStepCount(visibleSlides[safePresentIndex]))
    : 0;

  // {title} in header/footer templates falls back to the deck's cover slide
  // (first non-hidden H1) when frontmatter has no explicit `title:` — most
  // decks only ever get a title via a heading, never via frontmatter, and a
  // silently blank footer segment (issue #55) is worse than this guess.
  const docTitle = frontmatter.title ?? rawSlides.find((s) => !s.hidden && s.titleLevel === 1)?.title ?? '';
  const docAuthor = (frontmatter.author as string | undefined) ?? '';
  const docDate = (frontmatter.date as string | undefined) ?? formatFallbackDate(settings.locale);

  const aspectRatio = useMemo(
    () => parseAspectRatio(frontmatter.aspect_ratio as string | undefined),
    [frontmatter.aspect_ratio],
  );

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
        setShowExternalReloadBanner(true);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  // Both are stable (hook-owned ref and a [] useCallback): runs once.
  }, [cliThemeRef, syncThemeFromContent]);

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
      setConfirmCloseAction({ run: action });
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
      setMissingThemeId(null);
    });
  }, [guardDirty, settings.defaultThemeId, setActiveThemeId, setMissingThemeId]);

  // Cold-start present guards: the load must run once (applyFileContent's
  // identity changes re-run the drain effect) and presentation must be
  // entered exactly once (visibleSlides/handlePresentEnter identity changes
  // re-run the auto-enter effect).
  const coldLoadStartedRef = useRef(false);
  const coldEnterFiredRef = useRef(false);
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
  // Windows silently drops WS_EX_TOPMOST on various compositor/dialog
  // interactions, so a one-shot setAlwaysOnTop isn't enough — reassert it
  // on an interval for as long as the presenter window should stay on top.
  const alwaysOnTopIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAlwaysOnTopReassert = useCallback(() => {
    if (alwaysOnTopIntervalRef.current !== null) {
      clearInterval(alwaysOnTopIntervalRef.current);
      alwaysOnTopIntervalRef.current = null;
    }
  }, []);

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
    stopAlwaysOnTopReassert();
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
    await getCurrentWindow().setAlwaysOnTop(false).catch(() => {});
    isExitingRef.current = false;
  }, [slides, visibleSlides, safePresentIndex, coldPresent, stopAlwaysOnTopReassert]);

  // Moved above handlePresentEnter (originally declared much further down)
  // so its stable-identity useCallback can be listed in handlePresentEnter's
  // own dependency array without a temporal-dead-zone reference.
  const handleWarn = useCallback((msg: string) => {
    setWarnMessage(msg);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setWarnMessage(null), 6000);
  }, []);

  const handlePresentEnter = useCallback(async (eOrFromCurrent?: React.MouseEvent | boolean) => {
    if (visibleSlides.length === 0) return;
    isExitingRef.current = false;
    const sessionId = ++presentSessionRef.current;
    // "Present from current" — accepts a boolean (keyboard path) or a MouseEvent
    // (alt+click path). If a hidden slide is current, indexOf is -1 → first visible.
    const fromCurrent = typeof eOrFromCurrent === 'boolean' ? eOrFromCurrent : eOrFromCurrent?.altKey ?? false;
    const startIndex = fromCurrent ? Math.max(0, visibleSlides.indexOf(slides[safeSlideIndex])) : 0;
    setPresentIndex(startIndex);
    setPresentStep(0);

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
          step: 0,
          aspectRatio,
          docTitle,
          docAuthor,
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
          // present:ready never fired — window creation silently failed or its
          // content is hung. Mirrors the tauri://error and tauri://destroyed
          // handlers below (reset state, cold-start exits via cli_exit)
          // rather than just cleaning up the listener and leaving the app
          // stuck fullscreened with no audience window and no error shown.
          if (presentSessionRef.current !== sessionId) return; // stale session
          unlistenReady?.();
          audienceWin.close().catch(() => {});
          stopAlwaysOnTopReassert();
          if (coldPresentRef.current) {
            invoke('set_wake_lock', { active: false }).catch(() => {});
            invoke('cli_exit', {
              message: 'presentation window did not respond in time',
              code: 1,
            }).catch(() => {});
            return;
          }
          setPresentMode(false);
          setPresenterMode(false);
          getCurrentWindow().setFullscreen(false).catch(() => {});
          getCurrentWindow().setAlwaysOnTop(false).catch(() => {});
          handleWarn(t('presentation.audienceWindowTimeout'));
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
          stopAlwaysOnTopReassert();
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
          getCurrentWindow().setAlwaysOnTop(false).catch(() => {});
        }).catch(() => {});

        // If the audience window is closed externally (compositor, Alt+F4, etc.),
        // exit presentation mode so the main window doesn't stay stuck fullscreened.
        // The sessionId guard ensures a stale handler from a previous session
        // (triggered by closing a leftover window at the start of a new session)
        // does not reset state that the new session just set.
        audienceWin.once('tauri://destroyed', () => {
          if (isExitingRef.current) return; // normal exit already in progress
          if (presentSessionRef.current !== sessionId) return; // stale session
          stopAlwaysOnTopReassert();
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
          getCurrentWindow().setAlwaysOnTop(false).catch(() => {});
        }).catch(() => {});

        if (mode === 'dual') {
          setPresenterMode(true);
          if (settings.presenterWindowed) {
            // A maximized frameless window is visually indistinguishable from
            // fullscreen (no title bar, taskbar often auto-hidden), and it
            // can't be placed alongside another window as the setting promises
            // — so un-maximize rather than just skipping setFullscreen.
            if (await getCurrentWindow().isMaximized().catch(() => false)) {
              await getCurrentWindow().unmaximize().catch(() => {});
            }
            if (settings.presenterAlwaysOnTop) {
              stopAlwaysOnTopReassert();
              await getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
              alwaysOnTopIntervalRef.current = setInterval(() => {
                getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
              }, 2000);
            }
          } else {
            await getCurrentWindow().setFullscreen(true).catch(() => {});
          }
          return;
        }
        // Mirror: audience window shows slide, main window also fullscreens with normal overlay
      }
      // Fall through to single if no external monitor
    }

    setPresentMode(true);
    await getCurrentWindow().setFullscreen(true).catch(() => {});
  }, [slides, visibleSlides, safeSlideIndex, activeTheme, aspectRatio, docTitle, docDate, settings.presentationMode, settings.presenterWindowed, settings.presenterAlwaysOnTop, handleWarn, t, stopAlwaysOnTopReassert]);

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
  }, [setActiveThemeId]);

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
      // 16:9 is the default, so cycling back to it removes the key.
      const nextAr = nextAspectRatio(current);
      const next = nextAr === '16:9' ? null : nextAr;
      const patched = patchFrontmatter(prev, { aspect_ratio: next });
      if (patched !== prev) setIsDirty(true);
      return patched;
    });
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
    setMarpPrompt(isMarp(text) ? { text, dir: dirname(path) } : null);
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
            docDir: dirname(target),
            themeIds: await knownThemeIds(),
            fileExists: (p) =>
              invoke<boolean>('path_exists', { path: p }).then(Boolean).catch(() => false),
            urlReachable: (url: string) =>
              invoke('probe_url', { url })
                .then(() => null)
                .catch((e) => {
                  const msg = e instanceof Error ? e.message : String(e);
                  return msg.replace(/^Error invoking command '[^']+':\s*/i, '');
                }),
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
          // --theme replaces the deck's *base* theme; the frontmatter
          // theme_overrides still ride on top (they are derived from `content`).
          applyCliTheme(cliTheme);
        }
        if (cli.export) setColdExport(cli.export);
      } catch {
        await invoke('cli_exit', {
          message: `cannot read '${target}'`,
          code: 1,
        }).catch(() => {});
      }
    })();
  }, [applyFileContent, applyCliTheme]);

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
  const lastSessionMountedRef = useRef(false);
  useEffect(() => {
    // Skip the very first run: on mount, filePath/coldPresent are still
    // their initial values (null/false) regardless of launch type, because
    // the cold-start/restore effects above only update them after an await.
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
    saveLastSession(filePath ? { path: filePath, slideIndex: safeSlideIndex } : null);
  }, [filePath, safeSlideIndex, coldPresent]);

  // Maintain the "Open Recent" list whenever a file becomes the open document.
  useEffect(() => {
    // --present is a one-shot, headless presentation run — it must operate
    // independently of the desktop app's own state, same as it already skips
    // the last-session record above (issue #185).
    if (coldPresent) return;
    if (filePath) setRecents(addRecentFile(filePath));
  }, [filePath, coldPresent]);

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
      setImportDir(dirname(selected));
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
      await invoke('stop_watching').catch(() => {});
      await invoke('rename_file', { oldPath: filePath, newPath });
      setFilePath(newPath);
      await invoke('start_watching', { path: newPath }).catch(console.error);
    } catch (err) {
      console.error('Rename failed:', err);
      setWarnMessage(`Rename failed: ${err}`);
    }
  }, [filePath, renameValue]);

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
      await invoke('write_file', { path: savingPath, content: toWrite });
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
      await invoke('start_watching', { path: savingPath }).catch(console.error);
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
  }, [filePath, content]);

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
      await invoke('write_file', { path: target, content: toWrite });
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
      await invoke('start_watching', { path: target }).catch(console.error);
      return target;
    } catch (err) { console.error('Save As failed:', err); setWarnMessage(`Save failed: ${err}`); return null; }
  }, [filePath, content]);

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

  // Cold-start export (kova --export pptx|pdf|html FILE OUT): the load effect
  // above applies --theme and loads the deck; this fires once slides are
  // resolved. PPTX needs no rendered DOM (exportToPptx works from slide data
  // directly); PDF reuses the exact capture path the button uses above,
  // native print against the hidden dedicated print window (export_pdf_native
  // already always creates one, whether launched from the GUI or the CLI)
  // with the same raster fallback on failure; HTML reuses the same off-screen
  // capture as the Export → HTML button.
  const coldExportFiredRef = useRef(false);
  useEffect(() => {
    if (!coldExport || coldExportFiredRef.current || !filePath) return;
    if (hasPendingLocalMedia && !mediaWaitExpired) return; // wait (bounded) for local image/video data URLs to resolve
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
        if (coldExport.format === 'html') {
          const html = await runHtmlExportCapture([...visibleSlides]);
          await invoke('write_file', { path: coldExport.output, content: html });
          await finish(`wrote '${coldExport.output}'`);
          return;
        }
        // Honour CLI --notes / --per-page / --paper; fall back to settings paper (#187 / #200).
        const paper = (coldExport.paper as 'a4' | 'letter' | 'slide' | null)
          ?? settings.pdfPageSize;
        const perPage = coldExport.per_page ?? 1;
        const notes = coldExport.notes && perPage === 1
          ? visibleSlides.map((s) => s.speakerNotes)
          : undefined;
        const outcome = await runPdfExportCapture(
          [...visibleSlides],
          coldExport.output,
          { paper, perPage, notes },
        );
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
  }, [coldExport, filePath, visibleSlides, hasPendingLocalMedia, mediaWaitExpired, frontmatter, activeTheme, settings.locale, settings.pdfPageSize, runPdfExportCapture, runHtmlExportCapture]);

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
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (fromIndex < 0 || fromIndex >= segments.length || toIndex < 0 || toIndex >= segments.length) return null;
      const reordered = [...segments];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      return reordered;
    }, 'trim'));
    setIsDirty(true);
    setCurrentSlideIndex(toIndex);
    setTimeout(() => editorRef.current?.scrollToSlide(toIndex), 50);
  }, []);

  const handleDuplicateSlide = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next.splice(index + 1, 0, segments[index]);
      return next;
    }, 'trim'));
    setIsDirty(true);
    setCurrentSlideIndex(index + 1);
    setTimeout(() => editorRef.current?.scrollToSlide(index + 1), 50);
  }, []);

  const handleNewSlide = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next.splice(index + 1, 0, '');
      return next;
    }, 'trim'));
    setIsDirty(true);
    setCurrentSlideIndex(index + 1);
    setTimeout(() => editorRef.current?.scrollToSlide(index + 1), 50);
  }, []);

  const handleDeleteSlide = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length || segments.length <= 1) return null;
      const next = [...segments];
      next.splice(index, 1);
      return next;
    }, 'trim'));
    setIsDirty(true);
    const newIndex = Math.max(0, Math.min(index, slides.length - 2));
    setCurrentSlideIndex(newIndex);
    setTimeout(() => editorRef.current?.scrollToSlide(newIndex), 50);
  }, [slides.length]);

  // Multi-select delete (ThumbnailPanel). Refuses to remove every slide,
  // same guard as the single-slide delete above.
  const handleDeleteMultiple = useCallback((indices: number[]) => {
    if (indices.length === 0) return;
    setContent((prev) => editSlideSegments(prev, (segments) => {
      const toRemove = new Set(indices);
      if (toRemove.size >= segments.length) return null;
      return segments.filter((_, i) => !toRemove.has(i));
    }, 'trim'));
    setIsDirty(true);
    const newIndex = Math.max(0, Math.min(Math.min(...indices), slides.length - indices.length - 1));
    setCurrentSlideIndex(newIndex);
    setTimeout(() => editorRef.current?.scrollToSlide(newIndex), 50);
  }, [slides.length]);

  // Multi-select block drag-reorder (ThumbnailPanel). `anchorIndex` is the
  // specific thumbnail the user physically grabbed — its position relative to
  // `toIndex` decides whether the block lands before or after the drop
  // target, the same rule handleSlideReorder's two-step splice produces for
  // a single slide (drag down → land after target; drag up → land before).
  // The landing position is computed up front, synchronously, from the
  // indices alone — not from inside the setContent updater, whose callback
  // may run later (or twice, in StrictMode) rather than during this call.
  const handleReorderMultiple = useCallback((fromIndices: number[], anchorIndex: number, toIndex: number) => {
    if (fromIndices.length === 0 || fromIndices.includes(toIndex)) return;
    const fromSet = new Set(fromIndices);
    let restTargetPos = 0;
    for (let i = 0; i < toIndex; i++) if (!fromSet.has(i)) restTargetPos++;
    const insertAt = anchorIndex < toIndex ? restTargetPos + 1 : restTargetPos;

    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (toIndex < 0 || toIndex >= segments.length) return null;
      for (const i of fromIndices) if (i < 0 || i >= segments.length) return null;
      const moving = [...fromIndices].sort((a, b) => a - b).map((i) => segments[i]);
      const rest = segments.filter((_, i) => !fromSet.has(i));
      const next = [...rest];
      next.splice(insertAt, 0, ...moving);
      return next;
    }, 'trim'));
    setIsDirty(true);
    setCurrentSlideIndex(insertAt);
    setTimeout(() => editorRef.current?.scrollToSlide(insertAt), 50);
  }, []);

  // Adds or removes a `<!-- name -->` marker line at the top of one slide.
  const toggleSlideMarker = useCallback((index: number, name: 'hidden' | 'todo') => {
    const re = new RegExp(`<!--\\s*${name}\\s*-->`);
    const lineRe = new RegExp(`[ \\t]*<!--\\s*${name}\\s*-->[ \\t]*\\r?\\n?`);
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      const seg = next[index];
      next[index] = re.test(seg)
        ? seg.replace(lineRe, '')
        : seg.replace(/^(\s*)/, `$1<!-- ${name} -->\n`);
      return next;
    }, 'preserve'));
    setIsDirty(true);
  }, []);

  const handleToggleHidden = useCallback((index: number) => toggleSlideMarker(index, 'hidden'), [toggleSlideMarker]);
  const handleToggleTodo = useCallback((index: number) => toggleSlideMarker(index, 'todo'), [toggleSlideMarker]);

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
      // Insert near the top, after leading blanks and any `<!-- hidden -->`/`<!-- todo -->` markers.
      let i = 0;
      while (i < out.length && out[i].trim() === '') i++;
      while (/^<!--\s*(?:hidden|todo)\s*-->$/.test(out[i]?.trim() ?? '')) i++;
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
      filters: [IMAGE_DIALOG_FILTER],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return;

    const relPath = await resolveImagePathForMarkdown(selected, filePath, handleWarn);
    if (!relPath) return;

    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next[index] = setSlideBackgroundInRaw(next[index], relPath);
      return next;
    }, 'preserve'));
    setIsDirty(true);
    setCurrentSlideIndex(index);
    setTimeout(() => editorRef.current?.scrollToSlide(index), 50);
  }, [filePath, handleWarn, t]);

  const handleClearSlideBackground = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next[index] = setSlideBackgroundInRaw(next[index], null);
      return next;
    }, 'preserve'));
    setIsDirty(true);
    setCurrentSlideIndex(index);
    setTimeout(() => editorRef.current?.scrollToSlide(index), 50);
  }, []);

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

  // handleSave gets a new identity on every keystroke (it depends on `content`).
  // A ref lets the autosave timer below call the latest save logic without
  // including that ever-changing identity in its own dependency array — see the
  // effect's comment for why that matters.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

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
    clearRecent: () => { clearRecentFiles(); setRecents([]); },
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
          theme={activeTheme}
          docTitle={docTitle}
          docAuthor={docAuthor}
          docDate={docDate}
          aspectRatio={aspectRatio}
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
          theme={activeTheme}
          docTitle={docTitle}
          docAuthor={docAuthor}
          docDate={docDate}
          aspectRatio={aspectRatio}
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
        isRenaming={isRenaming}
        renameValue={renameValue}
        onRenameStart={(value) => { setRenameValue(value); setIsRenaming(true); }}
        onRenameChange={setRenameValue}
        onRenameCommit={handleRenameCommit}
        onRenameCancel={() => setIsRenaming(false)}
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
              theme={activeTheme}
              docTitle={docTitle}
              docAuthor={docAuthor}
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
        marpPromptOpen={marpPrompt !== null}
        onMarpConvert={async () => {
          if (!marpPrompt) return;
          const { text, dir } = marpPrompt;
          const { markdown, dropped } = importMarp(text);
          setMarpPrompt(null);
          await invoke('stop_watching').catch(() => {});
          await applyFileContent(markdown, '');
          setImportDir(dir);
          setMarpLoss(dropped.length);
        }}
        onMarpDismiss={() => setMarpPrompt(null)}
        marpLoss={marpLoss}
        onMarpLossDismiss={() => setMarpLoss(null)}
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
        externalChangeOpen={showExternalChangeDialog}
        onExternalChangeClose={() => setShowExternalChangeDialog(false)}
        onExternalChangeReload={async () => {
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
        onExternalChangeSaveAs={async () => {
          setShowExternalChangeDialog(false);
          await handleSaveAs();
        }}
        externalReloadBannerOpen={showExternalReloadBanner}
        onExternalReloadBannerDismiss={() => setShowExternalReloadBanner(false)}
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
        confirmCloseOpen={confirmCloseAction !== null}
        onConfirmCloseCancel={() => setConfirmCloseAction(null)}
        onConfirmCloseDiscard={() => { const a = confirmCloseAction; setConfirmCloseAction(null); a?.run(); }}
        onConfirmCloseSave={async () => {
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
        }}
        dropConfirmPath={dropConfirmPath}
        onDropConfirmCancel={() => setDropConfirmPath(null)}
        onDropConfirmOpen={async () => {
          const path = dropConfirmPath;
          setDropConfirmPath(null);
          if (!path) return;
          try {
            await invoke('stop_watching').catch(() => {});
            const text: string = await invoke('read_file', { path });
            await applyFileContent(text, path);
          } catch (err) {
            console.error('Drop open failed:', err);
            setRecents(removeRecentFile(path));
          }
        }}
      />

      {/* Off-screen slide rendering for PDF/HTML export and Print */}
      {offscreenContext && (
        <OffscreenDeck
          slides={offscreenContext.slides}
          theme={activeTheme}
          aspectRatio={aspectRatio}
          docTitle={docTitle}
          docAuthor={docAuthor}
          docDate={docDate}
          setSlideRef={setOffscreenSlideRef}
          onSlideReady={onOffscreenSlideReady}
        />
      )}
    </div>
    </I18nProvider>
  );
}
