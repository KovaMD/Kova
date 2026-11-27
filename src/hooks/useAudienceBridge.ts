// Events between the main window and the audience window while presenting.
import { useEffect } from 'react';
import { emitTo, listen } from '@tauri-apps/api/event';
import { bestEffort } from '../platform/bestEffort';

export interface UseAudienceBridgeOptions {
  presentMode: boolean;
  presenterMode: boolean;
  safePresentIndex: number;
  safePresentStep: number;
  setPresentIndex: (index: number) => void;
  setPresentStep: (step: number) => void;
}

export function useAudienceBridge({
  presentMode, presenterMode, safePresentIndex, safePresentStep, setPresentIndex, setPresentStep,
}: UseAudienceBridgeOptions): void {
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
    // Table-of-contents clicks on the audience-facing screen: the audience
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
  }, [presentMode, presenterMode, setPresentIndex, setPresentStep]);

  // Mirror mode: keep the audience window in sync with the presenter's slide.
  // Dual mode sync is handled by PresenterOverlay; this covers mirror mode where
  // PresentationOverlay drives navigation but never emits present:navigate.
  useEffect(() => {
    if (!presentMode) return;
    void bestEffort(emitTo('audience', 'present:navigate', { index: safePresentIndex, step: safePresentStep }), 'present:navigate');
  }, [presentMode, safePresentIndex, safePresentStep]);
}
