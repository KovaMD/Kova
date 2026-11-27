import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as ipc from '../platform/ipc';
import {
  closeAudienceWindow,
  createAudienceWindow,
  detectMonitors,
  emitPresentExit,
  onAudienceReady,
  positionAudienceWindow,
  sendPresentInit,
} from '../platform/audienceWindow';
import { pickExternalMonitor } from '../engine/pickExternalMonitor';
import type { AspectRatio, Slide } from '../engine/types';
import type { Theme } from '../engine/theme';
import type { AppSettings } from '../store/settings';
import type { Translator } from '../i18n';
import type { PresentInitPayload } from '../AudienceApp';

/** Why a presentation session ended; picks the cold-start exit code/message. */
export type EndSessionReason =
  /** The presenter exited (Esc, exit button, Toolbar). */
  | 'exit'
  /** present:ready never arrived from the audience window. */
  | 'timeout'
  /** The audience window could not be created (tauri://error). */
  | 'error'
  /** The audience window was closed externally (tauri://destroyed). */
  | 'destroyed';

/** How a cold-started (`kova --present`) session quits for each reason. */
const COLD_EXIT: Record<EndSessionReason, { code: number; message?: string }> = {
  exit: { code: 0 },
  timeout: { code: 1, message: 'presentation window did not respond in time' },
  error: { code: 1, message: 'failed to create the presentation window' },
  destroyed: { code: 0 },
};

/** How long to wait for the audience window's present:ready. */
export const AUDIENCE_READY_TIMEOUT_MS = 10_000;
/** Interval at which presenter always-on-top is reasserted (Windows). */
export const ALWAYS_ON_TOP_REASSERT_MS = 2000;

export type PresentationSettings = Pick<
  AppSettings,
  'presentationMode' | 'presenterWindowed' | 'presenterAlwaysOnTop'
>;

export interface UsePresentationSessionOptions {
  /** The full editor deck (hidden slides included). */
  slides: Slide[];
  /** Deck to present: hidden slides removed, entries reference-equal to `slides`. */
  visibleSlides: Slide[];
  /** Clamped editor slide index, for "present from current". */
  safeSlideIndex: number;
  /** Clamped presented slide index, where the editor lands on exit. */
  safePresentIndex: number;
  setCurrentSlideIndex: (index: number) => void;
  setPresentIndex: (index: number) => void;
  setPresentStep: (step: number) => void;
  activeTheme: Theme;
  aspectRatio: AspectRatio;
  docTitle: string;
  docAuthor: string;
  docDate: string;
  settings: PresentationSettings;
  /** Session started via `kova --present`: ending the presentation quits. */
  coldPresent: boolean;
  /** Open document; the cold-start auto-enter waits for it to be applied. */
  filePath: string | null;
  /** Shows a transient warning (the audience-window timeout). */
  onWarn: (message: string) => void;
  t: Translator;
}

export interface UsePresentationSessionResult {
  /** Single-screen (or mirror) presentation overlay is showing. */
  presentMode: boolean;
  /** Dual-screen presenter view is showing. */
  presenterMode: boolean;
  /**
   * Start presenting. A boolean (keyboard path) or a MouseEvent with altKey
   * (alt+click path) means "present from the current slide".
   */
  handlePresentEnter: (eOrFromCurrent?: React.MouseEvent | boolean) => Promise<void>;
  handlePresentExit: () => Promise<void>;
}

/**
 * The presentation session: entering (monitor selection, audience window
 * lifecycle, fullscreen, presenter always-on-top), exiting, the display wake
 * lock, and the cold-start (`kova --present`) auto-enter.
 */
