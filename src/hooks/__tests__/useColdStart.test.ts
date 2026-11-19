// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Slide } from '../../engine/types';
import { BUILT_IN_THEMES } from '../../engine/theme';
import type { PendingCli, PendingExport } from '../../types/cli';

// ── Fakes ────────────────────────────────────────────────────────────────────
// The cold-start logic itself is covered in src/cli/__tests__/coldStart.test.ts;
// these tests cover the hook wiring: run-once guards, the media gate and the
// hand-off from the cold load to the cold export.

const cold = vi.hoisted(() => ({
  pending: null as unknown,
  getPendingCli: vi.fn(),
  runColdLoad: vi.fn(),
  runColdExport: vi.fn(async () => {}),
}));
vi.mock('../../cli/coldStart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cli/coldStart')>();
  return {
    ...actual,
    getPendingCli: cold.getPendingCli,
    runColdLoad: cold.runColdLoad,
    runColdExport: cold.runColdExport,
  };
});

import {
  MEDIA_WAIT_TIMEOUT_MS,
  useColdExport,
  useColdLoad,
  useColdStartState,
  useLocalMediaGate,
  type UseColdExportOptions,
} from '../useColdStart';

const slide = (src?: string): Slide =>
  ({
    elements: src ? [{ type: 'image', src }] : [],
    speakerNotes: '',
    hidden: false,
  }) as unknown as Slide;

const exportReq: PendingExport = {
  format: 'pptx', input: '/d/deck.md', output: '/d/deck.pptx', notes: false, per_page: null, paper: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  cold.pending = null;
  cold.getPendingCli.mockImplementation(async () => cold.pending);
  cold.runColdLoad.mockImplementation(async () => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useColdStartState', () => {
  it('starts with no cold present and no cold export', () => {
    const { result } = renderHook(() => useColdStartState());
    expect(result.current.coldPresent).toBe(false);
    expect(result.current.coldExport).toBeNull();
    act(() => result.current.setColdPresent(true));
    act(() => result.current.setColdExport(exportReq));
    expect(result.current.coldPresent).toBe(true);
    expect(result.current.coldExport).toBe(exportReq);
  });
});

describe('useColdLoad', () => {
  function setup() {
    const applyFileContent = vi.fn(async () => {});
    const applyCliTheme = vi.fn();
    return renderHook(
      (props: { apply: typeof applyFileContent }) => {
        const state = useColdStartState();
        useColdLoad({ cold: state, applyFileContent: props.apply, applyCliTheme });
        return state;
      },
      { initialProps: { apply: applyFileContent } },
    );
  }

  it('passes the drained CLI request to runColdLoad, whose ports drive the session flags', async () => {
    const req = { present: '/d/deck.md' } as PendingCli;
    cold.pending = req;
    cold.runColdLoad.mockImplementation(async (_cli, ports) => {
      ports.claim();
      ports.startColdPresent();
      ports.startColdExport(exportReq);
    });
    const { result } = setup();
    await act(async () => {});
    expect(cold.runColdLoad).toHaveBeenCalledTimes(1);
    expect(cold.runColdLoad.mock.calls[0][0]).toBe(req);
    expect(result.current.coldPresent).toBe(true);
    expect(result.current.coldExport).toBe(exportReq);
  });

  it('runs once claimed, even when applyFileContent changes identity', async () => {
    cold.runColdLoad.mockImplementation(async (_cli, ports) => { ports.claim(); });
    const { rerender } = setup();
    await act(async () => {});
    rerender({ apply: vi.fn(async () => {}) });
    await act(async () => {});
    expect(cold.runColdLoad).toHaveBeenCalledTimes(1);
  });

  it('re-checks on a dep change while nothing has claimed the load', async () => {
    const { rerender } = setup();
    await act(async () => {});
    rerender({ apply: vi.fn(async () => {}) });
    await act(async () => {});
    expect(cold.runColdLoad).toHaveBeenCalledTimes(2);
  });
});

