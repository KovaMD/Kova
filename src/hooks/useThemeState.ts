import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as ipc from '../platform/ipc';
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME,
  resolveCustomThemeLibrary,
  sanitiseThemeOverrides,
  type Theme,
  type ThemeOverrides,
  type ThemeParseResult,
} from '../engine/theme';
import { registerBundledFonts } from '../engine/bundledFonts';
import { extractFrontmatter } from '../engine/parser/frontmatter';
import { imageMime } from '../engine/export/imageMime';
import { useRemoteFonts } from './useRemoteFonts';

export interface UseThemeStateOptions {
  /** The document frontmatter's raw `theme_overrides:` value (unsanitised). */
  rawThemeOverrides: unknown;
  /** Surfaces custom-theme parse errors and `extends:` warnings. */
  onWarn: (message: string) => void;
}

export interface UseThemeStateResult {
  /** Built-ins, then installed community themes, then any --theme path theme. */
  allThemes: Theme[];
  activeThemeId: string;
  setActiveThemeId: Dispatch<SetStateAction<string>>;
  /** A frontmatter `theme:` naming a theme not in the library. */
  missingThemeId: string | null;
  setMissingThemeId: Dispatch<SetStateAction<string | null>>;
  /** Ids of the installed (non-built-in) themes. */
  installedRemoteIds: Set<string>;
  /** Sanitised per-deck overrides from the frontmatter. */
  themeOverrides: ThemeOverrides;
  /** The selected theme before the deck's own overrides are applied. */
  baseTheme: Theme;
  /** baseTheme merged with themeOverrides, logo resolved to a data URL. */
  activeTheme: Theme;
  /** Re-read the custom themes directory into allThemes. */
  reloadCustomThemes: () => void;
  /** MissingThemeBanner install: reload, then switch to the installed theme. */
  handleMissingThemeInstalled: (themeId: string) => void;
  /** Pick the base theme named by a document's frontmatter `theme:` key. */
  syncThemeFromContent: (text: string) => void;
  /**
   * Theme resolved from --theme, if any. Consulted by reloadCustomThemes (so
   * a later community-theme reload doesn't drop it from allThemes) and by the
   * file watcher's silent-reload path in App (an external file edit
   * re-syncing the theme from frontmatter must not clobber the CLI override
   * mid-presentation).
   */
  cliThemeRef: RefObject<Theme | null>;
  /**
   * Apply a --theme override: it replaces the deck's *base* theme for the
   * whole session; the frontmatter theme_overrides still ride on top.
   */
  applyCliTheme: (theme: Theme) => void;
}

/**
 * The main window's theme state: the theme library (built-ins plus installed
 * community themes, reloaded on demand and when the themes directory changes
 * on disk), the active and missing theme ids, the per-deck overrides, the
 * --theme CLI override, the resolved logo and the active theme's fonts.
 */
