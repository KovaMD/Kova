import React, { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { QRCode } from 'react-qr-code';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { SlideElement, ListItem } from '../../engine/types';
import { mermaidSvgCache } from '../../engine/export/mermaidSvgCache';
import { buildMermaidRenderSource } from '../../engine/export/mermaidSource';
import { queuedMermaidRender } from '../../engine/export/mermaidRenderQueue';
import { fitMermaidViewBox } from '../../engine/export/mermaidViewBox';
import { useT } from '../../i18n';
import { ErrorBoundary } from '../ErrorBoundary';
import { SlideCtx } from './slideContext';

// Parse an image title like "50%" or "300px" into an inline width style.
// Returning a style disables the default max-height cap on the wrapper.
function parseSizeHint(title?: string): React.CSSProperties | null {
  if (!title) return null;
  const t = title.trim();
  if (/^\d+(\.\d+)?(px|%|em|rem|cqi|vw)$/.test(t)) return { width: t, height: 'auto' };
  return null;
}

// ── Element renderer ──────────────────────────────────────────────────────────

function getElementStep(el: SlideElement): number | undefined {
  return el.type === 'column-break' ? undefined : el.step;
}

// Shared by StepGate and ListItemNode below so their pending/entering class
// names can't drift apart. Returns undefined for an unstepped element —
// callers use that to skip wrapping/gating entirely.
export function stepGateClassName(
  step: number | undefined,
  revealThreshold: number | undefined,
  enteringStep: number | undefined,
): string | undefined {
  if (step === undefined) return undefined;
  const pending = revealThreshold !== undefined && step > revealThreshold;
  const entering = step === enteringStep;
  return `sl-step-item${pending ? ' sl-step-item--pending' : ''}${entering ? ' sl-step-item--entering' : ''}`;
}

// Appends an optional gate class (from stepGateClassName) onto an existing
// className, for elements that self-gate directly rather than through a
// StepGate wrapper — see MathBlock/YoutubeEmbed/VideoEmbed/PollEmbed below.
function withClass(base: string, gateClass: string | undefined): string {
  return gateClass ? `${base} ${gateClass}` : base;
}

// Gates one element's visibility during a build/reveal presentation. Only
// wraps elements that actually carry a `.step` — everything else (the vast
// majority of a typical slide) renders completely unwrapped, so a deck with
// no step markers anywhere pays zero extra DOM/CSS cost.
//
// Hidden-but-reserves-space (opacity/visibility, not display:none): the
// wrapper stays in flow while pending because OverflowPane (layouts.tsx)
// measures the full, fully-built content height once — if a pending element
// were removed from flow instead, the computed shrink-to-fit scale would
// shift on every reveal click, visibly resizing already-revealed text.
export function StepGate({ step, children }: { step?: number; children: React.ReactNode }) {
  const { revealThreshold, enteringStep } = useContext(SlideCtx);
  const className = stepGateClassName(step, revealThreshold, enteringStep);
  if (!className) return <>{children}</>;
  return <div className={className} data-step={step}>{children}</div>;
}

export function Elements({ elements }: { elements: SlideElement[] }) {
  return (
    <>
      {elements.map((el, i) => (
        <StepGate key={i} step={getElementStep(el)}>
          <ElementNode el={el} />
        </StepGate>
      ))}
    </>
  );
}

// One inline SVG per canonical callout style (see resolveCalloutStyle in the
// parser) — no icon library is used elsewhere in the app, so these follow the
// same hand-drawn-inline convention as InfoBanner's dismiss icon.
const CALLOUT_ICONS: Record<string, React.ReactNode> = {
  note: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h13l3 3v13H4z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
    </svg>
  ),
  tip: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3Z" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20L12 3Z" />
      <line x1="12" y1="10" x2="12" y2="15" />
      <circle cx="12" cy="17.5" r="0.5" fill="currentColor" />
    </svg>
  ),
  danger: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  ),
};

