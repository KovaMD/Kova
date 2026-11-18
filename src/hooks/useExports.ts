import { useCallback, type RefObject } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import * as ipc from '../platform/ipc';
import { exportToPptx } from '../engine/export/pptx';
import { exportToPdf, printPresentation } from '../engine/export/exportPdf';
import { exportPdfNative, buildInteractiveDocument, type PdfExportOpts } from '../engine/export/exportPdfNative';
import { isLocalRelative } from '../engine/paths';
import type { AspectRatio, Frontmatter, Slide } from '../engine/types';
import type { Theme } from '../engine/theme';
import type { Translator } from '../i18n';
import type { UseOffscreenCaptureResult } from './useOffscreenCapture';

export interface PdfExportOutcome {
  warnings: string[];
  usedFallback: boolean;
  fallbackReason?: string;
}

export interface UseExportsOptions {
  /** Deck to export: hidden slides already removed. */
  visibleSlides: Slide[];
  frontmatter: Frontmatter;
  activeTheme: Theme;
  aspectRatio: AspectRatio;
  /** UI locale, passed to the PPTX exporter. */
  locale: string;
  /** Path of the open document, or null for an unsaved one. */
  filePath: string | null;
  /** Live document source, read by Copy with Assets. */
  contentRef: RefObject<string>;
  t: Translator;
  /** The shared off-screen capture (useOffscreenCapture). */
  offscreen: Pick<UseOffscreenCaptureResult, 'capturing' | 'runCapture'>;
}

export interface UseExportsResult {
  exportPptx: () => Promise<void>;
  exportPdf: (opts?: PdfExportOpts) => Promise<void>;
  exportHtml: () => Promise<void>;
  print: () => Promise<void>;
  copyWithAssets: () => Promise<void>;
  /**
   * Native print first, raster fallback on failure. Reports what happened
   * rather than alerting, so the CLI cold-export path can reuse it. Rejects
   * only on total failure (both native and the raster fallback failed).
   */
  runPdfExportCapture: (visSlides: Slide[], savePath: string, opts: PdfExportOpts) => Promise<PdfExportOutcome>;
  /** Assembles the self-contained interactive deck; shared with the CLI. */
  runHtmlExportCapture: (visSlides: Slide[]) => Promise<string>;
}

/**
 * File-menu export actions: PPTX, PDF, HTML, Print and Copy with Assets.
 * PDF, HTML and Print render through the shared off-screen capture.
 */
