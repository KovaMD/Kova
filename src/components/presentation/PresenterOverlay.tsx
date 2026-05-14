import { useCallback, useEffect, useRef, useState } from 'react';
import { emitTo } from '@tauri-apps/api/event';
import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import type { NotesFontSize } from '../../store/settings';
import { SlideRenderer } from '../preview/SlideRenderer';
import './PresenterOverlay.css';

interface Props {
  slides: Slide[];
  currentIndex: number;
  theme: Theme;
  docTitle?: string;
  aspectRatio: AspectRatio;
  showNextSlide: boolean;
  showTimer: boolean;
  notesFontSize: NotesFontSize;
  onNavigate: (index: number) => void;
  onExit: () => void;
}

const HUD_H       = 56;  // px
const RIGHT_W     = 280; // px
const SLIDE_W     = 960; // virtual slide width — matches PresentationOverlay / AudienceApp

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PresenterOverlay({
  slides, currentIndex, theme, docTitle, aspectRatio,
  showNextSlide, showTimer, notesFontSize, onNavigate, onExit,
}: Props) {
  const slide     = slides[currentIndex];
  const nextSlide = slides[currentIndex + 1] ?? null;
  const total     = slides.length;

  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  const [elapsed, setElapsed]           = useState(0);
  const [currentScale, setCurrentScale] = useState(1);
  const [nextScale, setNextScale]       = useState(1);
  const startTime      = useRef(Date.now());
  const overlayRef     = useRef<HTMLDivElement>(null);
  const currentFrameRef = useRef<HTMLDivElement>(null);
  const nextFrameRef    = useRef<HTMLDivElement>(null);

  useEffect(() => { overlayRef.current?.focus(); }, []);

  useEffect(() => {
    if (!currentFrameRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setCurrentScale(entry.contentRect.width / SLIDE_W);
    });
    obs.observe(currentFrameRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!showNextSlide || !nextSlide || !nextFrameRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setNextScale(entry.contentRect.width / SLIDE_W);
    });
    obs.observe(nextFrameRef.current);
    return () => obs.disconnect();
  }, [showNextSlide, nextSlide]);

  // Timer
  useEffect(() => {
    if (!showTimer) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [showTimer]);

  // Sync navigation to audience window
  useEffect(() => {
    emitTo('audience', 'present:navigate', { index: currentIndex }).catch(() => {});
  }, [currentIndex]);

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, total, onNavigate]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown':
          e.preventDefault(); goNext(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          e.preventDefault(); goPrev(); break;
        case 'Escape':
          e.preventDefault(); onExit(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, onExit]);

  if (!slide) return null;

  return (
    <div
      className="pres-presenter"
      ref={overlayRef}
      tabIndex={-1}
      style={{
        outline: 'none',
        '--pres-ar-w': aspectRatio.w,
        '--pres-ar-h': aspectRatio.h,
        '--presenter-right-w': `${RIGHT_W}px`,
        '--presenter-hud-h': `${HUD_H}px`,
      } as React.CSSProperties}
    >
      <div className="pres-presenter__main">

        {/* ── Current slide ── */}
        <div className="pres-presenter__current">
          <div className="pres-presenter__current-frame" ref={currentFrameRef}>
            <div style={{
              width: SLIDE_W,
              height: slideH,
              transform: `scale(${currentScale})`,
              transformOrigin: 'top left',
            }}>
              <SlideRenderer
                slide={slide}
                theme={theme}
                slideNumber={currentIndex + 1}
                totalSlides={total}
                docTitle={docTitle}
              />
            </div>
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="pres-presenter__right">

          {/* Next slide preview */}
          {showNextSlide && (
            <div className="pres-presenter__next">
              <div className="pres-presenter__next-label">
                {nextSlide ? 'Next' : 'End of presentation'}
              </div>
              {nextSlide && (
                <div className="pres-presenter__next-frame" ref={nextFrameRef}>
                  <div style={{
                    width: SLIDE_W,
                    height: slideH,
                    transform: `scale(${nextScale})`,
                    transformOrigin: 'top left',
                  }}>
                    <SlideRenderer
                      slide={nextSlide}
                      theme={theme}
                      slideNumber={currentIndex + 2}
                      totalSlides={total}
                      docTitle={docTitle}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Speaker notes */}
          <div className="pres-presenter__notes">
            <div className="pres-presenter__notes-label">Speaker notes</div>
            {slide.speakerNotes ? (
              <p className={`pres-presenter__notes-text pres-presenter__notes-text--${notesFontSize}`}>
                {slide.speakerNotes}
              </p>
            ) : (
              <span className="pres-presenter__notes-empty">No notes for this slide</span>
            )}
          </div>

        </div>
      </div>

      {/* ── HUD ── */}
      <div className="pres-presenter__hud">
        <div className="pres-presenter__hud-group">
          <button
            className="pres-presenter__btn"
            onClick={goPrev}
            disabled={currentIndex === 0}
            title="Previous (←)"
          >‹</button>
          <span className="pres-presenter__counter">{currentIndex + 1} / {total}</span>
          <button
            className="pres-presenter__btn"
            onClick={goNext}
            disabled={currentIndex === total - 1}
            title="Next (→ / Space)"
          >›</button>
        </div>

        {showTimer && (
          <>
            <div className="pres-presenter__hud-divider" />
            <span className="pres-presenter__timer" title="Elapsed time">
              {formatTime(elapsed)}
            </span>
          </>
        )}

        <div className="pres-presenter__hud-divider" />

        <button
          className="pres-presenter__btn pres-presenter__btn--exit"
          onClick={onExit}
          title="Exit presentation (Esc)"
        >✕ Exit</button>
      </div>
    </div>
  );
}
