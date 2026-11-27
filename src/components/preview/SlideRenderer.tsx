import { useCallback, useEffect, useMemo, useRef } from 'react';
import mermaid from 'mermaid';
import { openUrl } from '@tauri-apps/plugin-opener';
import { bestEffort } from '../../platform/bestEffort';
import type { Slide } from '../../engine/types';
import { themeToVars, isLightHex } from '../../engine/theme';
import { useDeck } from './DeckContext';
import { resolveSlideFrame } from '../../engine/render/slideModel';
import { getSlideStepValues } from '../../engine/layout/steps';
import './SlideRenderer.css';
import { buildExportMermaidInit } from '../../engine/export/mermaidExportTheme';
import { SlideCtx, type SlideCtxValue } from './slideContext';
import { SlideLayout } from './layouts';

mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict' });

// Longer than queuedMermaidRender's own per-diagram timeout (mermaidRenderQueue.ts)
// so a diagram still genuinely in flight gets its full chance to finish first.
const MERMAID_READY_TIMEOUT_MS = 20_000;

// Header/footer text. A `|` in the *theme template* splits it into left | center | right
// parts (issue #30); the slide model pre-splits the template before variable resolution
// so a doc title containing `|` (e.g. "Costs | Benefits") is never treated as a separator.
function BarText({ segments, className }: { segments: string[]; className: string }) {
  if (segments.length <= 1) return <span className={className}>{segments[0] ?? ''}</span>;
  const [left = '', center = '', ...rest] = segments;
  const right = rest.join(' | ');
  return (
    <span className={`${className} sl-bar-parts`}>
      <span>{left}</span>
      <span>{center}</span>
      <span>{right}</span>
    </span>
  );
}

interface Props {
  slide: Slide;
  slideNumber?: number;
  totalSlides?: number;
  scale?: number;
  isThumbnail?: boolean;
  hideOverflowBadge?: boolean;
  onAllDiagramsReady?: () => void;
  onNavigateTo?: (slideIndex: number) => void;
  /**
   * How many of this slide's distinct build-reveal steps have been "clicked
   * through" so far — an index into `getSlideStepValues(slide)`, not a raw
   * step value (values can be sparse via `<!-- step: N -->` grouping, so an
   * index is the only representation that survives navigation bookkeeping).
   * `undefined` (the default) means "no gating" — every element renders fully
   * revealed, exactly like before this prop existed. Only the presentation/
   * presenter/audience overlays ever pass a real value.
   */
  revealStepIndex?: number;
}

