import { createContext } from 'react';

// Context passed to child components so they can adapt for thumbnail vs full rendering
export interface SlideCtxValue {
  isThumbnail: boolean; hideOverflowBadge: boolean; textColor: string; mermaidInit: string;
  tocNumbered: boolean; onDiagramReady?: () => void; onNavigateTo?: (slideIndex: number) => void;
  /**
   * Build-reveal visibility cutoff: a stepped element is visible when
   * `step <= revealThreshold`. `undefined` means "no gating" — every element
   * renders fully revealed, the default for thumbnails, exports, and print,
   * where there's no notion of "having clicked through" a slide yet.
   * Presentation/presenter/audience overlays are the only consumers that ever
   * set this (via SlideRenderer's `revealStepIndex` prop).
   */
  revealThreshold?: number;
  /** The one step value that just became visible on this render — drives the
   *  one-off reveal transition on exactly the matching StepGate instance.
   *  Only set for a genuine forward single-step advance on the same slide. */
  enteringStep?: number;
}
export const SlideCtx = createContext<SlideCtxValue>({ isThumbnail: false, hideOverflowBadge: false, textColor: '#1a1a1a', mermaidInit: '', tocNumbered: true });
