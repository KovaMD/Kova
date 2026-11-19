// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Slide } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import type { Translator } from '../../i18n';

// ── Fakes ────────────────────────────────────────────────────────────────────

const ipc = vi.hoisted(() => ({
  setWakeLock: vi.fn<(active: boolean) => Promise<void>>(async () => {}),
  cliExit: vi.fn<(code: number, message?: string) => Promise<void>>(async () => {}),
  setupAudienceWindow: vi.fn<(args: unknown) => Promise<void>>(async () => {}),
}));
vi.mock('../../platform/ipc', () => ipc);

/** The main window's getCurrentWindow() handle. */
const mainWin = vi.hoisted(() => ({
  setFullscreen: vi.fn<(on: boolean) => Promise<void>>(async () => {}),
  setAlwaysOnTop: vi.fn<(on: boolean) => Promise<void>>(async () => {}),
  setFocus: vi.fn<() => Promise<void>>(async () => {}),
  isMaximized: vi.fn<() => Promise<boolean>>(async () => false),
  unmaximize: vi.fn<() => Promise<void>>(async () => {}),
  show: vi.fn<() => Promise<void>>(async () => {}),
}));

interface FakeMonitor {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
}
const monitors = vi.hoisted(() => ({
  all: [] as FakeMonitor[],
  current: null as FakeMonitor | null,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mainWin,
  availableMonitors: vi.fn(async () => monitors.all),
  currentMonitor: vi.fn(async () => monitors.current),
}));

/** Captured `listen` handlers by event name. */
const events = vi.hoisted(() => ({
  listeners: new Map<string, () => unknown>(),
  emit: vi.fn<(name: string, payload: unknown) => Promise<void>>(async () => {}),
  emitTo: vi.fn<(target: string, name: string, payload: unknown) => Promise<void>>(async () => {}),
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: events.emit,
  emitTo: events.emitTo,
  listen: vi.fn(async (name: string, handler: () => unknown) => {
    events.listeners.set(name, handler);
    return () => { if (events.listeners.get(name) === handler) events.listeners.delete(name); };
  }),
}));

/** Fake WebviewWindow: records every window created, and its once-handlers. */
const webview = vi.hoisted(() => {
  class FakeWebviewWindow {
    static created: FakeWebviewWindow[] = [];
    static open: FakeWebviewWindow | null = null;
    static getByLabel = async (label: string) =>
      (FakeWebviewWindow.open && FakeWebviewWindow.open.label === label ? FakeWebviewWindow.open : null);
    handlers = new Map<string, () => void>();
    close = vi.fn(async () => {
      if (FakeWebviewWindow.open === this) FakeWebviewWindow.open = null;
    });
    constructor(public label: string, public options: Record<string, unknown>) {
      FakeWebviewWindow.created.push(this);
      FakeWebviewWindow.open = this;
    }
    once(event: string, handler: () => void) {
      this.handlers.set(event, handler);
      return Promise.resolve(() => {});
    }
    fire(event: string) { this.handlers.get(event)?.(); }
  }
  return { FakeWebviewWindow };
});
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: webview.FakeWebviewWindow }));
const { FakeWebviewWindow } = webview;

import {
  usePresentationSession,
  AUDIENCE_READY_TIMEOUT_MS,
  ALWAYS_ON_TOP_REASSERT_MS,
  type UsePresentationSessionOptions,
} from '../usePresentationSession';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mkSlides = (n: number, hidden: number[] = []): Slide[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, hidden: hidden.includes(i) } as unknown as Slide));

const theme = { id: 'fake' } as unknown as Theme;
const t: Translator = (key) => key;

const laptop: FakeMonitor = { name: 'eDP-1', position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, scaleFactor: 2 };
const external: FakeMonitor = { name: 'HDMI-1', position: { x: 2880, y: 0 }, size: { width: 3840, height: 2160 }, scaleFactor: 2 };

