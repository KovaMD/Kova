import { useCallback, useRef, useState } from 'react';
import type { Slide } from '../engine/types';

/**
 * What an in-flight capture is for. PDF and HTML export share `'export'`;
 * Print is tracked separately because the File menu shows a different label
 * for it and does not disable the export items while it runs.
 */
export type OffscreenCaptureKind = 'export' | 'print';

export interface OffscreenCaptureContext {
  slides: Slide[];
  kind: OffscreenCaptureKind;
}

export interface UseOffscreenCaptureResult {
  /** The slides currently mounted off-screen, or null when idle. */
  context: OffscreenCaptureContext | null;
  /** Kind of the in-flight capture, or null when idle. */
  capturing: OffscreenCaptureKind | null;
  /**
   * Mounts `slides` off-screen, waits for every slide to signal ready, then
   * runs `capture` against the rendered elements (in slide order) and
   * resolves with its result. Rejects (always with an Error) if `capture`
   * throws. Off-screen state is cleared either way.
   */
  runCapture: <T>(
    slides: Slide[],
    capture: (elements: HTMLElement[]) => Promise<T>,
    kind?: OffscreenCaptureKind,
  ) => Promise<T>;
  /** Stable callback: one call per slide once its diagrams have rendered. */
  onSlideReady: () => void;
  /** Stable callback: registers (or, with null, forgets) slide `index`'s element. */
  setSlideRef: (index: number, el: HTMLElement | null) => void;
}

/**
 * The single off-screen capture mechanism behind PDF export, HTML export and
 * Print. Pair with `<OffscreenDeck>`, which renders `context.slides` and wires
 * `setSlideRef` / `onSlideReady`.
 */
export function useOffscreenCapture(): UseOffscreenCaptureResult {
  const [context, setContext] = useState<OffscreenCaptureContext | null>(null);
  const slideRefs  = useRef<Map<number, HTMLElement>>(new Map());
  const runnerRef  = useRef<(() => Promise<void>) | null>(null);
  const readyCount = useRef(0);
  const readyTotal = useRef(0);

  const onSlideReady = useCallback(() => {
    readyCount.current += 1;
    if (readyCount.current >= readyTotal.current) {
      const fn = runnerRef.current;
      runnerRef.current = null;
      // Defer to a task (not a microtask) so React StrictMode's simulated
      // unmount+remount cycle completes before we read element dimensions.
      // Without this, StrictMode detaches the off-screen slide elements between
      // the runner firing and the capture reading offsetWidth, producing a
      // 0x0 canvas and a blank PDF.
      if (fn) setTimeout(() => void fn(), 0);
    }
  }, []);

  const setSlideRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) slideRefs.current.set(index, el);
    else slideRefs.current.delete(index);
  }, []);

  const runCapture = useCallback(<T,>(
    slides: Slide[],
    capture: (elements: HTMLElement[]) => Promise<T>,
    kind: OffscreenCaptureKind = 'export',
  ): Promise<T> => {
    slideRefs.current.clear();
    readyCount.current = 0;
    readyTotal.current = slides.length;
    return new Promise<T>((resolve, reject) => {
      runnerRef.current = async () => {
        try {
          const elements = Array.from(
            { length: slides.length },
            (_, i) => slideRefs.current.get(i),
          ).filter((el): el is HTMLElement => Boolean(el));
          resolve(await capture(elements));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setContext(null);
          slideRefs.current.clear();
          runnerRef.current = null;
        }
      };
      setContext({ slides, kind });
    });
  }, []);

  return {
    context,
    capturing: context?.kind ?? null,
    runCapture,
    onSlideReady,
    setSlideRef,
  };
}
