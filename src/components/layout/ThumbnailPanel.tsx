import { useRef, useEffect, useState } from 'react';
import type { Slide } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { DEFAULT_THEME } from '../../engine/theme';
import { SlideRenderer } from '../preview/SlideRenderer';

interface Props {
  slides: Slide[];
  currentIndex: number;
  onSelect: (index: number) => void;
  theme?: Theme;
  docTitle?: string;
}

const SLIDE_W = 960;
const SLIDE_H = 540;
const THUMB_W = 140; // target thumbnail width in px

export function ThumbnailPanel({ slides, currentIndex, onSelect, theme = DEFAULT_THEME, docTitle }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a1a' }}>
      <div className="panel-header">Slides</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {slides.length === 0 ? (
          <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 24, padding: '0 8px' }}>
            Open a Markdown file to see slides
          </div>
        ) : (
          slides.map((slide, i) => (
            <Thumbnail
              key={i}
              slide={slide}
              index={i}
              isActive={i === currentIndex}
              onClick={() => onSelect(i)}
              theme={theme}
              docTitle={docTitle}
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
  isActive: boolean;
  onClick: () => void;
  theme: Theme;
  docTitle?: string;
}

function Thumbnail({ slide, index, isActive, onClick, theme, docTitle }: ThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(THUMB_W / SLIDE_W);

  // Recalculate scale when container width changes
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setScale(w / SLIDE_W);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const thumbH = Math.round(SLIDE_H * scale);

  return (
    <div
      onClick={onClick}
      style={{
        marginBottom: 8,
        cursor: 'pointer',
        borderRadius: 4,
        border: `2px solid ${isActive ? '#c07a30' : '#333'}`,
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* Scaled slide render */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: thumbH, overflow: 'hidden', position: 'relative' }}
      >
        <div
          style={{
            width: SLIDE_W,
            height: SLIDE_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <SlideRenderer slide={slide} theme={theme} docTitle={docTitle} />
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
