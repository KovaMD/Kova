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
  aspectRatio?: AspectRatio;
  slideTransition?: boolean;
  onNavigate: (index: number) => void;
  onExit: () => void;
}

const HUD_H   = 40;   // px — HUD bar height
const NOTE_H  = 160;  // px — speaker notes panel height
const SLIDE_W = 960;  // virtual slide width (matches ThumbnailPanel)

export function PresentationOverlay({
  slides, currentIndex, theme, docTitle, aspectRatio = { w: 16, h: 9 }, slideTransition, onNavigate, onExit,
}: Props) {
  const slide = slides[currentIndex];
  const total = slides.length;

  const [showNotes, setShowNotes] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [scale, setScale] = useState(1);
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
          e.preventDefault(); goNext(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          e.preventDefault(); goPrev(); break;
        case 'n': case 'N':
          if (slide?.speakerNotes) setShowNotes((p) => !p);
          break;
        case 'Escape':
          e.preventDefault(); onExit(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, onExit, slide]);

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

  // ── Click-to-navigate (left third = prev, rest = next) ────────────────────

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const x = e.clientX / window.innerWidth;
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
        style={{ cursor: hudVisible ? 'default' : 'none' }}
      >
        <div ref={frameRef} className="pres-slide-frame">
          <div
            key={currentIndex}
            style={{
              width: SLIDE_W,
              height: slideH,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              animation: slideTransition !== false ? 'pres-fadein 0.3s ease' : undefined,
            }}
          >
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

        {hasNotes && (
          <button
            className={`pres-hud__btn${showNotes ? ' pres-hud__btn--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowNotes((p) => !p); }}
            title="Toggle speaker notes (N)"
          >Notes</button>
        )}

        <button
          className="pres-hud__btn pres-hud__btn--exit"
          onClick={(e) => { e.stopPropagation(); onExit(); }}
          title="Exit presentation (Esc)"
        >✕ ESC</button>
      </div>
    </div>
  );
}
