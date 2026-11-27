// React wiring for the CLI cold start (src/cli/coldStart.ts).
//
// Split into four hooks rather than one because App's startup effects run in
// declaration order, and the cold-start pieces sit at different points in
// that order: the session flags are read by useDocument and
// usePresentationSession (declared first), the media-wait timer runs with the
// deck derivation, the cold load runs after useDocument's own startup effects
// (restore last session / pending open / drop), and the cold export needs
// useExports' capture functions. Each hook is called where its code used to
// live in App, so no effect moves relative to any other.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPendingCli,
  hasPendingLocalMedia as slidesHavePendingLocalMedia,
  runColdExport,
  runColdLoad,
  type ColdExportContext,
} from '../cli/coldStart';
import type { Theme } from '../engine/theme';
import type { Slide } from '../engine/types';
import type { PendingExport } from '../types/cli';

export interface ColdStartState {
  /**
   * Session was started via `kova --present FILE` (docs/plans/kova-cli.md,
   * Phase B): the editor chrome is never shown, presentation starts as soon
   * as the deck resolves, and exiting quits the process instead of revealing
   * the editor. Stays true for the whole session once set.
   */
  coldPresent: boolean;
  setColdPresent: (on: boolean) => void;
  /**
   * Session was started via `kova --export pptx|pdf|html FILE OUT`: set once
   * the deck has loaded (by useColdLoad, which also handles --present),
   * consumed by useColdExport once slides resolve.
   */
  coldExport: PendingExport | null;
  setColdExport: (exp: PendingExport | null) => void;
}

/** The cold-start session flags. Holds state only; no effects. */
export function useColdStartState(): ColdStartState {
  const [coldPresent, setColdPresent] = useState(false);
  const [coldExport, setColdExport] = useState<PendingExport | null>(null);
  return { coldPresent, setColdPresent, coldExport, setColdExport };
}

/**
 * Bounded wait for local media before a cold export captures the deck. If
 * read_file_b64 fails for a missing or mistyped path, that src never becomes
 * a data: URL and hasPendingLocalMedia would otherwise stay true forever,
 * hanging a CLI export silently. The timer is wall-clock (not dependent on
 * further slide/media changes to re-fire), so it still fires even if nothing
 * else ever triggers a re-render.
 */
export const MEDIA_WAIT_TIMEOUT_MS = 5_000;

export interface LocalMediaGate {
  hasPendingLocalMedia: boolean;
  mediaWaitExpired: boolean;
}

export function useLocalMediaGate(visibleSlides: Slide[]): LocalMediaGate {
  const hasPendingLocalMedia = useMemo(() => slidesHavePendingLocalMedia(visibleSlides), [visibleSlides]);
  const [mediaWaitExpired, setMediaWaitExpired] = useState(false);
  useEffect(() => {
    if (!hasPendingLocalMedia) { setMediaWaitExpired(false); return; }
    const timer = setTimeout(() => setMediaWaitExpired(true), MEDIA_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hasPendingLocalMedia]);
  return { hasPendingLocalMedia, mediaWaitExpired };
}

export interface UseColdLoadOptions {
  cold: Pick<ColdStartState, 'setColdPresent' | 'setColdExport'>;
  /** useDocument's post-read open sequence. */
  applyFileContent: (text: string, path: string) => Promise<void>;
  /** useThemeState's --theme hook. */
  applyCliTheme: (theme: Theme) => void;
}

/**
 * Cold-start load (kova --present / --check / --import / --export): drains
 * the pending CLI request and runs runColdLoad exactly once. The auto-enter
 * for --present lives in usePresentationSession; the export in useColdExport.
 */
export function useColdLoad({ cold, applyFileContent, applyCliTheme }: UseColdLoadOptions): void {
  // The load must run once (applyFileContent's identity changes re-run the
  // drain effect). The matching enter-once guard lives in
  // usePresentationSession.
  const coldLoadStartedRef = useRef(false);
  const { setColdPresent, setColdExport } = cold;
  useEffect(() => {
    if (coldLoadStartedRef.current) return;
    (async () => {
      const cli = await getPendingCli();
      if (coldLoadStartedRef.current) return;
      await runColdLoad(cli, {
        claim: () => { coldLoadStartedRef.current = true; },
        startColdPresent: () => setColdPresent(true),
        applyFileContent,
        applyCliTheme,
        startColdExport: setColdExport,
      });
    })();
    // setColdPresent / setColdExport are useState setters (stable identity),
    // so only applyFileContent / applyCliTheme ever re-run this.
  }, [applyFileContent, applyCliTheme, setColdPresent, setColdExport]);
}

export interface UseColdExportOptions extends Omit<ColdExportContext, 'filePath'> {
  coldExport: PendingExport | null;
  filePath: string | null;
  mediaGate: LocalMediaGate;
}

/**
 * Cold-start export (kova --export pptx|pdf|html FILE OUT): fires once, after
 * useColdLoad has applied --theme and loaded the deck, its slides have
 * resolved, and local media has resolved (or the bounded wait has expired).
 */
export function useColdExport({
  coldExport,
  filePath,
  mediaGate: { hasPendingLocalMedia, mediaWaitExpired },
  visibleSlides,
  frontmatter,
  activeTheme,
  locale,
  pdfPageSize,
  runPdfExportCapture,
  runHtmlExportCapture,
}: UseColdExportOptions): void {
  const coldExportFiredRef = useRef(false);
  useEffect(() => {
    if (!coldExport || coldExportFiredRef.current || !filePath) return;
    if (hasPendingLocalMedia && !mediaWaitExpired) return; // wait (bounded) for local image/video data URLs to resolve
    coldExportFiredRef.current = true;
    void runColdExport(coldExport, {
      filePath,
      visibleSlides,
      frontmatter,
      activeTheme,
      locale,
      pdfPageSize,
      runPdfExportCapture,
      runHtmlExportCapture,
    });
  }, [coldExport, filePath, visibleSlides, hasPendingLocalMedia, mediaWaitExpired, frontmatter, activeTheme, locale, pdfPageSize, runPdfExportCapture, runHtmlExportCapture]);
}
