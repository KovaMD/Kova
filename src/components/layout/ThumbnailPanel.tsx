import { useRef, useEffect, useState } from 'react';
import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { DEFAULT_THEME } from '../../engine/theme';
import { SlideRenderer } from '../preview/SlideRenderer';

interface Props {
  slides: Slide[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  theme?: Theme;
  docTitle?: string;
  aspectRatio?: AspectRatio;
}

const SLIDE_W = 960;
const THUMB_W = 140;

export function ThumbnailPanel({ slides, currentIndex, onSelect, onReorder, theme = DEFAULT_THEME, docTitle, aspectRatio = { w: 16, h: 9 } }: Props) {
  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  // Observe the outer panel div (no overflow) so a scrollbar appearing in the
  // inner scroll container never triggers a width change and feedback loop.
  const panelRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(THUMB_W / SLIDE_W);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  function handleThumbMouseDown(index: number, e: React.MouseEvent) {
    if (!onReorder || e.button !== 0) return;
    e.preventDefault(); // prevent text selection during drag
    dragRef.current = { fromIndex: index, overIndex: index };
    setDragFromIndex(index);
    setDragOverIndex(index);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  const thumbH = Math.round(slideH * scale);

  return (
    <div ref={panelRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-app)' }}>
      <div className="panel-header">Slides</div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {slides.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center', marginTop: 24, padding: '0 8px' }}>
            Open a Markdown file to see slides
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
                  canDrag={Boolean(onReorder)}
                  onClick={() => onSelect(i)}
                  onMouseDown={(e) => handleThumbMouseDown(i, e)}
                  theme={theme}
                  docTitle={docTitle}
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
    </div>
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
  canDrag: boolean;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  theme: Theme;
  docTitle?: string;
  slideH: number;
  scale: number;
  thumbH: number;
}

function Thumbnail({ slide, index, totalSlides, isActive, isDragSource, canDrag, onClick, onMouseDown, theme, docTitle, slideH, scale, thumbH }: ThumbnailProps) {
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive) thumbRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isActive]);

  return (
    <div
      ref={thumbRef}
      data-slide-index={index}
      onClick={onClick}
      onMouseDown={onMouseDown}
      style={{
        marginBottom: 8,
        cursor: canDrag ? 'grab' : 'pointer',
        borderRadius: 4,
        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
        opacity: isDragSource ? 0.4 : 1,
        transition: 'opacity 0.1s',
      }}
    >
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
}