export function useExports({
  visibleSlides,
  frontmatter,
  activeTheme,
  aspectRatio,
  locale,
  filePath,
  contentRef,
  t,
  offscreen,
}: UseExportsOptions): UseExportsResult {
  const { capturing, runCapture } = offscreen;

  const exportPptx = useCallback(async () => {
    if (visibleSlides.length === 0) return;
    try {
      const { base64, warnings } = await exportToPptx(visibleSlides, frontmatter, activeTheme, locale);
      const defaultPath = filePath
        ? filePath.replace(/\.(md|markdown)$/i, '.pptx')
        : 'presentation.pptx';
      const target = await save({
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
        defaultPath,
      });
      if (!target) return;
      const savePath = target.toLowerCase().endsWith('.pptx') ? target : `${target}.pptx`;
      await ipc.writeFileBytes(savePath, base64);
      if (warnings.length > 0) {
        window.alert(t('app.exportCompleteWithWarnings', { count: warnings.length, warnings: warnings.join('\n') }));
      }
    } catch (err) {
      console.error('Export failed:', err);
      window.alert(t('app.pptxExportFailed', { error: String(err) }));
    }
  }, [visibleSlides, frontmatter, activeTheme, filePath, locale, t]);

  const runPdfExportCapture = useCallback((
    visSlides: Slide[],
    savePath: string,
    opts: PdfExportOpts,
  ): Promise<PdfExportOutcome> =>
    runCapture(visSlides, async (elements) => {
      try {
        await exportPdfNative(elements, aspectRatio, savePath, opts);
        return { warnings: [], usedFallback: false };
      } catch (nativeErr) {
        // Native backend unavailable/failed — degrade to the raster renderer.
        // It's one-slide-per-page and ignores handout/N-up/paper options.
        const { base64, warnings } = await exportToPdf(elements, activeTheme, aspectRatio);
        await ipc.writeFileBytes(savePath, base64);
        return { warnings, usedFallback: true, fallbackReason: String(nativeErr) };
      }
    }), [runCapture, aspectRatio, activeTheme]);

  const runHtmlExportCapture = useCallback((visSlides: Slide[]): Promise<string> =>
    runCapture(visSlides, (elements) =>
      buildInteractiveDocument(elements, aspectRatio, visSlides),
    ), [runCapture, aspectRatio]);

  const exportPdf = useCallback(async (opts: PdfExportOpts = {}) => {
    if (visibleSlides.length === 0) return;
    // The in-window buttons disable while an export is already in flight, but
    // the macOS native menu bar has no such guard (its items are always
    // enabled) — without this, triggering a second export via the menu while
    // one is running clobbers the first's shared in-flight refs/state.
    if (capturing !== null) return;
    const defaultPath = filePath
      ? filePath.replace(/\.(md|markdown)$/i, '.pdf')
      : 'presentation.pdf';
    const target = await save({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      defaultPath,
    });
    if (!target) return;
    const savePath = target.toLowerCase().endsWith('.pdf') ? target : `${target}.pdf`;

    try {
      const outcome = await runPdfExportCapture([...visibleSlides], savePath, opts);
      if (outcome.usedFallback) {
        console.error('Native PDF failed, falling back to raster:', outcome.fallbackReason);
        window.alert(
          t('app.pdfExportFallback') +
          `\n\n${t('app.pdfExportFallbackReason', { error: outcome.fallbackReason ?? '' })}` +
          (outcome.warnings.length ? `\n\n${outcome.warnings.join('\n')}` : ''),
        );
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      window.alert(t('app.pdfExportFailed', { error: String(err) }));
    }
  }, [visibleSlides, filePath, runPdfExportCapture, t, capturing]);

  const exportHtml = useCallback(async () => {
    if (visibleSlides.length === 0) return;
    if (capturing !== null) return;
    const defaultPath = filePath
      ? filePath.replace(/\.(md|markdown)$/i, '.html')
      : 'presentation.html';
    const target = await save({
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath,
    });
    if (!target) return;
    const savePath = target.toLowerCase().endsWith('.html') ? target : `${target}.html`;
    try {
      const html = await runHtmlExportCapture([...visibleSlides]);
      await ipc.writeFile(savePath, html);
    } catch (err) {
      console.error('HTML export failed:', err);
      window.alert(t('app.htmlExportFailed', { error: String(err) }));
    }
  }, [visibleSlides, filePath, runHtmlExportCapture, t, capturing]);

  const print = useCallback(async () => {
    if (visibleSlides.length === 0) return;
    if (capturing !== null) return;
    try {
      await runCapture([...visibleSlides], async (elements) => {
        const { warnings } = await printPresentation(elements, activeTheme, aspectRatio);
        if (warnings.length > 0) {
          window.alert(t('app.printCompleteWithWarnings', { count: warnings.length, warnings: warnings.join('\n') }));
        }
      }, 'print');
    } catch (err) {
      console.error('Print failed:', err);
    }
  }, [visibleSlides, activeTheme, aspectRatio, t, capturing, runCapture]);

  const copyWithAssets = useCallback(async () => {
    if (!filePath) return;
    const defaultPath = filePath.replace(/\.(md|markdown)$/i, '') + '-copy.md';
    const target = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath,
    });
    if (!target) return;
    const destPath = target.toLowerCase().endsWith('.md') ? target : `${target}.md`;
    const src = contentRef.current;
    const seen = new Set<string>();
    const WEB_URL = /^(https?|data|asset|tauri):\/\//i;
    // Rust re-validates and is the real security boundary (asset refs must
    // resolve to a plain relative path under src/dest dir) — this just avoids
    // surfacing a Rust-side error for the common case of a malformed doc.
    for (const m of src.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const ref = decodeURIComponent(m[1]);
      if (!WEB_URL.test(ref) && isLocalRelative(ref)) seen.add(ref);
    }
    for (const m of src.matchAll(/<img[^>]+src=["']([^"']+)["']/g)) {
      const ref = decodeURIComponent(m[1]);
      if (!WEB_URL.test(ref) && isLocalRelative(ref)) seen.add(ref);
    }
    try {
      await ipc.copyFileWithAssets({
        srcPath: filePath,
        content: src,
        destPath,
        assetRefs: Array.from(seen),
      });
    } catch (err) { console.error('Copy with assets failed:', err); }
  }, [filePath, contentRef]);

  return {
    exportPptx,
    exportPdf,
    exportHtml,
    print,
    copyWithAssets,
    runPdfExportCapture,
    runHtmlExportCapture,
  };
}
