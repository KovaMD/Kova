import { useEffect, useRef, useState } from 'react';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SlideRenderer } from './components/preview/SlideRenderer';
import type { Slide, AspectRatio } from './engine/types';
import type { Theme } from './engine/theme';
import './styles/global.css';

export interface PresentInitPayload {
  slides: Slide[];
  theme: Theme;
  index: number;
  aspectRatio: AspectRatio;
  docTitle?: string;
  slideTransition?: boolean;
}

const SLIDE_W = 960;

export function AudienceApp() {
  const [initData, setInitData]         = useState<PresentInitPayload | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scale, setScale]               = useState(1);
  const slidesRef = useRef<Slide[]>([]);
  const frameRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlistenInit: (() => void) | undefined;
    let unlistenNav:  (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    async function setup() {
      unlistenInit = await listen<PresentInitPayload>('present:init', (e) => {
        slidesRef.current = e.payload.slides;
        setInitData(e.payload);
        setCurrentIndex(e.payload.index);
      });

      unlistenNav = await listen<{ index: number }>('present:navigate', (e) => {
        setCurrentIndex(e.payload.index);
      });

      unlistenExit = await listen('present:exit', () => {
        getCurrentWindow().close();
      });

      await emit('present:ready', null);
    }

    setup();
    return () => { unlistenInit?.(); unlistenNav?.(); unlistenExit?.(); };
  }, []);

  // Forward keyboard events to the main presenter window so navigation works
  // even when the compositor gave OS focus to the audience window instead.
  useEffect(() => {
    if (!initData) return;
    const handler = (e: KeyboardEvent) => {
      emitTo('main', 'audience:key', { key: e.key }).catch(() => {});
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [initData]);

  // Attach ResizeObserver once the frame div is in the DOM (after initData arrives).
  useEffect(() => {
    if (!frameRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / SLIDE_W);
    });
    obs.observe(frameRef.current);
    return () => obs.disconnect();
  }, [initData]);

  if (!initData) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ color: '#2a2a2a', fontSize: 13 }}>Connecting…</div>
      </div>
    );
  }

  const slide  = slidesRef.current[currentIndex];
  const { theme, aspectRatio, docTitle, slideTransition } = initData;
  const total  = slidesRef.current.length;
  const slideH = Math.round(SLIDE_W * aspectRatio.h / aspectRatio.w);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Outer box constrains to the slide's aspect ratio */}
      <div style={{
        position: 'relative',
        width: `min(100vw, calc(100vh * ${aspectRatio.w} / ${aspectRatio.h}))`,
        aspectRatio: `${aspectRatio.w} / ${aspectRatio.h}`,
        overflow: 'hidden',
      }}>
        {/* frameRef measures actual rendered width; scale = actualWidth / SLIDE_W */}
        <div ref={frameRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
          {slide && (
            <div
              key={currentIndex}
              style={{
                width: SLIDE_W,
                height: slideH,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                animation: slideTransition !== false ? 'pres-fadein 0.3s ease' : undefined,
              }}
            >
              <SlideRenderer
                slide={slide}
                theme={theme}
                slideNumber={currentIndex + 1}
                totalSlides={total}
                docTitle={docTitle}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