function setup(overrides: Partial<UsePresentationSessionOptions> = {}) {
  const slides = overrides.slides ?? mkSlides(4, [1]);
  const visibleSlides = overrides.visibleSlides ?? slides.filter((s) => !s.hidden);
  const base: UsePresentationSessionOptions = {
    slides,
    visibleSlides,
    safeSlideIndex: 0,
    safePresentIndex: 0,
    setCurrentSlideIndex: vi.fn(),
    setPresentIndex: vi.fn(),
    setPresentStep: vi.fn(),
    activeTheme: theme,
    aspectRatio: { w: 16, h: 9 },
    docTitle: 'Deck',
    docAuthor: 'Ada',
    docDate: '2026',
    settings: { presentationMode: 'auto', presenterWindowed: false, presenterAlwaysOnTop: false },
    coldPresent: false,
    filePath: '/docs/talk.md',
    onWarn: vi.fn(),
    t,
    ...overrides,
  };
  const hook = renderHook(
    (props: Partial<UsePresentationSessionOptions>) => usePresentationSession({ ...base, ...props }),
    { initialProps: {} },
  );
  return { ...hook, opts: base };
}

type Result = ReturnType<typeof setup>['result'];

async function enter(result: Result, arg?: boolean) {
  await act(async () => { await result.current.handlePresentEnter(arg); });
}

/** Enter dual mode on a two-monitor setup; returns the audience window. */
async function enterDual(result: Result) {
  monitors.all = [laptop, external];
  monitors.current = laptop;
  await enter(result);
  const win = FakeWebviewWindow.created.at(-1);
  if (!win) throw new Error('no audience window created');
  return win;
}

/** Let the fire-and-forget endSession chain settle. */
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
  events.listeners.clear();
  FakeWebviewWindow.created = [];
  FakeWebviewWindow.open = null;
  monitors.all = [laptop];
  monitors.current = laptop;
  mainWin.isMaximized.mockResolvedValue(false);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Entering ─────────────────────────────────────────────────────────────────

