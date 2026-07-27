import { useCallback, useEffect, useRef, useState } from 'react';
import { emitTo } from '@tauri-apps/api/event';
import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import type { NotesFontSize } from '../../store/settings';
import { SlideRenderer } from '../preview/SlideRenderer';
import { SLIDE_W, formatTime, ScaledSlideBox, LaserDot } from './presentationShared';
import { useT } from '../../i18n';
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
  onToggleAspectRatio?: () => void;
}

const HUD_H           = 56;  // px
const RIGHT_W_DEFAULT = 280; // px
const RIGHT_W_MIN     = 180; // px
const RIGHT_W_MAX     = 600; // px
const STORAGE_KEY     = 'kova:presenter-right-w';

export function PresenterOverlay({
  slides, currentIndex, theme, docTitle, docDate, aspectRatio,
  showNextSlide, showTimer, notesFontSize, laserColor = '#ff2020', onNavigate, onExit, onToggleAspectRatio,
}: Props) {
  const t = useT();
  const slide     = slides[currentIndex];
  const nextSlide = slides[currentIndex + 1] ?? null;
  const total     = slides.length;

  const handleNavigateTo = useCallback((slideIndex: number) => {
    const visibleIdx = slides.findIndex((s) => s.index === slideIndex);
    if (visibleIdx >= 0) onNavigate(visibleIdx);
  }, [slides, onNavigate]);

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
  const [blankMode, setBlankMode]       = useState<'black' | 'white' | null>(null);
  const [jumpInput, setJumpInput]       = useState<string | null>(null);
  const jumpInputRef = useRef(jumpInput);
  jumpInputRef.current = jumpInput;
  const [laserPos, setLaserPos]         = useState<{ x: number; y: number } | null>(null);
  const startTime      = useRef(Date.now());
  const lastWheelTime  = useRef(0);
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

  // Sync blank state to audience window.
  useEffect(() => {
    emitTo('audience', 'present:blank', { mode: blankMode }).catch(() => {});
  }, [blankMode]);

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
      if (e.target instanceof HTMLInputElement) return;
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
        case 'b': case 'B':
          e.preventDefault(); e.stopPropagation();
          setBlankMode((m) => m === 'black' ? null : 'black'); break;
        case 'w': case 'W':
          e.preventDefault(); e.stopPropagation();
          setBlankMode((m) => m === 'white' ? null : 'white'); break;
        case 'l': case 'L':
          e.preventDefault(); e.stopPropagation();
          setLaserActive((p) => !p); break;
        case 'Escape':
          e.preventDefault(); e.stopPropagation(); onExit(); break;
        case 'Enter':
          // Real keystrokes on the focused jump input never reach here (the
          // HTMLInputElement check above returns early); this only fires for
          // synthetic keydowns forwarded from the audience window, whose
          // target is `window` rather than the input element.
          if (jumpInputRef.current !== null) {
            e.preventDefault(); e.stopPropagation();
            const n = parseInt(jumpInputRef.current, 10);
            if (!isNaN(n)) onNavigate(Math.min(Math.max(n - 1, 0), total - 1));
            setJumpInput(null);
          }
          break;
        default:
          if (/^\d$/.test(e.key)) {
            e.preventDefault(); e.stopPropagation();
            setJumpInput(e.key);
          }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [goNext, goPrev, onNavigate, total, onExit]);

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelTime.current < 300) return;
      lastWheelTime.current = now;
      if (e.deltaY > 0) goNext(); else goPrev();
    };
    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, [goNext, goPrev]);

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
            <ScaledSlideBox scale={currentScale} slideH={slideH}>
              <SlideRenderer
                slide={slide}
                theme={theme}
                slideNumber={currentIndex + 1}
                totalSlides={total}
                docTitle={docTitle}
                docDate={docDate}
                hideOverflowBadge
                onNavigateTo={handleNavigateTo}
              />
            </ScaledSlideBox>
            {laserActive && laserPos && (
              <LaserDot x={laserPos.x} y={laserPos.y} color={laserColor} />
            )}
            {blankMode && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 5,
                background: blankMode === 'black' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.75)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  color: blankMode === 'black' ? '#aaa' : '#444',
                  fontSize: 13, fontWeight: 500,
                }}>{t('presentation.audienceBlank')}</span>
              </div>
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
                {nextSlide ? t('presentation.next') : t('presentation.endOfPresentation')}
              </div>
              {nextSlide && (
                <div className="pres-presenter__next-frame" ref={nextFrameRef}>
                  <ScaledSlideBox scale={nextScale} slideH={slideH}>
                    <SlideRenderer
                      slide={nextSlide}
                      theme={theme}
                      slideNumber={currentIndex + 2}
                      totalSlides={total}
                      docTitle={docTitle}
                      docDate={docDate}
                      hideOverflowBadge
                    />
                  </ScaledSlideBox>
                </div>
              )}
            </div>
          )}

          {/* Speaker notes */}
          <div className="pres-presenter__notes">
            <div className="pres-presenter__notes-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {t('presentation.speakerNotes')}
              <button
                className={`pres-presenter__btn${showNotes ? '' : ' pres-presenter__btn--active'}`}
                onClick={() => setShowNotes((p) => !p)}
                title={t('presentation.toggleNotesShort')}
                style={{ fontSize: 10, padding: '2px 6px' }}
              >{showNotes ? t('common.hide') : t('common.show')}</button>
            </div>
            {showNotes && (slide.speakerNotes ? (
              <p className={`pres-presenter__notes-text pres-presenter__notes-text--${notesFontSize}`}>
                {slide.speakerNotes}
              </p>
            ) : (
              <span className="pres-presenter__notes-empty">{t('presentation.noNotesForSlide')}</span>
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
            title={t('presentation.previousSlide')}
          >‹</button>
          {jumpInput !== null ? (
            <input
              className="pres-presenter__jump-input"
              type="text"
              inputMode="numeric"
              autoFocus
              onFocus={(e) => e.target.select()}
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = parseInt(jumpInput, 10);
                  if (!isNaN(n)) onNavigate(Math.min(Math.max(n - 1, 0), total - 1));
                  setJumpInput(null);
                } else if (e.key === 'Escape') {
                  setJumpInput(null);
                }
              }}
              onBlur={() => setJumpInput(null)}
            />
          ) : (
            <span
              className="pres-presenter__counter"
              onClick={() => setJumpInput(String(currentIndex + 1))}
              title={t('presentation.jumpToSlide')}
            >{currentIndex + 1} / {total}</span>
          )}
          <button
            className="pres-presenter__btn"
            onClick={goNext}
            disabled={currentIndex === total - 1}
            title={t('presentation.nextSlide')}
          >›</button>
        </div>

        {showTimer && (
          <>
            <div className="pres-presenter__hud-divider" />
            <span className="pres-presenter__timer" title={t('presentation.elapsedTime')}>
              {formatTime(elapsed)}
            </span>
          </>
        )}

        <div className="pres-presenter__hud-divider" />

        <button
          className={`pres-presenter__btn${laserActive ? ' pres-presenter__btn--active' : ''}`}
          onClick={() => setLaserActive((p) => !p)}
          title={t('presentation.toggleLaser')}
        >{t('presentation.laserButton')}</button>

        {onToggleAspectRatio && (
          <>
            <div className="pres-presenter__hud-divider" />
            <button
              className="pres-presenter__btn"
              onClick={onToggleAspectRatio}
              title={aspectRatio.label}
            >{aspectRatio.label}</button>
          </>
        )}

        <div className="pres-presenter__hud-divider" />

        <button
          className="pres-presenter__btn pres-presenter__btn--exit"
          onClick={onExit}
          title={t('presentation.exitPresentation')}
        >{t('presentation.exitButtonWord')}</button>
      </div>
    </div>
  );
}
