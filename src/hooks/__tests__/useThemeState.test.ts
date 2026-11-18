// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DEFAULT_THEME, type RemoteFont, type Theme } from '../../engine/theme';

// ── Fakes ────────────────────────────────────────────────────────────────────

type Entries = Array<[string, string]>;

const ipc = vi.hoisted(() => ({
  loadCustomThemes: vi.fn<() => Promise<[string, Array<[string, string]>]>>(),
  startWatchingThemes: vi.fn<() => Promise<void>>(async () => {}),
  readFileB64: vi.fn<(path: string) => Promise<string>>(async () => 'QkFTRTY0'),
  downloadAndCacheFont: vi.fn<(url: string, sha256: string) => Promise<string>>(async () => '/cache/font.woff2'),
}));
vi.mock('../../platform/ipc', () => ipc);

/** Captured `listen` handlers by event name. */
const listeners = vi.hoisted(() => new Map<string, () => void>());
const unlisten = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: () => void) => {
    listeners.set(name, handler);
    return unlisten;
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

const fonts = vi.hoisted(() => ({ registerCachedFont: vi.fn(), registerBundledFonts: vi.fn() }));
vi.mock('../../engine/bundledFonts', () => fonts);

import { useThemeState, type UseThemeStateOptions } from '../useThemeState';

const MINE_YAML = (primary: string) => `name: Mine\ncolors:\n  primary: "${primary}"\n`;

/** A load_custom_themes result that only settles when `resolve` is called. */
function deferredLoad() {
  let resolve!: (entries: Entries) => void;
  const promise = new Promise<[string, Entries]>((r) => { resolve = (entries) => r(['/themes', entries]); });
  return { promise, resolve };
}

function setup(initial: Partial<UseThemeStateOptions> = {}) {
  const onWarn = vi.fn<(message: string) => void>();
  const hook = renderHook((props: Partial<UseThemeStateOptions>) =>
    useThemeState({ rawThemeOverrides: undefined, onWarn, ...props }), { initialProps: initial });
  return { ...hook, onWarn };
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  ipc.loadCustomThemes.mockResolvedValue(['/themes', []]);
});

// ── Library loading and reload ───────────────────────────────────────────────

describe('useThemeState: custom themes', () => {
  it('loads installed themes on mount and starts the themes watcher', async () => {
    ipc.loadCustomThemes.mockResolvedValue(['/themes', [['mine', MINE_YAML('#123456')]]]);
    const { result } = setup();
    await waitFor(() => expect(result.current.allThemes.some((t) => t.id === 'mine')).toBe(true));
    expect([...result.current.installedRemoteIds]).toEqual(['mine']);
    expect(ipc.startWatchingThemes).toHaveBeenCalledTimes(1);
    expect(result.current.activeThemeId).toBe(DEFAULT_THEME.id);
  });

  it('reports broken theme files through onWarn', async () => {
    ipc.loadCustomThemes.mockResolvedValue(['/themes', [['bad', 'colors: [unterminated']]]);
    const { onWarn } = setup();
    await waitFor(() => expect(onWarn).toHaveBeenCalledTimes(1));
    expect(onWarn.mock.calls[0][0]).toMatch(/^Theme issue:\n/);
  });

  it('reloads a custom theme edited on disk (debounced theme-files-changed)', async () => {
    ipc.loadCustomThemes.mockResolvedValue(['/themes', [['mine', MINE_YAML('#111111')]]]);
    const { result } = setup();
    await waitFor(() => expect(result.current.allThemes.some((t) => t.id === 'mine')).toBe(true));
    act(() => result.current.setActiveThemeId('mine'));
    expect(result.current.activeTheme.colors.primary).toBe('#111111');

    ipc.loadCustomThemes.mockResolvedValue(['/themes', [['mine', MINE_YAML('#222222')]]]);
    vi.useFakeTimers();
    try {
      const fire = listeners.get('theme-files-changed')!;
      act(() => { fire(); fire(); fire(); });
      expect(ipc.loadCustomThemes).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(300));
    } finally {
      vi.useRealTimers();
    }
    // Three rapid events collapse into a single reload.
    expect(ipc.loadCustomThemes).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.activeTheme.colors.primary).toBe('#222222'));
  });

  it('stops listening on unmount', async () => {
    const { unmount } = setup();
    await waitFor(() => expect(listeners.has('theme-files-changed')).toBe(true));
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});

// ── Missing theme ────────────────────────────────────────────────────────────

describe('useThemeState: missing theme', () => {
  it('resolves a theme flagged missing before the library finished loading', async () => {
    const load = deferredLoad();
    ipc.loadCustomThemes.mockReturnValue(load.promise);
    const { result } = setup();

    // The session file loads first: its theme is not in the library yet.
    act(() => result.current.syncThemeFromContent('---\ntheme: mine\n---\n# Hi\n'));
    expect(result.current.missingThemeId).toBe('mine');
    expect(result.current.activeThemeId).toBe(DEFAULT_THEME.id);

    await act(async () => { load.resolve([['mine', MINE_YAML('#123456')]]); await load.promise; });
    await waitFor(() => expect(result.current.activeThemeId).toBe('mine'));
    expect(result.current.missingThemeId).toBeNull();
  });

  it('stays missing when the theme is genuinely not installed', async () => {
    const { result } = setup();
    await waitFor(() => expect(ipc.loadCustomThemes).toHaveBeenCalled());
    act(() => result.current.syncThemeFromContent('---\ntheme: nowhere\n---\n'));
    expect(result.current.missingThemeId).toBe('nowhere');
    expect(result.current.activeThemeId).toBe(DEFAULT_THEME.id);
  });

  it('syncs a known theme, and falls back to the default when none is named', () => {
    const { result } = setup();
    act(() => result.current.syncThemeFromContent('---\ntheme: dark\n---\n'));
    expect(result.current.activeThemeId).toBe('dark');
    act(() => result.current.syncThemeFromContent('# no frontmatter\n'));
    expect(result.current.activeThemeId).toBe(DEFAULT_THEME.id);
    expect(result.current.missingThemeId).toBeNull();
  });

  it('handleMissingThemeInstalled reloads and switches to the installed theme', async () => {
    const { result } = setup();
    act(() => result.current.syncThemeFromContent('---\ntheme: mine\n---\n'));
    ipc.loadCustomThemes.mockResolvedValue(['/themes', [['mine', MINE_YAML('#123456')]]]);
    act(() => result.current.handleMissingThemeInstalled('mine'));
    expect(result.current.activeThemeId).toBe('mine');
    expect(result.current.missingThemeId).toBeNull();
    await waitFor(() => expect(result.current.activeTheme.colors.primary).toBe('#123456'));
  });
});