describe('usePresentationSession: enter', () => {
  it('does nothing for a deck with no visible slides', async () => {
    const { result, opts } = setup({ slides: mkSlides(1, [0]), visibleSlides: [] });
    await enter(result);
    expect(opts.setPresentIndex).not.toHaveBeenCalled();
    expect(result.current.presentMode).toBe(false);
    expect(mainWin.setFullscreen).not.toHaveBeenCalled();
  });

  it('single screen (auto, one monitor): present mode, fullscreen, wake lock on', async () => {
    const { result, opts } = setup();
    await enter(result);
    expect(opts.setPresentIndex).toHaveBeenCalledWith(0);
    expect(opts.setPresentStep).toHaveBeenCalledWith(0);
    expect(result.current.presentMode).toBe(true);
    expect(result.current.presenterMode).toBe(false);
    expect(mainWin.setFullscreen).toHaveBeenCalledWith(true);
    expect(FakeWebviewWindow.created).toHaveLength(0);
    expect(ipc.setWakeLock).toHaveBeenLastCalledWith(true);
  });

  it('present from current translates the editor index to the visible deck', async () => {
    // Slide 1 hidden: editor slide 2 is visible slide 1.
    const { result, opts } = setup({ safeSlideIndex: 2 });
    await enter(result, true);
    expect(opts.setPresentIndex).toHaveBeenCalledWith(1);
  });

  it('present from current on a hidden slide starts at the first visible', async () => {
    const { result, opts } = setup({ safeSlideIndex: 1 });
    await enter(result, true);
    expect(opts.setPresentIndex).toHaveBeenCalledWith(0);
  });

  it('alt+click means present from current; plain click starts at 0', async () => {
    const { result, opts } = setup({ safeSlideIndex: 3 });
    await act(async () => { await result.current.handlePresentEnter({ altKey: true } as React.MouseEvent); });
    expect(opts.setPresentIndex).toHaveBeenLastCalledWith(2);
    await act(async () => { await result.current.handlePresentEnter({ altKey: false } as React.MouseEvent); });
    expect(opts.setPresentIndex).toHaveBeenLastCalledWith(0);
  });

  it('dual mode with no external monitor falls through to single', async () => {
    const { result } = setup({ settings: { presentationMode: 'dual', presenterWindowed: false, presenterAlwaysOnTop: false } });
    await enter(result);
    expect(result.current.presentMode).toBe(true);
    expect(result.current.presenterMode).toBe(false);
    expect(FakeWebviewWindow.created).toHaveLength(0);
  });

  it('auto with two monitors goes dual: audience window on the external monitor', async () => {
    const { result } = setup();
    const win = await enterDual(result);
    expect(result.current.presenterMode).toBe(true);
    expect(result.current.presentMode).toBe(false);
    expect(win.label).toBe('audience');
    expect(win.options).toMatchObject({
      url: '/#audience', x: 1440, y: 0, width: 1920, height: 1080,
      decorations: false, resizable: false, focus: false,
    });
    expect(win.options).not.toHaveProperty('fullscreen');
    expect(mainWin.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('Wayland (no current monitor): the audience window goes furthest from the origin', async () => {
    const { result } = setup();
    monitors.all = [external, laptop];
    monitors.current = null;
    await enter(result);
    expect(FakeWebviewWindow.created[0].options).toMatchObject({ x: 1440, y: 0 });
  });

  it('a failed monitor query is treated as a single screen', async () => {
    const win = await import('@tauri-apps/api/window');
    vi.mocked(win.availableMonitors).mockRejectedValueOnce(new Error('nope'));
    const { result } = setup();
    monitors.all = [laptop, external];
    await enter(result);
    expect(result.current.presentMode).toBe(true);
    expect(FakeWebviewWindow.created).toHaveLength(0);
  });

  it('closes a stale audience window before creating the new one', async () => {
    const stale = new FakeWebviewWindow('audience', {});
    FakeWebviewWindow.created = [];
    const { result } = setup();
    await enterDual(result);
    expect(stale.close).toHaveBeenCalled();
  });

  it('present:ready sends the deck and positions the audience window via Rust', async () => {
    const { result, opts } = setup();
    await enterDual(result);
    await act(async () => { await events.listeners.get('present:ready')?.(); });
    expect(events.emitTo).toHaveBeenCalledWith('audience', 'present:init', {
      slides: opts.visibleSlides,
      theme,
      index: 0,
      step: 0,
      aspectRatio: { w: 16, h: 9 },
      docTitle: 'Deck',
      docAuthor: 'Ada',
      docDate: '2026',
    });
    expect(ipc.setupAudienceWindow).toHaveBeenCalledWith({ x: 1440, y: 0, physicalX: 2880, physicalY: 0 });
    expect(mainWin.setFocus).toHaveBeenCalled();
    expect(events.listeners.has('present:ready')).toBe(false);
  });

  it('mirror mode: audience window plus the normal overlay, fullscreen', async () => {
    const { result } = setup({ settings: { presentationMode: 'mirror', presenterWindowed: false, presenterAlwaysOnTop: false } });
    await enterDual(result);
    expect(result.current.presentMode).toBe(true);
    expect(result.current.presenterMode).toBe(false);
    expect(mainWin.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('windowed presenter un-maximizes instead of fullscreening', async () => {
    mainWin.isMaximized.mockResolvedValue(true);
    const { result } = setup({ settings: { presentationMode: 'auto', presenterWindowed: true, presenterAlwaysOnTop: false } });
    await enterDual(result);
    expect(mainWin.unmaximize).toHaveBeenCalled();
    expect(mainWin.setFullscreen).not.toHaveBeenCalled();
    expect(mainWin.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('windowed always-on-top presenter reasserts on an interval until exit', async () => {
    vi.useFakeTimers();
    const { result } = setup({ settings: { presentationMode: 'auto', presenterWindowed: true, presenterAlwaysOnTop: true } });
    await enterDual(result);
    expect(mainWin.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(mainWin.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(ALWAYS_ON_TOP_REASSERT_MS * 2);
    expect(mainWin.setAlwaysOnTop).toHaveBeenCalledTimes(3);

    await act(async () => { await result.current.handlePresentExit(); });
    expect(mainWin.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    const calls = mainWin.setAlwaysOnTop.mock.calls.length;
    vi.advanceTimersByTime(ALWAYS_ON_TOP_REASSERT_MS * 3);
    expect(mainWin.setAlwaysOnTop).toHaveBeenCalledTimes(calls);
  });
});

// ── Exiting ──────────────────────────────────────────────────────────────────

describe('usePresentationSession: exit', () => {
  it('resets modes, lands the editor on the presented slide, leaves fullscreen', async () => {
    // Visible slide 2 is editor slide 3 (slide 1 hidden).
    const { result, opts } = setup({ safePresentIndex: 2 });
    await enter(result);
    await act(async () => { await result.current.handlePresentExit(); });
    expect(events.emit).toHaveBeenCalledWith('present:exit', null);
    expect(result.current.presentMode).toBe(false);
    expect(result.current.presenterMode).toBe(false);
    expect(opts.setCurrentSlideIndex).toHaveBeenCalledWith(3);
    expect(mainWin.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(mainWin.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(ipc.setWakeLock).toHaveBeenLastCalledWith(false);
    expect(ipc.cliExit).not.toHaveBeenCalled();
  });

  it('closes the audience window directly', async () => {
    const { result } = setup();
    const win = await enterDual(result);
    await act(async () => { await result.current.handlePresentExit(); });
    expect(win.close).toHaveBeenCalled();
    expect(result.current.presenterMode).toBe(false);
  });

  it('ignores a second exit while the first is in flight', async () => {
    const { result } = setup();
    await enter(result);
    await act(async () => {
      await Promise.all([result.current.handlePresentExit(), result.current.handlePresentExit()]);
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('can exit again after re-entering', async () => {
    const { result } = setup();
    await enter(result);
    await act(async () => { await result.current.handlePresentExit(); });
    await enter(result);
    await act(async () => { await result.current.handlePresentExit(); });
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it('cold-started: releases the wake lock then quits with code 0, no reset', async () => {
    const { result, opts } = setup({ coldPresent: true });
    await flush();
    vi.clearAllMocks();
    await act(async () => { await result.current.handlePresentExit(); });
    expect(ipc.setWakeLock.mock.calls).toEqual([[false]]);
    expect(ipc.cliExit.mock.calls).toEqual([[0, undefined]]);
    expect(ipc.setWakeLock.mock.invocationCallOrder[0]).toBeLessThan(ipc.cliExit.mock.invocationCallOrder[0]);
    expect(result.current.presentMode).toBe(true);
    expect(opts.setCurrentSlideIndex).not.toHaveBeenCalled();
    expect(mainWin.setFullscreen).not.toHaveBeenCalled();
  });
});

// ── Audience window failures ─────────────────────────────────────────────────

describe('usePresentationSession: audience window failures', () => {
  it('ready timeout: closes the window, resets and warns', async () => {
    vi.useFakeTimers();
    const { result, opts } = setup();
    const win = await enterDual(result);
    mainWin.setFullscreen.mockClear();
    await act(async () => { vi.advanceTimersByTime(AUDIENCE_READY_TIMEOUT_MS); });
    await flush();
    expect(win.close).toHaveBeenCalled();
    expect(result.current.presenterMode).toBe(false);
    expect(result.current.presentMode).toBe(false);
    expect(opts.onWarn).toHaveBeenCalledWith('presentation.audienceWindowTimeout');
    expect(mainWin.setFullscreen).toHaveBeenCalledWith(false);
    expect(mainWin.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(events.listeners.has('present:ready')).toBe(false);
    expect(opts.setCurrentSlideIndex).not.toHaveBeenCalled();
  });

  it('no timeout once present:ready has fired', async () => {
    vi.useFakeTimers();
    const { result, opts } = setup();
    await enterDual(result);
    await act(async () => { await events.listeners.get('present:ready')?.(); });
    await act(async () => { vi.advanceTimersByTime(AUDIENCE_READY_TIMEOUT_MS); });
    expect(opts.onWarn).not.toHaveBeenCalled();
    expect(result.current.presenterMode).toBe(true);
  });

  it('a stale session timeout is ignored', async () => {
    vi.useFakeTimers();
    const { result, opts } = setup();
    await enterDual(result);
    await act(async () => { vi.advanceTimersByTime(AUDIENCE_READY_TIMEOUT_MS / 2); });
    await enterDual(result);
    // Only the first session's timer is due: it is stale and does nothing.
    await act(async () => { vi.advanceTimersByTime(AUDIENCE_READY_TIMEOUT_MS / 2); });
    await flush();
    expect(opts.onWarn).not.toHaveBeenCalled();
    expect(result.current.presenterMode).toBe(true);
    // The second session's own timer still fires.
    await act(async () => { vi.advanceTimersByTime(AUDIENCE_READY_TIMEOUT_MS / 2); });
    await flush();
    expect(opts.onWarn).toHaveBeenCalledTimes(1);
  });

  it('cold-started ready timeout quits with code 1 and a message', async () => {
    vi.useFakeTimers();
    const { result } = setup({ coldPresent: true, filePath: null });
    await enterDual(result);
    await act(async () => { vi.advanceTimersByTime(AUDIENCE_READY_TIMEOUT_MS); });
    await flush();
    expect(ipc.setWakeLock).toHaveBeenLastCalledWith(false);
    expect(ipc.cliExit.mock.calls).toEqual([[1, 'presentation window did not respond in time']]);
    expect(result.current.presenterMode).toBe(true);
  });

  it('tauri://error: resets without a warning and cancels the timeout', async () => {
    vi.useFakeTimers();
    const { result, opts } = setup();
    const win = await enterDual(result);
    await act(async () => { win.fire('tauri://error'); });
    await flush();
    expect(result.current.presenterMode).toBe(false);
    expect(mainWin.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(mainWin.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(events.listeners.has('present:ready')).toBe(false);
    await act(async () => { vi.advanceTimersByTime(AUDIENCE_READY_TIMEOUT_MS); });
    expect(opts.onWarn).not.toHaveBeenCalled();
  });

  it('cold-started tauri://error quits with code 1 and a message', async () => {
    const { result } = setup({ coldPresent: true, filePath: null });
    const win = await enterDual(result);
    await act(async () => { win.fire('tauri://error'); });
    await flush();
    expect(ipc.cliExit.mock.calls).toEqual([[1, 'failed to create the presentation window']]);
  });

  it('tauri://destroyed (closed externally): resets the session', async () => {
    const { result, opts } = setup();
    const win = await enterDual(result);
    await act(async () => { win.fire('tauri://destroyed'); });
    await flush();
    expect(result.current.presenterMode).toBe(false);
    expect(mainWin.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(mainWin.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(opts.onWarn).not.toHaveBeenCalled();
  });

  it('tauri://destroyed during a normal exit is ignored', async () => {
    const { result } = setup();
    const win = await enterDual(result);
    let exiting!: Promise<void>;
    act(() => { exiting = result.current.handlePresentExit(); });
    mainWin.setFullscreen.mockClear();
    win.fire('tauri://destroyed');
    await act(async () => { await exiting; });
    // Only the exit's own reset ran.
    expect(mainWin.setFullscreen.mock.calls).toEqual([[false]]);
  });

  it('tauri://destroyed from a previous session is ignored', async () => {
    const { result } = setup();
    const first = await enterDual(result);
    await enterDual(result);
    await act(async () => { first.fire('tauri://destroyed'); });
    await flush();
    expect(result.current.presenterMode).toBe(true);
  });

  it('cold-started tauri://destroyed quits with code 0', async () => {
    const { result } = setup({ coldPresent: true, filePath: null });
    const win = await enterDual(result);
    await act(async () => { win.fire('tauri://destroyed'); });
    await flush();
    expect(ipc.cliExit.mock.calls).toEqual([[0, undefined]]);
    expect(result.current.presenterMode).toBe(true);
  });
});

// ── Cold start and wake lock ─────────────────────────────────────────────────

describe('usePresentationSession: cold start', () => {
  it('shows the window and enters exactly once', async () => {
    const { result, rerender } = setup({ coldPresent: true });
    await flush();
    expect(mainWin.show).toHaveBeenCalledTimes(1);
    expect(result.current.presentMode).toBe(true);
    rerender({ visibleSlides: mkSlides(2) });
    await flush();
    expect(mainWin.show).toHaveBeenCalledTimes(1);
  });

  it('waits for the file to be applied', async () => {
    const { result, rerender } = setup({ coldPresent: true, filePath: null });
    await flush();
    expect(mainWin.show).not.toHaveBeenCalled();
    rerender({ filePath: '/docs/talk.md' });
    await flush();
    expect(result.current.presentMode).toBe(true);
  });

  it('quits with an error for a deck with no visible slides', async () => {
    setup({ coldPresent: true, slides: mkSlides(1, [0]), visibleSlides: [] });
    await flush();
    expect(ipc.cliExit.mock.calls).toEqual([[1, "'/docs/talk.md' contains no visible slides"]]);
    expect(mainWin.show).not.toHaveBeenCalled();
  });

  it('never auto-enters outside a cold start', async () => {
    const { result } = setup();
    await flush();
    expect(result.current.presentMode).toBe(false);
    expect(mainWin.show).not.toHaveBeenCalled();
  });
});

describe('usePresentationSession: wake lock', () => {
  it('releases on mount, holds while presenting, releases on exit', async () => {
    const { result } = setup();
    expect(ipc.setWakeLock.mock.calls).toEqual([[false]]);
    await enter(result);
    expect(ipc.setWakeLock).toHaveBeenLastCalledWith(true);
    await act(async () => { await result.current.handlePresentExit(); });
    expect(ipc.setWakeLock).toHaveBeenLastCalledWith(false);
  });
});