export function usePresentationSession({
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
  onWarn,
  t,
}: UsePresentationSessionOptions): UsePresentationSessionResult {
  const [presentMode, setPresentMode] = useState(false);
  const [presenterMode, setPresenterMode] = useState(false);

  // Cold-start guard: presentation must be entered exactly once
  // (visibleSlides/handlePresentEnter identity changes re-run the auto-enter
  // effect).
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

  // Where the editor lands after a presenter exit (translate visible→full).
  // Render-updated so endSession keeps a stable identity across navigation.
  const landEditorRef = useRef<() => void>(() => {});
  landEditorRef.current = () => {
    const full = slides.indexOf(visibleSlides[safePresentIndex]);
    if (full >= 0) setCurrentSlideIndex(full);
  };

  // Reset after a failed or ended presentation (PRD D5): the one place the
  // session is torn down, whatever ended it.
  const endSession = useCallback(async (reason: EndSessionReason) => {
    stopAlwaysOnTopReassert();
    // Cold-started session (kova --present): ending the presentation is
    // exiting the app — there is no editor session to return to. Release the
    // wake lock explicitly first: cli_exit is a hard process exit, so the
    // effect that normally releases it on presentMode→false never runs, and
    // an orphaned macOS caffeinate child would keep the machine awake.
    if (coldPresentRef.current) {
      const { code, message } = COLD_EXIT[reason];
      await ipc.setWakeLock(false).catch(() => {});
      await ipc.cliExit(code, message).catch(() => {});
      return;
    }
    setPresentMode(false);
    setPresenterMode(false);
    if (reason === 'exit') landEditorRef.current();
    // The audience window never answered: say so rather than leaving the
    // user wondering why the second screen stayed blank.
    if (reason === 'timeout') onWarn(t('presentation.audienceWindowTimeout'));
    await getCurrentWindow().setFullscreen(false).catch(() => {});
    await getCurrentWindow().setAlwaysOnTop(false).catch(() => {});
  }, [stopAlwaysOnTopReassert, onWarn, t]);

  const handlePresentExit = useCallback(async () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    await emitPresentExit();
    // Close the audience window directly — the present:exit event may not be
    // processed promptly if macOS App Nap has throttled the window's WebView
    // after extended idle time (typically 10+ minutes on an external display).
    await closeAudienceWindow();
    await endSession('exit');
    // A cold-start exit never gets here usefully (cli_exit quits), so the
    // guard is left set there, as before.
    if (!coldPresentRef.current) isExitingRef.current = false;
  }, [endSession]);

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
    const { all, current } = await detectMonitors();
    const external = pickExternalMonitor(all, current);

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
        await closeAudienceWindow();

        // Register ready listener BEFORE creating the window to avoid missing the event.
        // Use `let` so the timeout callback can also reach it: as a `const`
        // declared after the await, an early timeout would hit the TDZ.
        // eslint-disable-next-line prefer-const
        let unlistenReady: (() => void) | undefined;
        const readyTimeoutId = setTimeout(() => {
          // present:ready never fired — window creation silently failed or its
          // content is hung. Ends the session like the tauri://error and
          // tauri://destroyed handlers below (cold-start exits via cli_exit)
          // rather than just cleaning up the listener and leaving the app
          // stuck fullscreened with no audience window and no error shown.
          if (presentSessionRef.current !== sessionId) return; // stale session
          unlistenReady?.();
          audienceWin.close().catch(() => {});
          void endSession('timeout');
        }, AUDIENCE_READY_TIMEOUT_MS);

        unlistenReady = await onAudienceReady(async () => {
          clearTimeout(readyTimeoutId);
          unlistenReady?.();
          await sendPresentInit(initPayload);

          // Drive positioning + fullscreen via Rust.
          await positionAudienceWindow(external);
          // Reclaim focus on the presenter window — the audience window creation
          // may steal it even with focus:false, depending on the compositor.
          await getCurrentWindow().setFocus().catch(() => {});
        });

        const audienceWin = createAudienceWindow(external);

        // If window creation fails, clean up the ready listener and reset state.
        // Cold-started sessions have no editor to fall back to — report and quit.
        audienceWin.once('tauri://error', () => {
          clearTimeout(readyTimeoutId);
          unlistenReady?.();
          void endSession('error');
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
          void endSession('destroyed');
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
              }, ALWAYS_ON_TOP_REASSERT_MS);
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
  }, [slides, visibleSlides, safeSlideIndex, activeTheme, aspectRatio, docTitle, docAuthor, docDate, settings.presentationMode, settings.presenterWindowed, settings.presenterAlwaysOnTop, endSession, stopAlwaysOnTopReassert, setPresentIndex, setPresentStep]);

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
      ipc.cliExit(1, `'${filePath}' contains no visible slides`).catch(() => {});
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
    ipc.setWakeLock(presentMode || presenterMode).catch(() => {});
  }, [presentMode, presenterMode]);

  return { presentMode, presenterMode, handlePresentEnter, handlePresentExit };
}
