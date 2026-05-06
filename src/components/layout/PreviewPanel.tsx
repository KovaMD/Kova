import type { Slide, AspectRatio } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { DEFAULT_THEME } from '../../engine/theme';
import { SlideRenderer } from '../preview/SlideRenderer';
import '../../styles/preview.css';

interface Props {
  slides: Slide[];
  currentIndex: number;
  theme?: Theme;
  docTitle?: string;
  aspectRatio?: AspectRatio;
}

export function PreviewPanel({ slides, currentIndex, theme = DEFAULT_THEME, docTitle, aspectRatio = { w: 16, h: 9 } }: Props) {
  const slide = slides[currentIndex] ?? null;

  return (
    <div className="preview-panel" style={{ height: '100%' }}>
      <div className="panel-header">
        Preview
        {slides.length > 0 && (
          <span style={{ marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
            {currentIndex + 1} / {slides.length}
            {slide && (
              <span style={{ marginLeft: 8, color: '#666', fontStyle: 'italic' }}>
                {slide.layout}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="preview-viewport">
        {slide === null ? (
          <div className="preview-empty">
            <span>No file open</span>
            <span className="hint">Ctrl+O to open a Markdown file</span>
          </div>
        ) : (
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '960px',
              aspectRatio: `${aspectRatio.w} / ${aspectRatio.h}`,
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
              borderRadius: 4,
              overflow: 'hidden',
              containerType: 'inline-size',
            }}
          >
            <SlideRenderer
              slide={slide}
              theme={theme}
              slideNumber={currentIndex + 1}
              totalSlides={slides.length}
              docTitle={docTitle}
            />
          </div>
        )}
      </div>

      {slide?.speakerNotes && (
        <div className="speaker-notes-area">
          <div className="speaker-notes-label">Speaker Notes</div>
          <div className="speaker-notes-text">{slide.speakerNotes}</div>
        </div>
      )}
    </div>
  );
}
