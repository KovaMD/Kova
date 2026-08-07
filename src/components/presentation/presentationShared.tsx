import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// Virtual slide width every overlay scales from (matches ThumbnailPanel).
export const SLIDE_W = 960;

// Elapsed time as mm:ss, or h:mm:ss once past an hour.
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// The 960px virtual slide scaled to fill its measured frame.
export function ScaledSlideBox({ scale, slideH, children }: { scale: number; slideH: number; children: ReactNode }) {
  return (
    <div style={{ width: SLIDE_W, height: slideH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
      {children}
    </div>
  );
}

// Glowing laser-pointer dot positioned by fractional x/y within its frame.
export function LaserDot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div
      className="pres-laser-dot"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        background: color,
        boxShadow: `0 0 6px 2px ${color}b3, 0 0 16px 5px ${color}4d`,
      }}
    />
  );
}

export interface UsePresentationNavOpts {
  total: number;
  currentIndex: number;
  /**
   * How many of the *current* slide's build-reveal steps have been clicked
   * through so far (an index into getSlideStepValues(slides[currentIndex]) —
   * see engine/layout/steps.ts). 0 means none yet; always 0 for a slide with
   * no `<!-- step -->` markers at all.
   */
  currentStep: number;
  /** Distinct step count for the slide at `slideIndex` (getSlideStepCount). */
  getStepCount: (slideIndex: number) => number;
  /**
   * `step` is always explicit, never defaulted — every caller (including the
   * two dual-window IPC hops) must decide it, so there's no ambiguity about
   * which of "stay on this slide's next fragment" vs "jump to a slide's
   * start" a given navigation means.
   */
  onNavigate: (index: number, step: number) => void;
  onExit: () => void;
  onToggleNotes: () => void;
  onToggleBlankBlack: () => void;
  onToggleBlankWhite: () => void;
  onToggleLaser: () => void;
  /**
   * HUD-auto-hide reset, called on every key/wheel navigation event. Only
   * PresentationOverlay has an idle/HUD-hide concept — PresenterOverlay's
   * HUD is always visible, so it omits this and gets the no-op default.
   * Kept as an explicit parameter (rather than silently unified away) so
   * this one real behavioural difference between the two callers stays
   * visible instead of becoming an implicit drift risk.
   */
  resetIdle?: () => void;
}

/**
 * Keyboard (arrows/Home/End/n/b/w/l/Escape/digit-jump/Enter) and scroll-wheel
 * navigation, shared by PresentationOverlay and PresenterOverlay — both
 * listened on `window` with near-identical handlers. `onToggleNotes` is a
 * caller-supplied callback rather than a hook-owned setter because the two
 * callers differ here too: PresentationOverlay only toggles when the slide
 * actually has speaker notes (there's nothing for the audience-facing
 * overlay to show otherwise), PresenterOverlay always toggles (its own view
 * shows a "no notes for this slide" placeholder either way).
 */
export function usePresentationNav({
  total, currentIndex, currentStep, getStepCount, onNavigate, onExit,
  onToggleNotes, onToggleBlankBlack, onToggleBlankWhite, onToggleLaser,
  resetIdle,
}: UsePresentationNavOpts) {
  const [jumpInput, setJumpInput] = useState<string | null>(null);
  const jumpInputRef = useRef(jumpInput);
  jumpInputRef.current = jumpInput;
  const lastWheelTime = useRef(0);

  // A build click advances through the current slide's remaining steps
  // before it advances the slide — same idea as reveal.js fragments/
  // PowerPoint builds. Stepping backward across a slide boundary lands on
  // the previous slide's *last* step (fully revealed), not its start — the
  // least surprising direction to arrive from when going backward.
  const goNext = useCallback(() => {
    if (currentStep < getStepCount(currentIndex)) { onNavigate(currentIndex, currentStep + 1); return; }
    if (currentIndex < total - 1) onNavigate(currentIndex + 1, 0);
  }, [currentIndex, currentStep, total, onNavigate, getStepCount]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) { onNavigate(currentIndex, currentStep - 1); return; }
    if (currentIndex > 0) onNavigate(currentIndex - 1, getStepCount(currentIndex - 1));
  }, [currentIndex, currentStep, onNavigate, getStepCount]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      resetIdle?.(); // keep the HUD up while navigating by keyboard, not just mouse
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown':
          e.preventDefault(); e.stopPropagation(); goNext(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          e.preventDefault(); e.stopPropagation(); goPrev(); break;
        case 'Home':
          e.preventDefault(); e.stopPropagation(); onNavigate(0, 0); break;
        case 'End':
          e.preventDefault(); e.stopPropagation(); onNavigate(total - 1, 0); break;
        case 'n': case 'N':
          e.preventDefault(); e.stopPropagation(); onToggleNotes(); break;
        case 'b': case 'B':
          e.preventDefault(); e.stopPropagation(); onToggleBlankBlack(); break;
        case 'w': case 'W':
          e.preventDefault(); e.stopPropagation(); onToggleBlankWhite(); break;
        case 'l': case 'L':
          e.preventDefault(); e.stopPropagation(); onToggleLaser(); break;
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
            if (!isNaN(n)) onNavigate(Math.min(Math.max(n - 1, 0), total - 1), 0);
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
  }, [goNext, goPrev, onNavigate, total, onExit, onToggleNotes, onToggleBlankBlack, onToggleBlankWhite, onToggleLaser, resetIdle]);

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelTime.current < 300) return;
      lastWheelTime.current = now;
      resetIdle?.();
      if (e.deltaY > 0) goNext(); else goPrev();
    };
    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, [goNext, goPrev, resetIdle]);

  return { goNext, goPrev, jumpInput, setJumpInput };
}