export function useThemeState({ rawThemeOverrides, onWarn }: UseThemeStateOptions): UseThemeStateResult {
  // Theme state: active theme id (base theme). The per-deck overrides on top of
  // it are NOT state — they are derived from the document's own frontmatter
  // (`theme_overrides:`), so the inspector and the editor's YAML can never
  // drift apart.
  const [allThemes, setAllThemes]         = useState<Theme[]>(BUILT_IN_THEMES);
  const allThemesRef = useRef(BUILT_IN_THEMES as Theme[]);
  useEffect(() => { allThemesRef.current = allThemes; }, [allThemes]);
  const [activeThemeId, setActiveThemeId] = useState<string>(DEFAULT_THEME.id);
  const [missingThemeId, setMissingThemeId]   = useState<string | null>(null);
  const [resolvedLogoUrl, setResolvedLogoUrl] = useState<string | undefined>(undefined);
  const cliThemeRef = useRef<Theme | null>(null);
  const onWarnRef = useRef(onWarn);
  onWarnRef.current = onWarn;

  // Overrides come straight from the frontmatter. Re-derive only when their
  // serialised form actually changes, so `activeTheme` (and every slide
  // thumbnail that depends on it) doesn't churn on unrelated keystrokes.
  const themeOverridesJson = useMemo(
    () => JSON.stringify(rawThemeOverrides ?? null),
    [rawThemeOverrides],
  );
  const themeOverrides = useMemo(() => {
    return sanitiseThemeOverrides((rawThemeOverrides as Record<string, unknown>) ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeOverridesJson]);

  const installedRemoteIds = useMemo(
    () => new Set(allThemes.filter((t) => !BUILT_IN_THEMES.some((b) => b.id === t.id)).map((t) => t.id)),
    [allThemes],
  );

  // The selected theme before this document's own theme_overrides are
  // applied — InspectorPanel needs it to tell whether an override actually
  // differs from the theme's default (e.g. a header field toggled back to
  // its original value) rather than merely being present as a key, since
  // onHeaderChange/onFooterChange/onTocChange always write a whole object.
  const baseTheme = useMemo<Theme>(
    () => allThemes.find((t) => t.id === activeThemeId) ?? DEFAULT_THEME,
    [allThemes, activeThemeId],
  );

  // Resolved theme = base theme merged with overrides
  const activeTheme = useMemo<Theme>(() => {
    const base = baseTheme;
    return { ...base, ...themeOverrides,
      // Swap in the pre-resolved data URL for the logo (see the effect below):
      // the asset protocol cannot reliably serve absolute Windows paths outside
      // the home directory, so we read the file via IPC and embed it as base64.
      logo: resolvedLogoUrl,
      colors: { ...base.colors, ...(themeOverrides.colors ?? {}) },
      fonts:  { ...base.fonts,  ...(themeOverrides.fonts  ?? {}) },
      header: { ...base.header, ...(themeOverrides.header ?? {}) },
      footer: { ...base.footer, ...(themeOverrides.footer ?? {}) },
      toc: { ...base.toc, ...(themeOverrides.toc ?? {}) },
    };
  }, [baseTheme, themeOverrides, resolvedLogoUrl]);

  // Effective raw logo: an explicit override (a path, or `null` to hide it)
  // wins; otherwise fall back to the base theme's own logo.
  const rawLogoSrc = useMemo(() => {
    if ('logo' in themeOverrides) return themeOverrides.logo ?? undefined;
    const base = allThemes.find((t) => t.id === activeThemeId) ?? DEFAULT_THEME;
    return base.logo;
  }, [themeOverrides, allThemes, activeThemeId]);

  // Resolve the raw logo path to a data URL via IPC so the image works in both
  // windows regardless of asset-protocol scope restrictions on Windows.
  useEffect(() => {
    let cancelled = false;
    const raw = rawLogoSrc;
    if (!raw) { setResolvedLogoUrl(undefined); return; }
    if (/^(https?:|data:)/i.test(raw)) { setResolvedLogoUrl(raw); return; }
    const mime = imageMime(raw);
    ipc.readFileB64(raw)
      .then((b64) => { if (!cancelled) setResolvedLogoUrl(`data:${mime};base64,${b64}`); })
      .catch(() => { if (!cancelled) setResolvedLogoUrl(undefined); });
    return () => { cancelled = true; };
  }, [rawLogoSrc]);

  useEffect(() => {
    if (activeTheme.bundledFonts?.length) {
      registerBundledFonts(activeTheme.bundledFonts);
    }
  }, [activeTheme.bundledFonts]);

  // Download-once, verify, and register any remote fonts declared by the active theme.
  // Re-runs only on theme identity change since remoteFonts are theme-level, not overrides.
  useRemoteFonts(activeTheme.remoteFonts, { rerunKey: activeThemeId });

  const reloadCustomThemes = useCallback(() => {
    ipc.loadCustomThemes()
      .then(([dir, entries]) => {
        // Resolved together (not entry-by-entry) so extends: can target
        // another installed theme, not just a built-in (issue #249).
        const { results, warnings } = resolveCustomThemeLibrary(entries, dir);
        const custom = results.filter((r): r is Extract<ThemeParseResult, { ok: true }> => r.ok).map((r) => r.theme);
        const errors = results.filter((r): r is Extract<ThemeParseResult, { ok: false }> => !r.ok).map((r) => r.error);
        setAllThemes(() => {
          const base = custom.length > 0 ? [...BUILT_IN_THEMES, ...custom] : BUILT_IN_THEMES;
          // Keep a --theme=path/to.yaml theme alive: it lives outside the
          // config dir, so rebuilding the list from disk would drop it.
          const cliTheme = cliThemeRef.current;
          return cliTheme && !base.some((t) => t.id === cliTheme.id) ? [...base, cliTheme] : base;
        });
        const messages = [...errors, ...warnings];
        if (messages.length > 0) onWarnRef.current(`Theme issue:\n${messages.join('\n')}`);
      })
      .catch(() => {});
  }, []);

  const handleMissingThemeInstalled = useCallback((themeId: string) => {
    reloadCustomThemes();
    setActiveThemeId(themeId);
    setMissingThemeId(null);
  }, [reloadCustomThemes]);

  // Load custom themes from the platform config dir on startup
  useEffect(() => { reloadCustomThemes(); }, [reloadCustomThemes]);

  // Watch the themes directory for external changes (issue #252) — e.g. a
  // theme .yaml edited in another app while Kova is open. Debounced since
  // saving in some editors fires several filesystem events in quick
  // succession; the watcher itself lives for the app's lifetime once started.
  useEffect(() => {
    ipc.startWatchingThemes().catch(() => {});
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unlisten = listen<void>('theme-files-changed', () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(reloadCustomThemes, 300);
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unlisten.then((fn) => fn());
    };
  }, [reloadCustomThemes]);

  // Resolve a formerly-missing theme once custom themes finish loading.
  // Fixes a startup race: if the session file loads before load_custom_themes
  // returns, applyFileContent marks the theme missing even though it is installed.
  useEffect(() => {
    if (!missingThemeId) return;
    const found = allThemes.find((t) => t.id === missingThemeId);
    if (!found) return;
    setActiveThemeId(found.id);
    setMissingThemeId(null);
  }, [allThemes, missingThemeId]);

  // Pick the base theme named by a document's frontmatter `theme:` key (the
  // per-deck overrides ride along in `theme_overrides:` and are derived, not
  // synced here). A `theme:` naming a theme not in the library flags the
  // MissingThemeBanner instead.
  const syncThemeFromContent = useCallback((text: string) => {
    const { frontmatter: fm } = extractFrontmatter(text);
    if (typeof fm.theme === 'string') {
      const found = allThemesRef.current.find((t) => t.id === fm.theme);
      if (found) {
        setActiveThemeId(found.id);
        setMissingThemeId(null);
      } else {
        setMissingThemeId(fm.theme);
      }
    } else {
      setActiveThemeId(DEFAULT_THEME.id);
      setMissingThemeId(null);
    }
  }, []);

  const applyCliTheme = useCallback((cliTheme: Theme) => {
    cliThemeRef.current = cliTheme;
    const id = cliTheme.id;
    setAllThemes((prev) => prev.some((t) => t.id === id) ? prev : [...prev, cliTheme]);
    setActiveThemeId(id);
    setMissingThemeId(null);
  }, []);

  return {
    allThemes,
    activeThemeId,
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
  };
}