function ElementNode({ el }: { el: SlideElement }) {
  switch (el.type) {
    case 'paragraph':
      return <p className="sl-para" dangerouslySetInnerHTML={{ __html: el.html }} />;

    case 'list':
      return el.ordered
        ? <ol className="sl-list">{el.items.map((item, i) => <ListItemNode key={i} item={item} />)}</ol>
        : <ul className="sl-list">{el.items.map((item, i) => <ListItemNode key={i} item={item} />)}</ul>;

    case 'image': {
      const size = parseSizeHint(el.title);
      return (
        <>
          <div className={`sl-img-wrap${size ? ' sl-img-wrap--user' : ''}`}>
            <img src={el.src} alt={el.alt} className="sl-img" style={size ?? undefined} />
          </div>
          {el.caption && <div className="sl-caption">{el.caption}</div>}
        </>
      );
    }

    case 'blockquote':
      if (el.calloutType) {
        return (
          <div className={`sl-callout sl-callout--${el.calloutType}`}>
            <div className="sl-callout__title">
              <span className="sl-callout__icon">{CALLOUT_ICONS[el.calloutType]}</span>
              {el.title}
            </div>
            {el.html && (
              <div className="sl-callout__body" dangerouslySetInnerHTML={{ __html: el.html }} />
            )}
          </div>
        );
      }
      return (
        <blockquote className="sl-blockquote">
          {el.html
            ? <div dangerouslySetInnerHTML={{ __html: el.html }} />
            : <p>{el.text}</p>}
          {el.attribution && <cite>— {el.attribution}</cite>}
        </blockquote>
      );

    case 'table':
      return (
        <>
          <table className="sl-table">
            <thead>
              <tr>{el.headers.map((h, i) => <th key={i} style={{ textAlign: el.align?.[i] || undefined }} dangerouslySetInnerHTML={{ __html: h }} />)}</tr>
            </thead>
            <tbody>
              {el.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} style={{ textAlign: el.align?.[j] || undefined }} dangerouslySetInnerHTML={{ __html: cell }} />)}</tr>
              ))}
            </tbody>
          </table>
          {el.caption && <div className="sl-caption">{el.caption}</div>}
        </>
      );

    case 'code':
      return (
        <div className="sl-code-inline">
          {el.lang && <span className="sl-code__lang">{el.lang}</span>}
          <CodeBlock lang={el.lang} value={el.value} />
        </div>
      );

    case 'youtube':
      return <YoutubeEmbed embed={el} />;

    case 'video':
      return <VideoEmbed embed={el} />;

    case 'poll':
      return <PollEmbed embed={el} />;

    case 'progress':
      return <ProgressBar el={el} />;

    case 'column-break':
      return null;

    case 'toc':
      return <TocElement el={el} />;

    case 'mermaid':
      return <MermaidDiagram value={el.value} caption={el.caption} />;

    case 'math':
      return <MathBlock value={el.value} display={el.display} caption={el.caption} />;

    default:
      return null;
  }
}

export function ListItemNode({ item }: { item: ListItem }) {
  // A list item is already its own `<li>` box, so the gating classes/attribute
  // apply directly to it instead of introducing an extra wrapper (unlike
  // StepGate above, which has to wrap because ElementNode's output varies).
  const { revealThreshold, enteringStep } = useContext(SlideCtx);
  const className = stepGateClassName(item.step, revealThreshold, enteringStep);
  return (
    <li className={className} data-step={item.step}>
      <span dangerouslySetInnerHTML={{ __html: item.html }} />
      {item.children.length > 0 && (
        <ul className="sl-list sl-list--nested">
          {item.children.map((child, i) => <ListItemNode key={i} item={child} />)}
        </ul>
      )}
    </li>
  );
}

// ── Table of contents ─────────────────────────────────────────────────────────

function TocElement({ el }: { el: Extract<SlideElement, { type: 'toc' }> }) {
  const t = useT();
  const { isThumbnail, onNavigateTo, tocNumbered } = useContext(SlideCtx);
  const interactive = !isThumbnail && !!onNavigateTo;

  if (el.entries.length === 0) {
    return <p className="sl-para" style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('preview.noTitledSlidesFound')}</p>;
  }
  const items = el.entries.map((entry, i) => (
    <li key={i}>
      {interactive ? (
        <button className="sl-toc-link" onClick={(e) => { e.stopPropagation(); onNavigateTo!(entry.index); }}>
          {entry.title}
        </button>
      ) : (
        <span>{entry.title}</span>
      )}
    </li>
  ));
  return tocNumbered ? (
    <ol className="sl-list sl-list--toc sl-list--toc-ordered" start={(el.numberStart ?? 0) + 1}>{items}</ol>
  ) : (
    <ul className="sl-list sl-list--toc">{items}</ul>
  );
}

// ── Media embeds ──────────────────────────────────────────────────────────────

