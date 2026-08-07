import { useEffect, useCallback, useRef, useState } from 'react';
import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { SlideRenderer } from '../preview/SlideRenderer';
import { getSlideStepCount } from '../../engine/layout/steps';
import { SLIDE_W, formatTime, ScaledSlideBox, LaserDot, usePresentationNav } from './presentationShared';
import { useT } from '../../i18n';
import './PresentationOverlay.css';

interface Props {
  slides: Slide[];
  currentIndex: number;
  /** Build-reveal step index for the *current* slide — see usePresentationNav. */
  currentStep: number;
  theme: Theme;
  docTitle?: string;
  docAuthor?: string;
  docDate?: string;
  aspectRatio?: AspectRatio;
  laserColor?: string;
  showTimer?: boolean;
  onNavigate: (index: number, step: number) => void;
  onExit: () => void;
}

const HUD_H   = 40;   // px — HUD bar height
const NOTE_H  = 160;  // px — speaker notes panel height

export function PresentationOverlay({
  slides, currentIndex, currentStep, theme, docTitle, docAuthor, docDate, aspectRatio = { w: 16, h: 9 }, laserColor = '#ff2020', showTimer = false, onNavigate, onExit,
}: Props) {
  const t = useT();
  const slide = slides[currentIndex];

  const handleNavigateTo = useCallback((slideIndex: number) => {
    const visibleIdx = slides.findIndex((s) => s.index === slideIndex);
    if (visibleIdx >= 0) onNavigate(visibleIdx, 0);
  }, [slides, onNavigate]);
  const total = slides.length;
  const getStepCount = useCallback((i: number) => getSlideStepCount(slides[i]), [slides]);

  const [showNotes, setShowNotes] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [laserActive, setLaserActive] = useState(false);
  const [blankMode, setBlankMode] = useState<'black' | 'white' | null>(null);
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

  // ── Mouse/key idle → hide HUD and cursor ──────────────────────────────────

  const resetIdle = useCallback(() => {
    setHudVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setHudVisible(false), 3000);
  }, []);

  // ── Navigation (keyboard + wheel), shared with PresenterOverlay ────────────

  const { goNext, goPrev, jumpInput, setJumpInput } = usePresentationNav({
    total, currentIndex, currentStep, getStepCount, onNavigate, onExit,
    // Only toggle when the slide actually has notes — there's nothing for
    // this audience-facing overlay to show otherwise (contrast
    // PresenterOverlay, which always toggles and shows a placeholder).
    onToggleNotes: () => { if (slide?.speakerNotes) setShowNotes((p) => !p); },
    onToggleBlankBlack: () => setBlankMode((m) => m === 'black' ? null : 'black'),
    onToggleBlankWhite: () => setBlankMode((m) => m === 'white' ? null : 'white'),
    onToggleLaser: () => setLaserActive((p) => !p),
    resetIdle,
  });

  // Clear laser position when deactivated
  useEffect(() => { if (!laserActive) setLaserPos(null); }, [laserActive]);

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
          <ScaledSlideBox scale={scale} slideH={slideH}>
            <SlideRenderer
              slide={slide}
              theme={theme}
              slideNumber={currentIndex + 1}
              totalSlides={total}
              docTitle={docTitle}
              docAuthor={docAuthor}
              docDate={docDate}
              hideOverflowBadge
              onNavigateTo={handleNavigateTo}
              revealStepIndex={currentStep}
            />
          </ScaledSlideBox>
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
            <LaserDot x={laserPos.x} y={laserPos.y} color={laserColor} />
          )}
        </div>
      </div>

      {/* ARIA live region announces slide changes to screen readers */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {t('presentation.slideAnnounce', { current: currentIndex + 1, total })}
      </div>

      {/* ── Speaker notes ── */}
      {showNotes && slide.speakerNotes && (
        <div className="pres-notes">
          <span className="pres-notes__label">{t('presentation.speakerNotes')}</span>
          <p className="pres-notes__text">{slide.speakerNotes}</p>
        </div>
      )}

      {/* ── Blank screen overlay ── */}
      {blankMode && (
        <div style={{ position: 'absolute', inset: 0, background: blankMode, zIndex: 5 }} />
      )}

      {/* ── HUD ── */}
      <div className="pres-hud" style={{ opacity: hudVisible ? 1 : 0 }}>
        <button
          className="pres-hud__btn"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          disabled={currentIndex === 0}
          title={t('presentation.previousSlide')}
        >‹</button>

        {jumpInput !== null ? (
          <input
            className="pres-hud__jump-input"
            type="text"
            inputMode="numeric"
            autoFocus
            onFocus={(e) => e.target.select()}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = parseInt(jumpInput, 10);
                if (!isNaN(n)) onNavigate(Math.min(Math.max(n - 1, 0), total - 1), 0);
                setJumpInput(null);
              } else if (e.key === 'Escape') {
                setJumpInput(null);
              }
            }}
            onBlur={() => setJumpInput(null)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="pres-hud__counter"
            onClick={(e) => { e.stopPropagation(); setJumpInput(String(currentIndex + 1)); }}
            title={t('presentation.jumpToSlide')}
          >{currentIndex + 1} / {total}</span>
        )}

        <button
          className="pres-hud__btn"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          disabled={currentIndex === total - 1}
          title={t('presentation.nextSlide')}
        >›</button>

        {showTimer && (
          <span className="pres-hud__timer" title={t('presentation.elapsedTime')}>{formatTime(elapsed)}</span>
        )}

        {hasNotes && (
          <button
            className={`pres-hud__btn${showNotes ? ' pres-hud__btn--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowNotes((p) => !p); }}
            title={t('presentation.toggleSpeakerNotes')}
          >{t('presentation.notesButton')}</button>
        )}

        <button
          className={`pres-hud__btn${laserActive ? ' pres-hud__btn--active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setLaserActive((p) => !p); }}
          title={t('presentation.toggleLaser')}
        >{t('presentation.laserButton')}</button>

        <button
          className="pres-hud__btn pres-hud__btn--exit"
          onClick={(e) => { e.stopPropagation(); onExit(); }}
          title={t('presentation.exitPresentation')}
        >{t('presentation.exitButtonEsc')}</button>
      </div>
    </div>
  );
}
