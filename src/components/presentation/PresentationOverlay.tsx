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
  onNavigate: (index: number) => void;
  onExit: () => void;
}

const HUD_H  = 40;  // px — HUD bar height
const NOTE_H = 160; // px — speaker notes panel height

export function PresentationOverlay({
  slides, currentIndex, theme, docTitle, aspectRatio = { w: 16, h: 9 }, onNavigate, onExit,
}: Props) {
  const slide = slides[currentIndex];
  const total = slides.length;

  const [showNotes, setShowNotes] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
      style={{
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
        <div className="pres-slide-frame">
          <SlideRenderer
            slide={slide}
            theme={theme}
            slideNumber={currentIndex + 1}
            totalSlides={total}
            docTitle={docTitle}
          />
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
