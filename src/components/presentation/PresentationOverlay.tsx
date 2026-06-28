import { useEffect, useCallback, useRef, useState } from 'react';
import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { SlideRenderer } from '../preview/SlideRenderer';
import './PresentationOverlay.css';

interface Props {
  slides: Slide[];
  currentIndex: number;
  theme: Theme;
  docTitle?: string;
  docDate?: string;
  aspectRatio?: AspectRatio;
  laserColor?: string;
  showTimer?: boolean;
  onNavigate: (index: number) => void;
  onExit: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const HUD_H   = 40;   // px — HUD bar height
const NOTE_H  = 160;  // px — speaker notes panel height
const SLIDE_W = 960;  // virtual slide width (matches ThumbnailPanel)

export function PresentationOverlay({
  slides, currentIndex, theme, docTitle, docDate, aspectRatio = { w: 16, h: 9 }, laserColor = '#ff2020', showTimer = false, onNavigate, onExit,
}: Props) {
  const slide = slides[currentIndex];
  const total = slides.length;

  const [showNotes, setShowNotes] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [laserActive, setLaserActive] = useState(false);
  const [laserPos, setLaserPos] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(() => {
    // Mirror the CSS: min(100vw, (100vh - HUD_H) * ar.w / ar.h) / SLIDE_W
    const frameW = Math.min(window.innerWidth, (window.innerHeight - HUD_H) * aspectRatio.w / aspectRatio.h);
    return frameW / SLIDE_W;
  });
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const overlayRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  // Claim focus on mount so keyboard events reach the window after the macOS
  // fullscreen animation hands control back to the WebView.
  useEffect(() => { overlayRef.current?.focus(); }, []);

  // Track the frame's actual rendered width so we can scale the virtual
  // slide to fill it — same technique as ThumbnailPanel.
  useEffect(() => {
    if (!frameRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / SLIDE_W);
    });
    obs.observe(frameRef.current);
    return () => obs.disconnect();
  }, []);

  // Timer
  useEffect(() => {
    if (!showTimer) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [showTimer]);

  // ── Navigation helpers ─────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, total, onNavigate]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  // ── Keyboard handler ───────────────────────────────────────────────────────

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
          if (slide?.speakerNotes) setShowNotes((p) => !p);
          break;
        case 'l': case 'L':
          e.preventDefault(); e.stopPropagation();
          setLaserActive((p) => !p);
          break;
        case 'Escape':
          e.preventDefault(); e.stopPropagation(); onExit(); break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [goNext, goPrev, onNavigate, total, onExit, slide]);

  // Clear laser position when deactivated
  useEffect(() => { if (!laserActive) setLaserPos(null); }, [laserActive]);

  // ── Mouse idle → hide HUD and cursor ──────────────────────────────────────

  const resetIdle = useCallback(() => {
    setHudVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setHudVisible(false), 3000);
  }, []);

  useEffect(() => {
    resetIdle();
    return () => clearTimeout(idleTimer.current);
  }, [resetIdle]);

  // ── Laser pointer tracking ─────────────────────────────────────────────────

  const handleFrameMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!laserActive || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    setLaserPos({
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    });
  }, [laserActive]);

  // ── Click-to-navigate (left third = prev, rest = next) ────────────────────

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.3) goPrev(); else goNext();
  }, [goPrev, goNext]);

  if (!slide) return null;

  const notesH  = showNotes && slide.speakerNotes ? NOTE_H : 0;
  const hasNotes = Boolean(slide.speakerNotes);

  return (
    <div
      className="pres-overlay"
      ref={overlayRef}
      tabIndex={-1}
      style={{ outline: 'none',
        '--pres-notes-h': `${notesH}px`,
        '--pres-hud-h': `${HUD_H}px`,
        '--pres-ar-w': aspectRatio.w,
        '--pres-ar-h': aspectRatio.h,
      } as React.CSSProperties}
      onMouseMove={resetIdle}
    >
      {/* ── Slide area ── */}
      <div className="pres-slide-area" onClick={handleClick}
        style={{ cursor: laserActive ? 'crosshair' : hudVisible ? 'default' : 'none' }}
      >
        <div ref={frameRef} className="pres-slide-frame" onMouseMove={handleFrameMouseMove}>
          <div
            style={{
              width: SLIDE_W,
              height: slideH,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            <SlideRenderer
              slide={slide}
              theme={theme}
              slideNumber={currentIndex + 1}
              totalSlides={total}
              docTitle={docTitle}
              docDate={docDate}
            />
          </div>
          <div
            key={currentIndex}
            style={{
              position: 'absolute',
              inset: 0,
              background: '#000',
              animation: 'pres-fadeout 0.3s ease forwards',
              pointerEvents: 'none',
            }}
          />
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

      {/* ARIA live region announces slide changes to screen readers */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {`Slide ${currentIndex + 1} of ${total}`}
      </div>

      {/* ── Speaker notes ── */}
      {showNotes && slide.speakerNotes && (
        <div className="pres-notes">
          <span className="pres-notes__label">Speaker notes</span>
          <p className="pres-notes__text">{slide.speakerNotes}</p>
        </div>
      )}

      {/* ── HUD ── */}
      <div className="pres-hud" style={{ opacity: hudVisible ? 1 : 0 }}>
        <button
          className="pres-hud__btn"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          disabled={currentIndex === 0}
          title="Previous (←)"
        >‹</button>

        <span className="pres-hud__counter">{currentIndex + 1} / {total}</span>

        <button
          className="pres-hud__btn"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          disabled={currentIndex === total - 1}
          title="Next (→ / Space)"
        >›</button>

        {showTimer && (
          <span className="pres-hud__timer" title="Elapsed time">{formatTime(elapsed)}</span>
        )}

        {hasNotes && (
          <button
            className={`pres-hud__btn${showNotes ? ' pres-hud__btn--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowNotes((p) => !p); }}
            title="Toggle speaker notes (N)"
          >Notes</button>
        )}

        <button
          className={`pres-hud__btn${laserActive ? ' pres-hud__btn--active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setLaserActive((p) => !p); }}
          title="Toggle laser pointer (L)"
        >Laser</button>

        <button
          className="pres-hud__btn pres-hud__btn--exit"
          onClick={(e) => { e.stopPropagation(); onExit(); }}
          title="Exit presentation (Esc)"
        >✕ ESC</button>
      </div>
    </div>
  );
}