export function YoutubeEmbed({ embed }: { embed: Extract<SlideElement, { type: 'youtube' }> }) {
  const t = useT();
  const { isThumbnail, revealThreshold, enteringStep } = useContext(SlideCtx);
  const thumb = youtubeThumb(embed.url);
  // MediaLayout (layouts.tsx) renders this directly, bypassing the StepGate
  // wrapper Elements() would otherwise provide — self-gate here instead of
  // introducing a wrapper div, since .sl-media__body sizes this element via
  // height:100%/flex against its *immediate* parent, which a wrapper with no
  // definite size of its own would break. (Redundant but harmless when this
  // *is* reached via Elements(), since embed.step is the same either way.)
  const gateClass = stepGateClassName(embed.step, revealThreshold, enteringStep);

  const handleClick = (e: React.MouseEvent) => {
    if (isThumbnail) return;
    e.stopPropagation(); // prevent click bubbling to PresentationOverlay navigation handler
    openUrl(embed.url).catch(() => {});
  };

  return (
    <div
      className={`sl-youtube${!isThumbnail ? ' sl-youtube--clickable' : ''}${gateClass ? ` ${gateClass}` : ''}`}
      data-step={embed.step}
      onClick={handleClick}
      title={!isThumbnail ? t('preview.openInBrowserTitle', { url: embed.url }) : undefined}
    >
      {thumb
        ? <img src={thumb} alt={embed.label} className="sl-youtube__thumb" />
        : <div className="sl-youtube__placeholder">{t('preview.youtubePlaceholder')}</div>
      }
      <div className="sl-youtube__label">{embed.label}</div>
      {!isThumbnail && <div className="sl-youtube__open-hint">{t('preview.clickToOpenInBrowser')}</div>}
    </div>
  );
}

export function VideoEmbed({ embed }: { embed: Extract<SlideElement, { type: 'video' }> }) {
  const { isThumbnail, revealThreshold, enteringStep } = useContext(SlideCtx);
  // See the matching comment in YoutubeEmbed above — same self-gating
  // rationale, same MediaLayout bypass.
  const gateClass = stepGateClassName(embed.step, revealThreshold, enteringStep);
  return (
    // stopPropagation so the player's controls don't trigger slide navigation.
    <div className={`sl-video${gateClass ? ` ${gateClass}` : ''}`} data-step={embed.step} onClick={(e) => e.stopPropagation()}>
      <video className="sl-video__player" src={embed.src} controls={!isThumbnail} preload="metadata" playsInline />
      {embed.label && <div className="sl-video__label">{embed.label}</div>}
    </div>
  );
}