// ── CLI --theme ──────────────────────────────────────────────────────────────

describe('useThemeState: CLI theme', () => {
  const cliTheme: Theme = { ...DEFAULT_THEME, id: 'cli:brand', name: 'Brand', colors: { ...DEFAULT_THEME.colors, primary: '#ABCDEF' } };

  it('applies the CLI theme as the base theme, with frontmatter overrides on top', async () => {
    const { result, rerender } = setup();
    act(() => result.current.applyCliTheme(cliTheme));
    expect(result.current.cliThemeRef.current).toBe(cliTheme);
    expect(result.current.activeThemeId).toBe('cli:brand');
    expect(result.current.baseTheme).toBe(cliTheme);
    rerender({ rawThemeOverrides: { colors: { accent: '#FF0000' } } });
    expect(result.current.activeTheme.colors.primary).toBe('#ABCDEF');
    expect(result.current.activeTheme.colors.accent).toBe('#FF0000');
  });

  it('survives a later custom-theme reload', async () => {
    const { result } = setup();
    await waitFor(() => expect(ipc.loadCustomThemes).toHaveBeenCalledTimes(1));
    act(() => result.current.applyCliTheme(cliTheme));
    ipc.loadCustomThemes.mockResolvedValue(['/themes', [['mine', MINE_YAML('#123456')]]]);
    act(() => result.current.reloadCustomThemes());
    await waitFor(() => expect(result.current.allThemes.some((t) => t.id === 'mine')).toBe(true));
    expect(result.current.allThemes.filter((t) => t.id === 'cli:brand')).toHaveLength(1);
    expect(result.current.activeThemeId).toBe('cli:brand');
  });

  it('wins over the startup library load even when that load settles afterwards', async () => {
    const load = deferredLoad();
    ipc.loadCustomThemes.mockReturnValue(load.promise);
    const { result } = setup();
    act(() => result.current.applyCliTheme(cliTheme));
    await act(async () => { load.resolve([]); await load.promise; });
    expect(result.current.allThemes.some((t) => t.id === 'cli:brand')).toBe(true);
    expect(result.current.activeTheme.colors.primary).toBe('#ABCDEF');
  });
});

// ── Overrides, logo, fonts ───────────────────────────────────────────────────

describe('useThemeState: overrides and logo', () => {
  it('keeps activeTheme stable when the overrides only change identity', () => {
    const { result, rerender } = setup({ rawThemeOverrides: { colors: { accent: '#00FF00' } } });
    const first = result.current.activeTheme;
    expect(first.colors.accent).toBe('#00FF00');
    rerender({ rawThemeOverrides: { colors: { accent: '#00FF00' } } });
    expect(result.current.activeTheme).toBe(first);
    rerender({ rawThemeOverrides: { colors: { accent: '#0000FF' } } });
    expect(result.current.activeTheme.colors.accent).toBe('#0000FF');
  });

  it('resolves a logo path to a data URL, and a null override hides it', async () => {
    const { result, rerender } = setup({ rawThemeOverrides: { logo: '/img/logo.png' } });
    await waitFor(() => expect(result.current.activeTheme.logo).toBe('data:image/png;base64,QkFTRTY0'));
    expect(ipc.readFileB64).toHaveBeenCalledWith('/img/logo.png');
    rerender({ rawThemeOverrides: { logo: null } });
    await waitFor(() => expect(result.current.activeTheme.logo).toBeUndefined());
  });

  it('passes web and data logos through without IPC', async () => {
    const { result } = setup({ rawThemeOverrides: { logo: 'https://x.test/l.svg' } });
    await waitFor(() => expect(result.current.activeTheme.logo).toBe('https://x.test/l.svg'));
    expect(ipc.readFileB64).not.toHaveBeenCalled();
  });

  it('downloads the active theme\'s remote fonts once per theme, not per override edit', async () => {
    const font: RemoteFont = { family: 'Brand', url: 'https://f.test/b.woff2', sha256: 'cc', weight: '400', style: 'normal' };
    const fontTheme: Theme = { ...DEFAULT_THEME, id: 'cli:fonts', remoteFonts: [font], bundledFonts: ['Inter'] };
    const { result, rerender } = setup();
    act(() => result.current.applyCliTheme(fontTheme));
    await waitFor(() => expect(fonts.registerCachedFont).toHaveBeenCalledTimes(1));
    expect(fonts.registerBundledFonts).toHaveBeenCalledWith(['Inter']);
    rerender({ rawThemeOverrides: { colors: { accent: '#010203' } } });
    rerender({ rawThemeOverrides: { colors: { accent: '#040506' } } });
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledTimes(1);
    expect(ipc.downloadAndCacheFont).toHaveBeenCalledWith(font.url, 'cc');
  });
});
