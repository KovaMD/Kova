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
  docDate?: string;
  aspectRatio: AspectRatio;
  showNextSlide: boolean;
  showTimer: boolean;
  notesFontSize: NotesFontSize;
  laserColor?: string;
  onNavigate: (index: number) => void;
  onExit: () => void;
}

const HUD_H           = 56;  // px
const RIGHT_W_DEFAULT = 280; // px
const RIGHT_W_MIN     = 180; // px
const RIGHT_W_MAX     = 600; // px
const SLIDE_W         = 960; // virtual slide width — matches PresentationOverlay / AudienceApp
const STORAGE_KEY     = 'kova:presenter-right-w';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PresenterOverlay({
  slides, currentIndex, theme, docTitle, docDate, aspectRatio,
  showNextSlide, showTimer, notesFontSize, laserColor = '#ff2020', onNavigate, onExit,
}: Props) {
  const slide     = slides[currentIndex];
  const nextSlide = slides[currentIndex + 1] ?? null;
  const total     = slides.length;

  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  const [rightW, setRightW] = useState(() => {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return RIGHT_W_DEFAULT;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? Math.min(RIGHT_W_MAX, Math.max(RIGHT_W_MIN, n)) : RIGHT_W_DEFAULT;
  });

  const [elapsed, setElapsed]           = useState(0);
  const [currentScale, setCurrentScale] = useState(1);
  const [nextScale, setNextScale]       = useState(1);
  const [showNotes, setShowNotes]       = useState(true);
  const [laserActive, setLaserActive]   = useState(false);
  const [laserPos, setLaserPos]         = useState<{ x: number; y: number } | null>(null);
  const startTime      = useRef(Date.now());
  const overlayRef     = useRef<HTMLDivElement>(null);
  const currentFrameRef = useRef<HTMLDivElement>(null);
  const nextFrameRef    = useRef<HTMLDivElement>(null);
  const didMountRef    = useRef(false);

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

  // Clear laser and notify audience when deactivated
  useEffect(() => {
    if (!laserActive) {
      setLaserPos(null);
      emitTo('audience', 'present:laser', { x: 0, y: 0, active: false }).catch(() => {});
    }
  }, [laserActive]);

  // Sync navigation to audience window. Skip the mount-time fire because
  // present:init already carries the starting index; only emit on real navigations.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    emitTo('audience', 'present:navigate', { index: currentIndex }).catch(() => {});
  }, [currentIndex]);

  const handleCurrentFrameMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!currentFrameRef.current) return;
    const rect = currentFrameRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setLaserPos({ x, y });
    if (laserActive) {
      emitTo('audience', 'present:laser', { x, y, active: true, color: laserColor }).catch(() => {});
    }
  }, [laserActive, laserColor]);

  const handleResizeDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightW;
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(RIGHT_W_MAX, Math.max(RIGHT_W_MIN, startW + (startX - ev.clientX)));
      setRightW(newW);
    };
    const onUp = () => {
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      setRightW(w => { localStorage.setItem(STORAGE_KEY, String(w)); return w; });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightW]);

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
          e.preventDefault(); e.stopPropagation(); goNext(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          e.preventDefault(); e.stopPropagation(); goPrev(); break;
        case 'Home':
          e.preventDefault(); e.stopPropagation(); onNavigate(0); break;
        case 'End':
          e.preventDefault(); e.stopPropagation(); onNavigate(total - 1); break;
        case 'n': case 'N':
          e.preventDefault(); e.stopPropagation();
          setShowNotes((p) => !p); break;
        case 'l': case 'L':
          e.preventDefault(); e.stopPropagation();
          setLaserActive((p) => !p); break;
        case 'Escape':
          e.preventDefault(); e.stopPropagation(); onExit(); break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [goNext, goPrev, onNavigate, total, onExit]);

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
        '--presenter-right-w': `${rightW}px`,
        '--presenter-hud-h': `${HUD_H}px`,
      } as React.CSSProperties}
    >
      <div className="pres-presenter__main">

        {/* ── Current slide ── */}
        <div className="pres-presenter__current">
          <div
            className="pres-presenter__current-frame"
            ref={currentFrameRef}
            onMouseMove={handleCurrentFrameMouseMove}
            style={{ cursor: laserActive ? 'crosshair' : undefined }}
          >
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
                docDate={docDate}
              />
            </div>
            {laserActive && laserPos && (
              <div
                className="pres-laser-dot"
                style={{
                  left: `${laserPos.x * 100}%`,
                  top: `${laserPos.y * 100}%`,
                  background: laserColor,
                  boxShadow: `0 0 6px 2px ${laserColor}b3, 0 0 16px 5px ${laserColor}4d`,
                }}
              />
            )}
          </div>
        </div>

        {/* ── Resize handle ── */}
        <div className="pres-presenter__resize-handle" onMouseDown={handleResizeDragStart} />

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
                      docDate={docDate}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Speaker notes */}
          <div className="pres-presenter__notes">
            <div className="pres-presenter__notes-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Speaker notes
              <button
                className={`pres-presenter__btn${showNotes ? '' : ' pres-presenter__btn--active'}`}
                onClick={() => setShowNotes((p) => !p)}
                title="Toggle notes (N)"
                style={{ fontSize: 10, padding: '2px 6px' }}
              >{showNotes ? 'Hide' : 'Show'}</button>
            </div>
            {showNotes && (slide.speakerNotes ? (
              <p className={`pres-presenter__notes-text pres-presenter__notes-text--${notesFontSize}`}>
                {slide.speakerNotes}
              </p>
            ) : (
              <span className="pres-presenter__notes-empty">No notes for this slide</span>
            ))}
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
          className={`pres-presenter__btn${laserActive ? ' pres-presenter__btn--active' : ''}`}
          onClick={() => setLaserActive((p) => !p)}
          title="Toggle laser pointer (L)"
        >Laser</button>

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