export function PollEmbed({ embed }: { embed: Extract<SlideElement, { type: 'poll' }> }) {
  const { isThumbnail, textColor, revealThreshold, enteringStep } = useContext(SlideCtx);
  const t = useT();
  // See the matching comment in YoutubeEmbed above — same self-gating
  // rationale, same MediaLayout bypass. (isThumbnail is always true here
  // when revealThreshold would be set at all, so this is a no-op in
  // practice for the branch below, but kept for correctness rather than
  // relying on that being true forever.)
  const gateClass = stepGateClassName(embed.step, revealThreshold, enteringStep);

  if (isThumbnail) {
    return (
      <div className={`sl-poll${gateClass ? ` ${gateClass}` : ''}`} data-step={embed.step}>
        <div className="sl-poll__icon">📊</div>
        <div className="sl-poll__label">{embed.label}</div>
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // prevent click bubbling to PresentationOverlay navigation handler
    openUrl(embed.url).catch(() => {});
  };

  return (
    <div
      className={`sl-poll sl-poll--clickable${gateClass ? ` ${gateClass}` : ''}`}
      data-step={embed.step}
      onClick={handleClick}
      title={t('preview.openInBrowserTitle', { url: embed.url })}
    >
      <div className="sl-poll__qr">
        <ErrorBoundary
          fallback={<div className="sl-poll__qr-error">{t('preview.pollQrUnavailable')}</div>}
          onError={(error) => console.error('Poll QR code failed to render:', error)}
        >
          <QRCode value={embed.url} size={160} bgColor="transparent" fgColor={textColor} />
        </ErrorBoundary>
      </div>
      <div className="sl-poll__label">{embed.label}</div>
      <div className="sl-poll__url">{embed.url}</div>
      <div className="sl-poll__open-hint">{t('preview.clickToOpenInBrowser')}</div>
    </div>
  );
}

function youtubeThumb(url: string): string | null {
  const id = extractYoutubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#]+)/,
    /youtube\.com\/embed\/([^?&#]+)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

// ── Syntax-highlighted code block ─────────────────────────────────────────────

export function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const highlighted = useMemo(
    () => lang && hljs.getLanguage(lang)
      ? hljs.highlight(value, { language: lang }).value
      : hljs.highlightAuto(value).value,
    [lang, value],
  );

  return (
    <pre>
      <code
        className={lang ? `language-${lang}` : ''}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ el }: { el: Extract<SlideElement, { type: 'progress' }> }) {
  const pct = Math.max(0, Math.min(100, el.value));
  return (
    <div className="sl-progress">
      <div className="sl-progress__header">
        <span className="sl-progress__label">{el.label}</span>
        <span className="sl-progress__pct">{pct}%</span>
      </div>
      <div className="sl-progress__track">
        <div className="sl-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Math block ────────────────────────────────────────────────────────────────

export function MathBlock({ value, display, caption, step }: { value: string; display: boolean; caption?: string; step?: number }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(value, { displayMode: display, throwOnError: false });
    } catch {
      return `<code>${value}</code>`;
    }
  }, [value, display]);
  // Only MathLayout (layouts.tsx) passes `step` — it renders this directly,
  // bypassing the StepGate wrapper Elements() would otherwise provide, and a
  // wrapper div here would break .sl-math's width:100% (needs its *immediate*
  // parent to have a definite width). Elements()'s own call site leaves this
  // undefined, since gating already happens one level up there.
  const { revealThreshold, enteringStep } = useContext(SlideCtx);
  const gateClass = stepGateClassName(step, revealThreshold, enteringStep);

  return (
    <>
      <div
        className={`sl-math${display ? ' sl-math--display' : ''}${gateClass ? ` ${gateClass}` : ''}`}
        data-step={step}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {caption && <div className={withClass('sl-caption', gateClass)} data-step={step}>{caption}</div>}
    </>
  );
}

// ── Mermaid diagram ───────────────────────────────────────────────────────────

export function MermaidDiagram({ value, caption }: { value: string; caption?: string }) {
  const { mermaidInit, onDiagramReady } = useContext(SlideCtx);
  const onDiagramReadyRef = useRef(onDiagramReady);
  useEffect(() => { onDiagramReadyRef.current = onDiagramReady; });
  const rawId  = useId();
  const baseId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  // mermaid.render rejects a second call with the same id because it tries to
  // reuse a DOM node from the previous render. A counter forces a fresh id.
  const counter = useRef(0);
  const [svg, setSvg] = useState('');
  const [mermaidError, setMermaidError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  // Stores the signalReady fn to call after the SVG DOM commit. Using a ref
  // lets useLayoutEffect (which fires post-commit) consume it safely even if
  // the effect cleanup has already run (cleanup nulls it to prevent double-fire).
  const pendingSignalRef = useRef<(() => void) | null>(null);

  // Once Mermaid has rendered, fit the viewBox to what was actually drawn (see
  // fitMermaidViewBox), then fire the deferred signalReady so export runners see
  // the SVG in the DOM before they call cloneNode / html-to-image capture.
  useLayoutEffect(() => {
    const svgEl = containerRef.current?.querySelector('svg');
    if (svgEl) fitMermaidViewBox(svgEl);
    const fn = pendingSignalRef.current;
    if (fn) { pendingSignalRef.current = null; fn(); }
  }, [svg]);

  useEffect(() => {
    let cancelled = false;
    let signalled = false;
    const signalReady = () => {
      if (!signalled) { signalled = true; onDiagramReadyRef.current?.(); }
    };
    setSvg('');
    setMermaidError('');
    // Enforce Mermaid security policy, then prepend theme init only when the
    // diagram has no leading Mermaid config.
    const src = buildMermaidRenderSource(value, mermaidInit);
    const renderId = `${baseId}-${++counter.current}`;
    queuedMermaidRender(renderId, src)
      .then(({ svg: out }: { svg: string }) => {
        if (!cancelled) {
          // Cache raw SVG for the PPTX exporter before rewriting dimensions.
          mermaidSvgCache.set(value, out);
          // Only rewrite attributes on the <svg> opening tag to avoid
          // accidentally mutating inner element attributes (e.g. legend rects).
          const scaled = out.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
            let a = attrs
              .replace(/\bwidth="[^"]*"/, 'width="100%"')
              .replace(/\bheight="[^"]*"/, 'height="100%"')
              .replace(/\bstyle="[^"]*max-width[^"]*"/, '');
            if (!/preserveAspectRatio/.test(a)) a += ' preserveAspectRatio="xMidYMid meet"';
            return `<svg${a}>`;
          });
          setSvg(scaled);
          // Defer signalReady to useLayoutEffect so the export runner sees the
          // SVG in the DOM before it calls cloneNode/toPng.
          pendingSignalRef.current = signalReady;
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const raw = err instanceof Error ? err.message : String(err);
          setMermaidError(raw.replace(/^.*?error:?\s*/i, '').slice(0, 120) || 'Diagram error');
          signalReady();
        }
      });
    // If this render is cancelled mid-flight (e.g. theme change during export),
    // signal ready so the export count still advances; the replacement render
    // will also signal when it completes.
    return () => { cancelled = true; pendingSignalRef.current = null; signalReady(); };
  }, [baseId, value, mermaidInit]);

  if (!svg) {
    return (
      <>
        <div
          data-mermaid-src={value}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flex: 1, minHeight: 0, fontSize: 'clamp(7px, 1.5cqi, 12px)',
            color: mermaidError ? 'var(--sl-text)' : 'var(--sl-accent)', opacity: 0.7,
          }}
        >
          {mermaidError ? `⚠ ${mermaidError}` : '◇ Diagram'}
        </div>
        {caption && <div className="sl-caption">{caption}</div>}
      </>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        data-mermaid-src={value}
        className="sl-mermaid"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {caption && <div className="sl-caption">{caption}</div>}
    </>
  );
}