// Theme and document title/author/date come from DeckContext (useDeck).
export function SlideRenderer({ slide, slideNumber, totalSlides, scale = 1, isThumbnail: isThumbnailProp, hideOverflowBadge = false, onAllDiagramsReady, onNavigateTo, revealStepIndex }: Props) {
  const { theme, docTitle, docAuthor, docDate } = useDeck();
  // Header/footer visibility, bar text, logo placement and per-slide colour
  // precedence all come from the shared slide model (engine/render/slideModel),
  // so the preview and the PPTX export apply the same rules.
  const frame = resolveSlideFrame(
    slide,
    theme,
    { title: docTitle, author: docAuthor, date: docDate },
    { slideNumber, totalSlides },
  );
  const { header, footer, logo } = frame;
  const slideTextColor = frame.colours.text;

  const vars = themeToVars(theme, frame.colours);

  // Signal export-readiness when all Mermaid diagrams on this slide have rendered.
  const mermaidCount = useMemo(() => slide.elements.filter((e) => e.type === 'mermaid').length, [slide.elements]);
  const diagramReadyCount = useRef(0);
  const onAllDiagramsReadyRef = useRef(onAllDiagramsReady);
  useEffect(() => { onAllDiagramsReadyRef.current = onAllDiagramsReady; });
  // Guards every path below that can call onAllDiagramsReady (threshold reached,
  // zero-diagram fast path, timeout fallback) so a slide only ever signals once.
  const allDiagramsSignalledRef = useRef(false);
  const signalAllDiagramsReady = useCallback(() => {
    if (allDiagramsSignalledRef.current) return;
    allDiagramsSignalledRef.current = true;
    onAllDiagramsReadyRef.current?.();
  }, []);
  const onDiagramReady = useCallback(() => {
    diagramReadyCount.current += 1;
    if (diagramReadyCount.current >= mermaidCount) signalAllDiagramsReady();
  }, [mermaidCount, signalAllDiagramsReady]);
  // No cleanup to undo this signal, so StrictMode's dev-only mount→cleanup→
  // mount cycle would otherwise call onAllDiagramsReady twice per slide —
  // overshooting the export's total ready count before slides with actual
  // Mermaid diagrams (whose own signal is properly deduped, see MermaidDiagram)
  // ever finish rendering, so the capture fires too early. Guard with a ref
  // so only the first invocation counts.
  useEffect(() => {
    if (onAllDiagramsReady && mermaidCount === 0) signalAllDiagramsReady();
  }, [onAllDiagramsReady, mermaidCount, signalAllDiagramsReady]);
  // Bounded wait: a diagram whose render is cancelled before it ever caches an
  // SVG (see MermaidDiagram's cleanup) doesn't advance the ready count, and
  // relies on a later render of the same diagram to finish and signal instead
  // — if that never happens (e.g. a broken diagram whose replacement render
  // also keeps getting cancelled), this slide would otherwise block the export
  // forever. Force readiness after a timeout comfortably longer than
  // queuedMermaidRender's own per-diagram timeout, so a diagram that's still
  // genuinely in flight gets its full chance to finish first.
  useEffect(() => {
    if (!onAllDiagramsReady || mermaidCount === 0) return;
    const timer = setTimeout(signalAllDiagramsReady, MERMAID_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [onAllDiagramsReady, mermaidCount, signalAllDiagramsReady]);

  const isThumbnail = isThumbnailProp ?? scale !== 1;

  // Build-reveal: resolve `revealStepIndex` (an index into this slide's
  // distinct step values) to the actual visibility cutoff. `undefined` stays
  // "no gating" — thumbnails/exports/print never pass this prop at all.
  const stepValues = useMemo(() => getSlideStepValues(slide), [slide]);
  const revealThreshold = revealStepIndex === undefined
    ? undefined
    : revealStepIndex > 0 ? stepValues[revealStepIndex - 1] : -Infinity;

  // Only a genuine forward, same-slide, single-step increment gets the reveal
  // transition — a slide change, a backward step, a multi-step jump (ToC
  // click, dual-window resync), or landing directly on a slide's Nth step all
  // render statically. Refs (not state) so this never triggers an extra
  // render of its own; they still hold the *previous* commit's values while
  // this render's body runs, which is exactly the comparison needed.
  const prevSlideIndexRef = useRef<number | undefined>(undefined);
  const prevRevealStepIndexRef = useRef<number | undefined>(undefined);
  let enteringStep: number | undefined;
  if (
    revealStepIndex !== undefined
    && prevSlideIndexRef.current === slide.index
    && prevRevealStepIndexRef.current !== undefined
    && revealStepIndex === prevRevealStepIndexRef.current + 1
  ) {
    enteringStep = stepValues[revealStepIndex - 1];
  }
  useEffect(() => {
    prevSlideIndexRef.current = slide.index;
    prevRevealStepIndexRef.current = revealStepIndex;
  });

  const ctxValue = useMemo<SlideCtxValue>(
    () => ({ isThumbnail, hideOverflowBadge, textColor: slideTextColor, mermaidInit: buildExportMermaidInit(theme), tocNumbered: theme.toc.numbered, onDiagramReady: onAllDiagramsReady ? onDiagramReady : undefined, onNavigateTo, revealThreshold, enteringStep }),
    [isThumbnail, hideOverflowBadge, slideTextColor, theme, onAllDiagramsReady, onDiagramReady, onNavigateTo, revealThreshold, enteringStep],
  );

  // Markdown-authored <a> tags (rendered via dangerouslySetInnerHTML in child
  // elements) would otherwise navigate the Tauri webview itself, stranding the
  // user outside the app with no way back to the presentation (issue #142).
  // Delegate from the slide root so every content area is covered without
  // wiring a handler into each renderer.
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href === '#') return;
    e.preventDefault();
    e.stopPropagation();
    if (!isThumbnail) bestEffort(openUrl(href), 'openUrl');
  }, [isThumbnail]);

  return (
    <SlideCtx.Provider value={ctxValue}>
    <div
      className={`slide-frame layout-${slide.layout}`}
      style={{ ...vars, ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: 'top left' } : {}) }}
      data-layout={slide.layout}
      data-code-scheme={isLightHex(theme.colors.code_bg) ? 'light' : 'dark'}
      onClick={handleContentClick}
    >
      {/* Header bar */}
      {header.visible && (
        <div className="sl-header-bar">
          {logo.placement === 'header' && (
            <img src={logo.src} alt="Logo" className="sl-logo"
              style={{
                opacity: logo.opacity,
                ...(logo.position === 'top-right' ? { marginLeft: 'auto', order: 2 } : {}),
              }} />
          )}
          {header.hasText && <BarText segments={header.segments} className="sl-header-text" />}
        </div>
      )}

      {/* Floating logo (when no header/footer) */}
      {logo.placement === 'floating' && (
        <img
          src={logo.src}
          alt="Logo"
          className={`sl-logo-float pos-${logo.position}`}
          style={{ opacity: logo.opacity }}
        />
      )}

      {/* Main content area */}
      <div
        className={slide.backgroundImage ? 'sl-content-area sl-content-area--bg-image' : 'sl-content-area'}
        style={slide.backgroundImage ? {
          backgroundImage: `url("${slide.backgroundImage.src}")`,
          backgroundSize: slide.backgroundImage.size,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        } : undefined}
      >
        <SlideLayout slide={slide} />
        {slide.references.length > 0 && (
          <div className="sl-references">
            {slide.references.map((ref, i) => (
              <div key={i} className="sl-reference" dangerouslySetInnerHTML={{ __html: ref }} />
            ))}
          </div>
        )}
      </div>

      {/* Footer bar */}
      {footer.visible && (
        <div className="sl-footer-bar">
          {logo.placement === 'footer' && (
            <img src={logo.src} alt="Logo" className="sl-logo-footer"
              style={{
                opacity: logo.opacity,
                ...(logo.position === 'bottom-right' ? { marginLeft: 'auto', order: 2 } : {}),
              }} />
          )}
          {footer.hasText && <BarText segments={footer.segments} className="sl-footer-text" />}
          {/* Bare number by design; the PPTX footer shows "n / total". */}
          {footer.showSlideNumber && (
            <span className="sl-slide-num">{footer.slideNumber}</span>
          )}
        </div>
      )}
    </div>
    </SlideCtx.Provider>
  );
}
