import { useRef, useEffect, useState } from 'react';
import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { DEFAULT_THEME } from '../../engine/theme';
import { SlideRenderer } from '../preview/SlideRenderer';

interface Props {
  slides: Slide[];
  currentIndex: number;
  onSelect: (index: number) => void;
  theme?: Theme;
  docTitle?: string;
  aspectRatio?: AspectRatio;
}

const SLIDE_W = 960;
const THUMB_W = 140;

export function ThumbnailPanel({ slides, currentIndex, onSelect, theme = DEFAULT_THEME, docTitle, aspectRatio = { w: 16, h: 9 } }: Props) {
  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  // Observe the outer panel div (no overflow) so a scrollbar appearing in the
  // inner scroll container never triggers a width change and feedback loop.
  const panelRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(THUMB_W / SLIDE_W);

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

  const thumbH = Math.round(slideH * scale);

  return (
    <div ref={panelRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-app)' }}>
      <div className="panel-header">Slides</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {slides.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center', marginTop: 24, padding: '0 8px' }}>
            Open a Markdown file to see slides
          </div>
        ) : (
          slides.map((slide, i) => (
            <Thumbnail
              key={i}
              slide={slide}
              index={i}
              totalSlides={slides.length}
              isActive={i === currentIndex}
              onClick={() => onSelect(i)}
              theme={theme}
              docTitle={docTitle}
              scale={scale}
              slideH={slideH}
              thumbH={thumbH}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ThumbnailProps {
  slide: Slide;
  index: number;
  totalSlides: number;
  isActive: boolean;
  onClick: () => void;
  theme: Theme;
  docTitle?: string;
  slideH: number;
  scale: number;
  thumbH: number;
}

function Thumbnail({ slide, index, totalSlides, isActive, onClick, theme, docTitle, slideH, scale, thumbH }: ThumbnailProps) {
  return (
    <div
      onClick={onClick}
      style={{
        marginBottom: 8,
        cursor: 'pointer',
        borderRadius: 4,
        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
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
