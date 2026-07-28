import { memo, useCallback, useRef, useEffect, useState } from 'react';
import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { DEFAULT_THEME } from '../../engine/theme';
import { SlideRenderer } from '../preview/SlideRenderer';
import { useT } from '../../i18n';

interface Props {
  slides: Slide[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onDuplicate?: (index: number) => void;
  onNewSlide?: (index: number) => void;
  onToggleHidden?: (index: number) => void;
  onSetBackground?: (index: number) => void;
  onClearBackground?: (index: number) => void;
  onDelete?: (index: number) => void;
  theme?: Theme;
  docTitle?: string;
  docAuthor?: string;
  docDate?: string;
  aspectRatio?: AspectRatio;
}

const SLIDE_W = 960;
const THUMB_W = 140;

export function ThumbnailPanel({ slides, currentIndex, onSelect, onReorder, onDuplicate, onNewSlide, onToggleHidden, onSetBackground, onClearBackground, onDelete, theme = DEFAULT_THEME, docTitle, docAuthor, docDate, aspectRatio = { w: 16, h: 9 } }: Props) {
  const t = useT();
  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  // Observe the outer panel div (no overflow) so a scrollbar appearing in the
  // inner scroll container never triggers a width change and feedback loop.
  const panelRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(THUMB_W / SLIDE_W);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  // Mutable drag state for use inside stable event listeners (avoids stale closures).
  const dragRef     = useRef<{ fromIndex: number; overIndex: number | null } | null>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);   // the scrollable list container
  const mousePosRef = useRef({ x: 0, y: 0 });        // last known cursor position
  const scrollDelta = useRef(0);                       // px/frame to scroll; 0 = idle
  const rafRef      = useRef<number | null>(null);    // auto-scroll animation frame id