describe('useLocalMediaGate', () => {
  it('reports pending local media and expires the wait after the timeout', () => {
    vi.useFakeTimers();
    const slides = [slide('asset://localhost/a.png')];
    const { result } = renderHook(() => useLocalMediaGate(slides));
    expect(result.current).toEqual({ hasPendingLocalMedia: true, mediaWaitExpired: false });
    act(() => { vi.advanceTimersByTime(MEDIA_WAIT_TIMEOUT_MS - 1); });
    expect(result.current.mediaWaitExpired).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.mediaWaitExpired).toBe(true);
  });

  it('resets the expiry once media resolves', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((s: Slide[]) => useLocalMediaGate(s), {
      initialProps: [slide('asset://localhost/a.png')],
    });
    act(() => { vi.advanceTimersByTime(MEDIA_WAIT_TIMEOUT_MS); });
    expect(result.current.mediaWaitExpired).toBe(true);
    rerender([slide('data:image/png;base64,AA')]);
    expect(result.current).toEqual({ hasPendingLocalMedia: false, mediaWaitExpired: false });
  });
});

describe('useColdExport', () => {
  const base = (over: Partial<UseColdExportOptions> = {}): UseColdExportOptions => ({
    coldExport: exportReq,
    filePath: '/d/deck.md',
    mediaGate: { hasPendingLocalMedia: false, mediaWaitExpired: false },
    visibleSlides: [slide()],
    frontmatter: {},
    activeTheme: BUILT_IN_THEMES[0],
    locale: 'en',
    pdfPageSize: 'a4',
    runPdfExportCapture: vi.fn(),
    runHtmlExportCapture: vi.fn(),
    ...over,
  });

  it('does nothing until there is an export request and a loaded file', () => {
    const { rerender } = renderHook((o: UseColdExportOptions) => useColdExport(o), {
      initialProps: base({ coldExport: null }),
    });
    rerender(base({ filePath: null }));
    expect(cold.runColdExport).not.toHaveBeenCalled();
  });

  it('fires once with the deck context', () => {
    const opts = base();
    const { rerender } = renderHook((o: UseColdExportOptions) => useColdExport(o), { initialProps: opts });
    expect(cold.runColdExport).toHaveBeenCalledTimes(1);
    expect(cold.runColdExport).toHaveBeenCalledWith(exportReq, {
      filePath: '/d/deck.md',
      visibleSlides: opts.visibleSlides,
      frontmatter: opts.frontmatter,
      activeTheme: opts.activeTheme,
      locale: 'en',
      pdfPageSize: 'a4',
      runPdfExportCapture: opts.runPdfExportCapture,
      runHtmlExportCapture: opts.runHtmlExportCapture,
    });
    rerender(base({ visibleSlides: [slide(), slide()] }));
    expect(cold.runColdExport).toHaveBeenCalledTimes(1);
  });

  it('waits for pending local media, then fires when it resolves', () => {
    const { rerender } = renderHook((o: UseColdExportOptions) => useColdExport(o), {
      initialProps: base({ mediaGate: { hasPendingLocalMedia: true, mediaWaitExpired: false } }),
    });
    expect(cold.runColdExport).not.toHaveBeenCalled();
    rerender(base({ mediaGate: { hasPendingLocalMedia: false, mediaWaitExpired: false } }));
    expect(cold.runColdExport).toHaveBeenCalledTimes(1);
  });

  it('fires anyway once the media wait expires', () => {
    const { rerender } = renderHook((o: UseColdExportOptions) => useColdExport(o), {
      initialProps: base({ mediaGate: { hasPendingLocalMedia: true, mediaWaitExpired: false } }),
    });
    rerender(base({ mediaGate: { hasPendingLocalMedia: true, mediaWaitExpired: true } }));
    expect(cold.runColdExport).toHaveBeenCalledTimes(1);
  });
});
