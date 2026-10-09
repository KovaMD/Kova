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
  /** Block drag-reorder: `fromIndices` is the whole selected set, `anchorIndex`
   *  the specific thumbnail the user grabbed (decides before/after the drop target). */
  onReorderMultiple?: (fromIndices: number[], anchorIndex: number, toIndex: number) => void;
  onDuplicate?: (index: number) => void;
  onNewSlide?: (index: number) => void;
  onToggleHidden?: (index: number) => void;
  onSetBackground?: (index: number) => void;
  onClearBackground?: (index: number) => void;
  onDelete?: (index: number) => void;
  onDeleteMultiple?: (indices: number[]) => void;
  theme?: Theme;
  docTitle?: string;
  docAuthor?: string;
  docDate?: string;
  aspectRatio?: AspectRatio;
}

const SLIDE_W = 960;
const THUMB_W = 140;
// How far beyond the visible list a thumbnail starts rendering, so a slide is
// usually ready by the time it scrolls into view.
const LAZY_MARGIN = '600px 0px';

export function ThumbnailPanel({ slides, currentIndex, onSelect, onReorder, onReorderMultiple, onDuplicate, onNewSlide, onToggleHidden, onSetBackground, onClearBackground, onDelete, onDeleteMultiple, theme = DEFAULT_THEME, docTitle, docAuthor, docDate, aspectRatio = { w: 16, h: 9 } }: Props) {
  const t = useT();
  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  // Observe the outer panel div (no overflow) so a scrollbar appearing in the
  // inner scroll container never triggers a width change and feedback loop.
  const panelRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(THUMB_W / SLIDE_W);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragBlockIndices, setDragBlockIndices] = useState<number[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  // Multi-select (shift/ctrl-click, shift+arrow). Local to the panel — App.tsx
  // only learns about it when a delete or block-reorder action is taken.
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  // Range-select anchor: the endpoint a Shift-click/Shift-arrow range extends
  // from. Mirrored into a ref (not just state) so handleThumbMouseDown — kept
  // stable across renders to avoid defeating Thumbnail's memo — can read the
  // latest selection without depending on it.
  const anchorIndexRef = useRef<number | null>(null);
  const selectedIndicesRef = useRef<Set<number>>(selectedIndices);
  useEffect(() => { selectedIndicesRef.current = selectedIndices; }, [selectedIndices]);

  // A slide count change (delete/duplicate/new-slide/reorder) shifts every
  // index after the edit point — clear the multi-selection rather than let
  // it point at whatever slides now happen to occupy those old positions.
  const prevSlideCountRef = useRef(slides.length);
  useEffect(() => {
    if (prevSlideCountRef.current !== slides.length) {
      prevSlideCountRef.current = slides.length;
      setSelectedIndices(new Set());
      anchorIndexRef.current = null;
    }
  }, [slides.length]);

  // Mutable drag state for use inside stable event listeners (avoids stale closures).
  const dragRef     = useRef<{ fromIndex: number; blockIndices: number[]; overIndex: number | null } | null>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);   // the scrollable list container
  // Same element as scrollRef, but as state so thumbnails re-run their
  // IntersectionObserver setup once it exists (a ref change re-renders nothing).
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => { setScrollRoot(scrollRef.current); }, []);
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
      setDragBlockIndices([]);
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
      const { fromIndex, blockIndices, overIndex } = dragRef.current;
      cancelDrag();
      if (overIndex === null || blockIndices.includes(overIndex)) return;
      if (blockIndices.length > 1) {
        onReorderMultiple?.(blockIndices, fromIndex, overIndex);
        // The moved block's old indices now point at whatever slides shifted
        // into those positions — clear rather than show a stale selection.
        setSelectedIndices(new Set());
        anchorIndexRef.current = null;
      } else if (overIndex !== fromIndex) {
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
  }, [onReorder, onReorderMultiple]);

  // Stable identity (depends only on onReorder/onReorderMultiple, themselves
  // stable from App.tsx) so it can be passed straight through to the
  // memoized Thumbnail below without defeating the memo on every
  // ThumbnailPanel render. Reads the *current* selection via a ref rather
  // than depending on `selectedIndices` state, which would change this
  // callback's identity on every click.
  const handleThumbMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    if (!onReorder || e.button !== 0) return;
    e.preventDefault(); // prevent text selection during drag
    const sel = selectedIndicesRef.current;
    // Dragging a thumbnail that's part of an existing multi-selection moves
    // the whole block; dragging an unselected one (or a lone selection)
    // moves just that slide, matching standard file-manager drag behavior.
    const block = sel.has(index) && sel.size > 1 ? [...sel].sort((a, b) => a - b) : [index];
    dragRef.current = { fromIndex: index, blockIndices: block, overIndex: index };
    setDragFromIndex(index);
    setDragBlockIndices(block);
    setDragOverIndex(index);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [onReorder]);

  const handleThumbContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ index, x: e.clientX, y: e.clientY });
  }, []);

  // Shift-click extends a range from the last anchor; Ctrl/Cmd-click toggles
  // one slide in or out; a plain click selects just that one — the same
  // three-way convention as a file manager's icon grid.
  const handleThumbClick = useCallback((index: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchorIndexRef.current !== null) {
      const lo = Math.min(anchorIndexRef.current, index);
      const hi = Math.max(anchorIndexRef.current, index);
      const range = new Set<number>();
      for (let i = lo; i <= hi; i++) range.add(i);
      setSelectedIndices(range);
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index); else next.add(index);
        return next;
      });
      anchorIndexRef.current = index;
    } else {
      setSelectedIndices(new Set([index]));
      anchorIndexRef.current = index;
    }
    // onSelect (App.tsx) scrolls the editor to the slide, which itself ends
    // by focusing the editor — refocus the panel *after*, so keyboard nav
    // keeps working for a run of consecutive arrow presses instead of losing
    // focus back to the editor after the very first click.
    onSelect(index);
    scrollRef.current?.focus();
  }, [onSelect]);

  // Panel-scoped keyboard nav — only fires while the thumbnail list itself
  // has focus (clicking a thumbnail focuses it), so it never competes with
  // the editor's own shortcuts. Up/Down/PageUp/PageDown/Home/End move the
  // active slide; holding Shift extends the range selection like the click
  // handler above. Delete/Backspace removes the selection (or just the
  // active slide with no multi-select); Mod-D duplicates the active slide.
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (slides.length === 0) return;

    const moveTo = (next: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        const anchor = anchorIndexRef.current ?? currentIndex;
        anchorIndexRef.current = anchor;
        const lo = Math.min(anchor, next), hi = Math.max(anchor, next);
        const range = new Set<number>();
        for (let i = lo; i <= hi; i++) range.add(i);
        setSelectedIndices(range);
      } else {
        anchorIndexRef.current = next;
        setSelectedIndices(new Set([next]));
      }
      // Same focus-stealing fixup as handleThumbClick — onSelect ends by
      // focusing the editor; reclaim it so a run of arrow presses keeps working.
      onSelect(next);
      scrollRef.current?.focus();
    };

    switch (e.key) {
      case 'ArrowUp': case 'PageUp':
        moveTo(Math.max(0, currentIndex - 1)); break;
      case 'ArrowDown': case 'PageDown':
        moveTo(Math.min(slides.length - 1, currentIndex + 1)); break;
      case 'Home':
        moveTo(0); break;
      case 'End':
        moveTo(slides.length - 1); break;
      case 'Delete': case 'Backspace': {
        const sel = selectedIndicesRef.current;
        if (sel.size > 1 && onDeleteMultiple) {
          e.preventDefault(); e.stopPropagation();
          onDeleteMultiple([...sel]);
        } else if (onDelete && slides.length > 1) {
          e.preventDefault(); e.stopPropagation();
          onDelete(currentIndex);
        }
        break;
      }
      default:
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && onDuplicate) {
          e.preventDefault(); e.stopPropagation();
          onDuplicate(currentIndex);
        }
    }
  }, [slides.length, currentIndex, onSelect, onDelete, onDeleteMultiple, onDuplicate]);

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
      <div
        ref={scrollRef}
        className="thumbnail-scroller"
        tabIndex={0}
        onKeyDown={handlePanelKeyDown}
        style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}
      >
        {slides.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center', marginTop: 24, padding: '0 8px' }}>
            {t('layout.openFileHint')}
          </div>
        ) : (
          slides.map((slide, i) => {
            const inDragBlock = dragBlockIndices.includes(i);
            const isTarget = dragOverIndex === i && dragFromIndex !== null && !inDragBlock;
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
                  isSelected={selectedIndices.has(i)}
                  isDragSource={inDragBlock}
                  isDragging={dragFromIndex !== null}
                  canDrag={Boolean(onReorder)}
                  isHidden={slide.hidden}
                  onSelect={handleThumbClick}
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
                  scrollRoot={scrollRoot}
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
  isSelected: boolean;
  isDragSource: boolean;
  isDragging: boolean;
  canDrag: boolean;
  isHidden: boolean;
  onSelect: (index: number, e: React.MouseEvent) => void;
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
  scrollRoot: HTMLElement | null;
}

// Memoized so an edit to one slide's content — which, thanks to the
// reference-stable `slide` prop from App.tsx/parseDocument, only changes
// *that* slide's prop identity — doesn't force every other thumbnail (and
// its own Mermaid/KaTeX/highlight.js rendering) to redo work on every
// keystroke. `onSelect`/`onDragStart` are forwarded as stable function
// references (bound internally below) rather than passed as pre-bound
// closures, specifically so they don't defeat this memoization.
const Thumbnail = memo(function Thumbnail({ slide, index, totalSlides, isActive, isSelected, isDragSource, isDragging, canDrag, isHidden, onSelect, onToggleHidden, onDragStart, onContextMenu, theme, docTitle, docAuthor, docDate, slideH, scale, thumbH, scrollRoot }: ThumbnailProps) {
  const t = useT();
  const thumbRef = useRef<HTMLDivElement>(null);

  // Render the slide only once it nears the visible part of the list. Every
  // thumbnail is a full-size SlideRenderer (Mermaid, KaTeX, highlight.js,
  // OverflowPane's fit measurement), so mounting a whole large deck at once on
  // file open pegs WebKitGTK and freezes the app. Sticky: once rendered it
  // stays rendered, so scrolling back and forth never redoes that work.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (inView || !scrollRoot || !thumbRef.current) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setInView(true); io.disconnect(); }
    }, { root: scrollRoot, rootMargin: LAZY_MARGIN });
    io.observe(thumbRef.current);
    return () => io.disconnect();
  }, [inView, scrollRoot]);

  useEffect(() => {
    if (isActive && !isDragging) thumbRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isActive, isDragging]);

  return (
    <div
      ref={thumbRef}
      data-slide-index={index}
      onClick={(e) => onSelect(index, e)}
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
          {inView ? (
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
          ) : (
            <div style={{ width: '100%', height: '100%', background: theme.colors.background }} />
          )}
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

      {/* Multi-select wash — painted over the slide render (which has its own
          opaque background), so it can't just live on the outer container. */}
      {isSelected && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--accent-bg)', pointerEvents: 'none' }} />
      )}
    </div>
  );
});
