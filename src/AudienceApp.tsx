import { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
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
}

export function AudienceApp() {
  const [initData, setInitData]     = useState<PresentInitPayload | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const slidesRef = useRef<Slide[]>([]);

  useEffect(() => {
    let unlistenInit: (() => void) | undefined;
    let unlistenNav:  (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    async function setup() {
      // Register all listeners before signalling ready so we don't miss init
      unlistenInit = await listen<PresentInitPayload>('present:init', async (e) => {
        slidesRef.current = e.payload.slides;
        setInitData(e.payload);
        setCurrentIndex(e.payload.index);
        // Fullscreen here so the window is already on the correct screen when it enters
        // fullscreen — avoids the Linux bug where fullscreen in WebviewWindow config
        // ignores x/y and goes fullscreen on the primary monitor instead.
        await getCurrentWindow().setFullscreen(true).catch(() => {});
      });

      unlistenNav = await listen<{ index: number }>('present:navigate', (e) => {
        setCurrentIndex(e.payload.index);
      });

      unlistenExit = await listen('present:exit', () => {
        getCurrentWindow().close();
      });

      // Signal ready — main window responds with present:init
      await emit('present:ready', null);
    }

    setup();
    return () => { unlistenInit?.(); unlistenNav?.(); unlistenExit?.(); };
  }, []);

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

  const slide = slidesRef.current[currentIndex];
  const { theme, aspectRatio, docTitle } = initData;
  const total = slidesRef.current.length;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'relative',
        width: `min(100vw, calc(100vh * ${aspectRatio.w} / ${aspectRatio.h}))`,
        aspectRatio: `${aspectRatio.w} / ${aspectRatio.h}`,
        overflow: 'hidden',
      }}>
        {slide && (
          <SlideRenderer
            slide={slide}
            theme={theme}
            slideNumber={currentIndex + 1}
            totalSlides={total}
            docTitle={docTitle}
          />
        )}
      </div>
    </div>
  );
}
