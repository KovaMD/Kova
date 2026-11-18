import { useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as ipc from '../platform/ipc';
import { registerCachedFont } from '../engine/bundledFonts';
import type { Theme } from '../engine/theme';

type RemoteFonts = Theme['remoteFonts'];

export interface UseRemoteFontsOptions {
  /**
   * Re-run the download only when this value changes, instead of whenever the
   * `fonts` array identity changes. The main window passes the active theme
   * id: remoteFonts are theme-level, not overrides, so a frontmatter edit that
   * rebuilds the merged theme must not trigger another download pass.
   */
  rerunKey?: unknown;
}

/**
 * Download-once, verify, and register a theme's remote fonts in this window's
 * document. Shared by the main window (App) and the audience window
 * (AudienceApp), whose documents are entirely separate: each must register the
 * fonts itself or the audience screen silently falls back to a generic font.
 * Failures are logged and otherwise ignored.
 */
export function useRemoteFonts(fonts: RemoteFonts, options: UseRemoteFontsOptions = {}): void {
  const trigger = 'rerunKey' in options ? options.rerunKey : fonts;
  useEffect(() => {
    if (!fonts?.length) return;
    for (const font of fonts) {
      ipc.downloadAndCacheFont(font.url, font.sha256)
        .then((cachedPath) => {
          registerCachedFont(font.family, cachedPath, font.weight, font.style, font.sha256, convertFileSrc);
        })
        .catch((err) => {
          console.warn(`[kova] remote font "${font.family}" failed: ${err}`);
        });
    }
  // `fonts` is read from the render that changed `trigger`; see rerunKey.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
}