  useEffect(() => {
    if (!panelRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      // Subtract the 12px of horizontal padding (6px each side) from the scroll container.
      const w = Math.max(1, entry.contentRect.width - 12);
      setScale(w / SLIDE_W);
    });
    obs.observe(panelRef.current);
    return () => obs.disconnect();
  }, []);

  // Mouse-based drag — avoids Tauri's native GTK drag-drop handler on Linux
  // which intercepts HTML5 DnD events before they reach the WebView.
  useEffect(() => {
    const ZONE  = 56;  // px from edge where auto-scroll kicks in
    const SPEED = 10;  // max px scrolled per animation frame

    function resolveDropTarget(clientX: number, clientY: number) {
      if (!dragRef.current) return;
      const el = document.elementFromPoint(clientX, clientY);
      const thumbEl = el?.closest('[data-slide-index]');
      if (thumbEl) {
        const idx = parseInt(thumbEl.getAttribute('data-slide-index') ?? '-1', 10);
        if (idx >= 0 && idx !== dragRef.current.overIndex) {
          dragRef.current.overIndex = idx;
          setDragOverIndex(idx);
        }
      } else {
        // Cursor is not over any thumbnail — clear the drop indicator so the
        // user doesn't see a stale line when hovering over empty space.
        dragRef.current.overIndex = null;
        setDragOverIndex(null);
      }
    }

    function stopScroll() {
      scrollDelta.current = 0;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    function cancelDrag() {
      if (!dragRef.current) return;
      stopScroll();
      dragRef.current = null;
      setDragFromIndex(null);
      setDragOverIndex(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    function tick() {
      rafRef.current = null;
      if (!dragRef.current || scrollDelta.current === 0) return;
      const container = scrollRef.current;
      if (container) {
        container.scrollTop += scrollDelta.current;
        // Update the drop indicator as slides scroll under the stationary cursor.
        resolveDropTarget(mousePosRef.current.x, mousePosRef.current.y);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    function updateScrollZone(clientY: number) {
      const container = scrollRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let delta = 0;
      if (clientY < rect.top + ZONE) {
        // Clamp ratio to [0,1] so speed never exceeds SPEED when cursor leaves the panel.
        const ratio = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / ZONE));
        delta = -Math.ceil(SPEED * ratio);
      } else if (clientY > rect.bottom - ZONE) {
        const ratio = Math.min(1, Math.max(0, (clientY - (rect.bottom - ZONE)) / ZONE));
        delta = Math.ceil(SPEED * ratio);
      }
      scrollDelta.current = delta;
      if (delta !== 0 && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      resolveDropTarget(e.clientX, e.clientY);
      updateScrollZone(e.clientY);
    };

    const handleMouseUp = () => {
      if (!dragRef.current) return;
      const { fromIndex, overIndex } = dragRef.current;
      cancelDrag();
      if (overIndex !== null && overIndex !== fromIndex) {
        onReorder?.(fromIndex, overIndex);
      }
    };

    // If the window loses focus mid-drag (e.g. alt-tab), mouseup won't fire.
    // Clean up so the app doesn't get stuck with grabbing cursor / userSelect locked.
    const handleBlur = () => cancelDrag();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleBlur);
      stopScroll();
    };
  }, [onReorder]);

  // Stable identity (depends only on onReorder, itself stable from App.tsx)
  // so it can be passed straight through to the memoized Thumbnail below
  // without defeating the memo on every ThumbnailPanel render.
  const handleThumbMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    if (!onReorder || e.button !== 0) return;
    e.preventDefault(); // prevent text selection during drag
    dragRef.current = { fromIndex: index, overIndex: index };
    setDragFromIndex(index);
    setDragOverIndex(index);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [onReorder]);

  const handleThumbContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ index, x: e.clientX, y: e.clientY });
  }, []);

  // Dismiss the context menu on any outside interaction.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    const sc = scrollRef.current;
    sc?.addEventListener('scroll', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      sc?.removeEventListener('scroll', close);
    };
  }, [menu]);

  const thumbH = Math.round(slideH * scale);

  return (
    <div ref={panelRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-app)' }}>
      <div className="panel-header">{t('layout.slidesPanelHeader')}</div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {slides.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center', marginTop: 24, padding: '0 8px' }}>
            {t('layout.openFileHint')}
          </div>
        ) : (
          slides.map((slide, i) => {
            const isTarget = dragOverIndex === i && dragFromIndex !== null && dragFromIndex !== i;
            const showAbove = isTarget && (dragFromIndex as number) > i;
            const showBelow = isTarget && (dragFromIndex as number) < i;
            return (
              <div key={i}>
                {showAbove && <DropLine />}
                <Thumbnail
                  slide={slide}
                  index={i}
                  totalSlides={slides.length}
                  isActive={i === currentIndex}
                  isDragSource={dragFromIndex === i}
                  isDragging={dragFromIndex !== null}
                  canDrag={Boolean(onReorder)}
                  isHidden={slide.hidden}
                  onSelect={onSelect}
                  onToggleHidden={onToggleHidden}
                  onDragStart={handleThumbMouseDown}
                  onContextMenu={handleThumbContextMenu}
                  theme={theme}
                  docTitle={docTitle}
                  docAuthor={docAuthor}
                  docDate={docDate}
                  scale={scale}
                  slideH={slideH}
                  thumbH={thumbH}
                />
                {showBelow && <DropLine />}
              </div>
            );
          })
        )}
      </div>

      {menu && (
        // ponytail: fixed at cursor, may clip near the viewport edge; add flip
        // logic only if users actually hit it.
        <div
          role="menu"
          aria-label={t('layout.slideOptionsAriaLabel')}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000,
            minWidth: 140, padding: 4, borderRadius: 6,
            background: 'var(--bg-panel, #2a2a2a)', border: '1px solid var(--border)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontSize: 12,
          }}
        >
          <MenuItem
            label={t('layout.moveUp')}
            disabled={!onReorder || menu.index === 0}
            onClick={() => { onReorder?.(menu.index, menu.index - 1); setMenu(null); }}
          />
          <MenuItem
            label={t('layout.moveDown')}
            disabled={!onReorder || menu.index === slides.length - 1}
            onClick={() => { onReorder?.(menu.index, menu.index + 1); setMenu(null); }}
          />
          <MenuItem
            label={t('layout.newSlide')}
            disabled={!onNewSlide}
            onClick={() => { onNewSlide?.(menu.index); setMenu(null); }}
          />
          <MenuItem
            label={t('layout.duplicateSlide')}
            disabled={!onDuplicate}
            onClick={() => { onDuplicate?.(menu.index); setMenu(null); }}
          />
          <MenuItem
            label={slides[menu.index]?.hidden ? t('layout.showSlide') : t('layout.hideSlide')}
            disabled={!onToggleHidden}
            onClick={() => { onToggleHidden?.(menu.index); setMenu(null); }}
          />
          <div role="separator" style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <MenuItem
            label={t('layout.setSlideBackground')}
            disabled={!onSetBackground}
            onClick={() => { onSetBackground?.(menu.index); setMenu(null); }}
          />
          <MenuItem
            label={t('layout.clearSlideBackground')}
            disabled={!onClearBackground || !slides[menu.index]?.backgroundImage}
            onClick={() => { onClearBackground?.(menu.index); setMenu(null); }}
          />
          <div role="separator" style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <MenuItem
            label={t('layout.deleteSlide')}
            disabled={!onDelete || slides.length <= 1}
            onClick={() => { onDelete?.(menu.index); setMenu(null); }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '5px 8px', border: 'none', borderRadius: 4,
        background: 'transparent', color: 'var(--text)', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

function DropLine() {
  return (
    <div style={{
      height: 3,
      margin: '3px 0',
      borderRadius: 99,
      background: 'var(--accent)',
    }} />
  );
}

interface ThumbnailProps {
  slide: Slide;
  index: number;
  totalSlides: number;
  isActive: boolean;
  isDragSource: boolean;
  isDragging: boolean;
  canDrag: boolean;
  isHidden: boolean;
  onSelect: (index: number) => void;
  onToggleHidden?: (index: number) => void;
  onDragStart: (index: number, e: React.MouseEvent) => void;
  onContextMenu: (index: number, e: React.MouseEvent) => void;
  theme: Theme;
  docTitle?: string;
  docAuthor?: string;
  docDate?: string;
  slideH: number;
  scale: number;
  thumbH: number;
}

// Memoized so an edit to one slide's content — which, thanks to the
// reference-stable `slide` prop from App.tsx/parseDocument, only changes
// *that* slide's prop identity — doesn't force every other thumbnail (and
// its own Mermaid/KaTeX/highlight.js rendering) to redo work on every
// keystroke. `onSelect`/`onDragStart` are forwarded as stable function
// references (bound internally below) rather than passed as pre-bound
// closures, specifically so they don't defeat this memoization.
const Thumbnail = memo(function Thumbnail({ slide, index, totalSlides, isActive, isDragSource, isDragging, canDrag, isHidden, onSelect, onToggleHidden, onDragStart, onContextMenu, theme, docTitle, docAuthor, docDate, slideH, scale, thumbH }: ThumbnailProps) {
  const t = useT();
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && !isDragging) thumbRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isActive, isDragging]);

  return (
    <div
      ref={thumbRef}
      data-slide-index={index}
      onClick={() => onSelect(index)}
      onMouseDown={(e) => onDragStart(index, e)}
      onContextMenu={(e) => onContextMenu(index, e)}
      style={{
        marginBottom: 8,
        cursor: canDrag ? 'grab' : 'pointer',
        borderRadius: 4,
        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
        opacity: isDragSource ? 0.4 : isHidden ? 0.45 : 1,
        transition: 'opacity 0.1s',
      }}
    >
      {onToggleHidden && (
        <button
          title={isHidden ? t('layout.showSlideTitle') : t('layout.hideSlideTitle')}
          onClick={(e) => { e.stopPropagation(); onToggleHidden(index); }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 4, right: 5, zIndex: 1,
            width: 20, height: 20, padding: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            border: 'none', borderRadius: 3, color: '#fff',
            background: 'rgba(0,0,0,0.55)',
          }}
        >
          {isHidden ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      )}
      {/* Scaled slide render */}
      <div
        style={{ width: '100%', height: thumbH, overflow: 'hidden', position: 'relative' }}
      >
        <div
          style={{
            width: SLIDE_W,
            height: slideH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <SlideRenderer
            slide={slide}
            theme={theme}
            docTitle={docTitle}
            docAuthor={docAuthor}
            docDate={docDate}
            slideNumber={index + 1}
            totalSlides={totalSlides}
            isThumbnail
          />
        </div>
      </div>

      {/* Slide number badge */}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          right: 5,
          fontSize: 9,
          color: '#fff',
          background: 'rgba(0,0,0,0.5)',
          borderRadius: 2,
          padding: '1px 4px',
          pointerEvents: 'none',
        }}
      >
        {index + 1}
      </div>
    </div>
  );
});
