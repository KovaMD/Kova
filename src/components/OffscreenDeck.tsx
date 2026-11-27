import { SLIDE_W } from '../engine/constants';
import type { Slide } from '../engine/types';
import { useDeck } from './preview/DeckContext';
import { SlideRenderer } from './preview/SlideRenderer';

interface OffscreenDeckProps {
  slides: Slide[];
  /** From useOffscreenCapture: registers each slide's wrapper element. */
  setSlideRef: (index: number, el: HTMLElement | null) => void;
  /** From useOffscreenCapture: called once per slide when its diagrams are ready. */
  onSlideReady: () => void;
}

/**
 * Renders a deck at full slide size, off-screen, for PDF/HTML export and
 * Print to capture. Each slide sits in a fixed-size wrapper (SLIDE_W wide,
 * height from the aspect ratio) which is the element handed to the capture.
 * Theme, doc meta and aspect ratio come from DeckContext.
 */
export function OffscreenDeck({
  slides, setSlideRef, onSlideReady,
}: OffscreenDeckProps) {
  const { aspectRatio } = useDeck();
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
      {slides.map((slide, i) => (
        <div
          key={i}
          ref={(el) => setSlideRef(i, el)}
          style={{ width: SLIDE_W, height: slideH, flexShrink: 0, overflow: 'hidden' }}
        >
          <SlideRenderer
            slide={slide}
            slideNumber={i + 1}
            totalSlides={slides.length}
            hideOverflowBadge
            onAllDiagramsReady={onSlideReady}
          />
        </div>
      ))}
    </div>
  );
}
