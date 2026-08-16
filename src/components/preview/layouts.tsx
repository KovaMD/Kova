import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Slide, SlideElement } from '../../engine/types';
import { autoSplitElements, explodeListItems, groupProgressRuns, splitByColumnBreaks } from '../../engine/layout/elementGrouping';
import { useT } from '../../i18n';
import { SlideCtx } from './slideContext';
import { Elements, StepGate, stepGateClassName, CodeBlock, MermaidDiagram, YoutubeEmbed, VideoEmbed, PollEmbed, MathBlock } from './elements';

// Scales content down to fit its container when it overflows.
// Measures content extent vs available height after every render and on
// resize, then applies CSS zoom to the inner wrapper — no visual flash
// because the measurement and style update both happen inside
// useLayoutEffect (before paint).
//
// zoom (not transform: scale()) deliberately, because it reflows: shrinking
// a transform:scale()'d block leaves its *wrap points* computed at the
// original, larger size, so the now-smaller text sits inset from the pane's
// actual width with visible dead space beside it — exactly the "wrapping has
// a margin" symptom once a pane holds enough text to overflow (issue #159).
// zoom rewraps at the new effective size using the full available width. But
// because it reflows, height isn't a linear function of it — a single guess
// (availH / contentH) systematically under-shrinks, since text reflowed
// smaller packs tighter than a pure geometric scale predicts, which leaves
// its own unused space once a pane holds enough text. remeasure() binary
// searches for the largest zoom that actually fits instead of guessing once.
//
// `minScale`/`onNaturalScale` are an opt-in pair that let a parent (e.g.
// MultiColumnLayout) synchronise the shrink across sibling panes: each pane
// reports its own unclamped ("natural") fit scale via onNaturalScale, and the
// parent feeds back the smallest of its children's scales as minScale so a
// lightly filled column shrinks in lockstep with a heavily overflowing
// sibling instead of sitting at full size with empty space below it — see
// issue #145.
export function OverflowPane({ className, elements, minScale, onNaturalScale }: { className: string; elements: SlideElement[]; minScale?: number; onNaturalScale?: (scale: number) => void }) {
  const t = useT();
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // zoom is applied to zoomRef, a child of innerRef, rather than to innerRef
  // itself — reading scrollHeight back on the same element zoom is applied to
  // is unreliable on WebKitGTK (it comes back as roughly availH / zoom at
  // every level tried, as if scrollHeight were reporting the element's own
  // flex-allocated box divided back out by the zoom factor, rather than the
  // true — possibly overflowing — content height). Keeping innerRef unzoomed
  // and measuring *it* while zoom lives one level down avoids that entirely.
  const zoomRef = useRef<HTMLDivElement>(null);
  const { isThumbnail, hideOverflowBadge } = useContext(SlideCtx);
  const fitScaleRef = useRef(1); // this pane's own natural (unclamped) fit scale
  const [fitScale, setFitScale] = useState(1);
  const minScaleRef = useRef(minScale);
  minScaleRef.current = minScale;

  const lastRef = useRef({ c: -1, a: -1 });

  const applyZoom = useCallback((natural: number) => {
    const zoomEl = zoomRef.current;
    if (!zoomEl) return;
    const applied = Math.min(natural, minScaleRef.current ?? 1);
    zoomEl.style.zoom = applied < 1 ? String(applied) : '';
  }, []);

  const remeasure = useCallback(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    const zoomEl = zoomRef.current;
    if (!outer || !inner || !zoomEl) return;
    // scrollHeight turns out to be unusable here: on WebKitGTK, reading it on
    // (or across) an element that has zoom applied comes back tangled up
    // with the zoom factor and/or an ancestor's overflow:hidden, rather than
    // the true content extent scrollHeight is specced to report regardless
    // of clipping. A Range spanning the zoomed element's contents doesn't
    // have that problem — getBoundingClientRect() on it is pure paint
    // geometry, unaffected by zoom or by overflow:hidden anywhere above it.
    const range = document.createRange();
    const measureContentH = () => {
      range.selectNodeContents(zoomEl);
      return range.getBoundingClientRect().height;
    };
    // Measure unzoomed, then bail if nothing changed since last time (rounded,
    // since Range geometry is sub-pixel and would otherwise almost never
    // exactly repeat). The bail is what makes this loop-proof: once
    // dimensions settle, no setState fires, so the ResizeObserver → setState
    // → re-render cycle terminates.
    zoomEl.style.zoom = '';
    const contentH = Math.round(measureContentH());
    // inner (unzoomed, sized by flex:1 off outer) already excludes outer's
    // own padding, so its own rendered box directly is the available height.
    const availH = Math.round(inner.getBoundingClientRect().height);
    if (contentH === lastRef.current.c && availH === lastRef.current.a) {
      applyZoom(fitScaleRef.current);
      return;
    }
    lastRef.current = { c: contentH, a: availH };
    let s = 1;
    if (contentH > availH + 2 && availH > 0) {
      // Binary search for the largest zoom that fits, instead of one linear
      // guess (availH / contentH): because zoom reflows, height isn't a
      // linear function of it — text reflowed smaller packs tighter than a
      // pure geometric scale predicts, so a single linear guess systematically
      // under-shrinks and leaves unused space that reads as a margin/gap once
      // a pane holds enough text to need real shrinking. The floor of 0.15
      // (vs the old 0.4, back when this scaled via transform) is safe because
      // zoom reflows properly at any size — small-but-complete text beats
      // clipping the bottom of genuinely excessive content off entirely.
      let lo = 0.15, hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        zoomEl.style.zoom = String(mid);
        if (measureContentH() > availH) hi = mid; else lo = mid;
      }
      s = lo;
    }
    applyZoom(s);
    if (Math.abs(s - fitScaleRef.current) > 0.005) {
      fitScaleRef.current = s;
      setFitScale(s);
    }
  }, [applyZoom]);

  // ResizeObserver fires once on observe() (covers mount), then on real box-size
  // changes: `outer` for available height, `inner` for content growth. The callback
  // is rAF-debounced — deferring the measure out of the observer's synchronous
  // delivery is the standard guard against the "ResizeObserver loop" that otherwise
  // surfaces as React's "Maximum update depth exceeded". Combined with the
  // unchanged-dimensions bail in remeasure, re-entry is impossible.
  useEffect(() => {
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(remeasure);
    });
    if (outerRef.current) ro.observe(outerRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [remeasure]);

  // When the element list changes (new slide, hidden toggle, etc.) the content
  // height may be identical to the previous slide so the ResizeObserver won't
  // fire. Reset the bail-out bookmark and force a remeasure synchronously
  // before paint so the scale is always correct on first frame.
  useLayoutEffect(() => {
    lastRef.current = { c: -1, a: -1 };
    remeasure();
  }, [elements, remeasure]);

  // Report this pane's natural scale up so a parent can compute the shared
  // minScale across sibling panes. useLayoutEffect (not useEffect) so the
  // report — and the resulting minScale prop update below — land before paint.
  useLayoutEffect(() => {
    onNaturalScale?.(fitScale);
  }, [fitScale, onNaturalScale]);

  // Re-apply whenever the externally supplied minScale changes, even though
  // this pane's own dimensions haven't — that's exactly the case where a
  // sibling column grew fuller and forced a deeper shared shrink.
  useLayoutEffect(() => {
    applyZoom(fitScaleRef.current);
  }, [minScale, applyZoom]);

  const appliedScale = minScale !== undefined ? Math.min(fitScale, minScale) : fitScale;

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef} className="sl-pane-inner">
        <div ref={zoomRef} className="sl-pane-zoom">
          <Elements elements={elements} />
        </div>
      </div>
      {appliedScale < 0.99 && !isThumbnail && !hideOverflowBadge && <div className="sl-overflow-badge">{t('preview.rescaledToFit')}</div>}
    </div>
  );
}

// ── Layout dispatcher ─────────────────────────────────────────────────────────

// Each layout must fill its parent (.sl-content-area) which is a flex child
export function SlideLayout({ slide }: { slide: Slide }) {
  switch (slide.layout) {
    case 'title':         return <TitleLayout slide={slide} />;
    case 'section':       return <SectionLayout slide={slide} />;
    case 'title-content': return <TitleContentLayout slide={slide} />;
    case 'title-image':   return <TitleImageLayout slide={slide} />;
    case 'split':         return <SplitLayout slide={slide} />;
    case 'full-bleed':    return <FullBleedLayout slide={slide} />;
    case 'quote':         return <QuoteLayout slide={slide} />;
    case 'two-column':    return <MultiColumnLayout slide={slide} columns={2} />;
    case 'three-column':  return <MultiColumnLayout slide={slide} columns={3} />;
    case 'bsp':           return <BspLayout slide={slide} />;
    case 'grid':          return <GridLayout slide={slide} />;
    case 'media':         return <MediaLayout slide={slide} />;
    case 'code':          return <CodeLayout slide={slide} />;
    case 'math':          return <MathLayout slide={slide} />;
    case 'blank':         return <BlankLayout />;
    default:              return <TitleContentLayout slide={slide} />;
  }
}

// ── Layout components ─────────────────────────────────────────────────────────

function TitleLayout({ slide }: { slide: Slide }) {
  const subtitles = slide.elements.filter((e): e is Extract<SlideElement, { type: 'paragraph' }> => e.type === 'paragraph');
  const rest = slide.elements.filter((e) => e.type !== 'paragraph');
  return (
    <div className="sl-title">
      <div className="sl-title__text">{slide.title}</div>
      {subtitles.length > 0 && (
        <div className="sl-title__subtitles">
          {subtitles.map((el, i) => (
            <StepGate key={i} step={el.step}>
              <p className="sl-title__subtitle" dangerouslySetInnerHTML={{ __html: el.html }} />
            </StepGate>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="sl-title__body">
          <Elements elements={rest} />
        </div>
      )}
    </div>
  );
}

function SectionLayout({ slide }: { slide: Slide }) {
  return (
    <div className="sl-section">
      <div className="sl-section__text">{slide.title}</div>
    </div>
  );
}

function TitleContentLayout({ slide }: { slide: Slide }) {
  return (
    <div className="sl-title-content">
      {slide.title && <div className="sl-heading">{slide.title}</div>}
      <OverflowPane className="sl-body" elements={slide.elements} />
    </div>
  );
}

// Some elements' CSS sizing depends on a percentage resolving against their
// *immediate* parent (height:100%, max-width:90%, etc. against a flex
// container) — StepGate's wrapper div would sit between them and break that
// resolution, since the wrapper itself has no definite size to resolve
// against. This applies the same gating classes/attribute directly onto an
// existing element instead (mirroring ListItemNode in elements.tsx), so
// there's no new box in the sizing chain at all.
function useStepGateClass(step: number | undefined): string | undefined {
  const { revealThreshold, enteringStep } = useContext(SlideCtx);
  return stepGateClassName(step, revealThreshold, enteringStep);
}

function withStepGateClass(base: string, gateClass: string | undefined): string {
  return gateClass ? `${base} ${gateClass}` : base;
}

function TitleImageLayout({ slide }: { slide: Slide }) {
  const img = slide.elements.find((e) => e.type === 'image');
  const gateClass = useStepGateClass(img?.type === 'image' ? img.step : undefined);
  return (
    <div className="sl-title-image">
      <div className="sl-heading">{slide.title}</div>
      <div className="sl-ti-img">
        {img && img.type === 'image' && (
          <div className={withStepGateClass('sl-ti-img__inner', gateClass)} data-step={img.step}>
            <img src={img.src} alt={img.alt} className="sl-img-fill" />
            {img.caption && <div className="sl-caption">{img.caption}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function SplitLayout({ slide }: { slide: Slide }) {
  const imgIdx = slide.elements.findIndex((e) => e.type === 'image');
  const img = imgIdx >= 0 ? slide.elements[imgIdx] : undefined;
  const rest = slide.elements.filter((e) => e.type !== 'image');
  // Put the image on the right when it appears after text in the source.
  const imgOnRight = imgIdx > 0;
  const gateClass = useStepGateClass(img?.type === 'image' ? img.step : undefined);

  const textCol = <OverflowPane className="sl-split__right" elements={rest} />;
  const imgCol = (
    <div className="sl-split__left">
      {img && img.type === 'image' && (
        <div className={withStepGateClass('sl-split__img-inner', gateClass)} data-step={img.step}>
          <img src={img.src} alt={img.alt} className="sl-img-fill" />
          {img.caption && <div className="sl-caption">{img.caption}</div>}
        </div>
      )}
    </div>
  );

  return (
    <div className="sl-split">
      {slide.title && <div className="sl-heading sl-split__title">{slide.title}</div>}
      <div className="sl-split__body">
        {imgOnRight ? <>{textCol}{imgCol}</> : <>{imgCol}{textCol}</>}
      </div>
    </div>
  );
}

function FullBleedLayout({ slide }: { slide: Slide }) {
  const img = slide.elements.find((e) => e.type === 'image');
  const gateClass = useStepGateClass(img?.type === 'image' ? img.step : undefined);
  return (
    <div className="sl-full-bleed">
      {img && img.type === 'image' && (
        <>
          <img src={img.src} alt={img.alt} className={withStepGateClass('sl-img-cover', gateClass)} data-step={img.step} />
          {img.caption && <div className={withStepGateClass('sl-full-bleed__caption', gateClass)} data-step={img.step}>{img.caption}</div>}
        </>
      )}
    </div>
  );
}

function QuoteLayout({ slide }: { slide: Slide }) {
  const bq = slide.elements.find((e) => e.type === 'blockquote');
  // mark/text/attr are direct flex children of .sl-quote (centred, sized to
  // content) — applying the same gate class to all three directly, rather
  // than wrapping them together in one new div, keeps .sl-quote__text's
  // max-width:80% resolving against .sl-quote exactly as before (a wrapper
  // with no definite width of its own would break that).
  const gateClass = useStepGateClass(bq?.type === 'blockquote' ? bq.step : undefined);
  return (
    <div className="sl-quote">
      {bq && bq.type === 'blockquote' && (
        <>
          <div className={withStepGateClass('sl-quote__mark', gateClass)} data-step={bq.step}>"</div>
          {bq.html
            ? <div className={withStepGateClass('sl-quote__text', gateClass)} data-step={bq.step} dangerouslySetInnerHTML={{ __html: bq.html }} />
            : <div className={withStepGateClass('sl-quote__text', gateClass)} data-step={bq.step}>{bq.text}</div>}
          {bq.attribution && (
            <div className={withStepGateClass('sl-quote__attr', gateClass)} data-step={bq.step}>— {bq.attribution}</div>
          )}
        </>
      )}
    </div>
  );
}

function MultiColumnLayout({ slide, columns }: { slide: Slide; columns: 2 | 3 }) {
  const hasBreak = slide.elements.some((e) => e.type === 'column-break');
  const groups = hasBreak
    ? splitByColumnBreaks(slide.elements, columns)
    : [...autoSplitElements(slide.elements), ...Array(columns - 2).fill([])];

  // Shrink all columns in lockstep: without this, a lightly filled column
  // sits at full size (with dead space below it) next to a sibling that had
  // to shrink heavily to fit its share of the content — issue #145.
  const [scales, setScales] = useState<number[]>(() => Array(columns).fill(1));
  const syncedScale = Math.min(...scales);
  // Stable per-index setter identities (memoized on `columns`, fixed for a
  // mounted instance) — OverflowPane's loop-proof effect relies on
  // onNaturalScale having a stable identity across renders.
  const setScaleAt = useMemo(
    () => Array.from({ length: columns }, (_, i) => (s: number) =>
      setScales((prev) => (prev[i] === s ? prev : prev.map((v, j) => (j === i ? s : v)))),
    ),
    [columns],
  );

  return (
    <div className="sl-two-col">
      {slide.title && <div className="sl-heading sl-two-col__title">{slide.title}</div>}
      <div className="sl-two-col__body">
        {groups.map((g, i) => (
          <Fragment key={i}>
            {i > 0 && <div className="sl-two-col__divider" />}
            <OverflowPane className="sl-two-col__col" elements={g} minScale={syncedScale} onNaturalScale={setScaleAt[i]} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function BspLayout({ slide }: { slide: Slide }) {
  const groups = groupProgressRuns(slide.elements);

  // Guard against a layout:bsp override on a slide with fewer than 2 logical groups.
  if (groups.length < 2) return <TitleContentLayout slide={slide} />;

  // For 2 groups: if first is visual and second is text, put text on the left
  const isGroupPureText = (g: SlideElement[]) =>
    g.every((e) => e.type === 'paragraph' || e.type === 'list' || e.type === 'progress');

  let leftGroup: SlideElement[];
  let rightGroups: SlideElement[][];

  if (groups.length === 2) {
    if (!isGroupPureText(groups[0]) && isGroupPureText(groups[1])) {
      leftGroup  = groups[1];
      rightGroups = [groups[0]];
    } else {
      leftGroup  = groups[0];
      rightGroups = [groups[1]];
    }
  } else {
    // 3+ logical groups: first fills left, remaining stack on right
    leftGroup  = groups[0];
    rightGroups = groups.slice(1);
  }

  // Text panes top-align like other text-vs-text layouts (title-content, two-column);
  // non-text panes (image/chart/table), and split's text pane (paired with a visual),
  // stay vertically centered for balance.
  const paneClass = (g: SlideElement[]) => 'sl-bsp__pane' + (isGroupPureText(g) ? ' sl-bsp__pane--text' : '');
  const subpaneClass = (g: SlideElement[]) => 'sl-bsp__subpane' + (isGroupPureText(g) ? ' sl-bsp__pane--text' : '');

  return (
    <div className="sl-bsp">
      {slide.title && <div className="sl-heading sl-bsp__title">{slide.title}</div>}
      <div className="sl-bsp__body">
        <OverflowPane className={paneClass(leftGroup)} elements={leftGroup} />
        <div className="sl-bsp__divider" />
        {rightGroups.length === 1 ? (
          <OverflowPane className={paneClass(rightGroups[0])} elements={rightGroups[0]} />
        ) : (
          <div className="sl-bsp__right">
            {rightGroups.map((g, i) => (
              <OverflowPane key={i} className={subpaneClass(g)} elements={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GridLayout({ slide }: { slide: Slide }) {
  // Filter column-break elements, explode lists into one cell per bullet,
  // then group consecutive progress bars into one cell.
  const filtered = slide.elements.filter((e) => e.type !== 'column-break');
  const groups = groupProgressRuns(explodeListItems(filtered));
  return (
    <div className="sl-grid">
      {slide.title && <div className="sl-heading sl-grid__title">{slide.title}</div>}
      <div className="sl-grid__cells">
        {groups.map((group, i) => (
          <div key={i} className="sl-grid__cell">
            <Elements elements={group} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MediaLayout({ slide }: { slide: Slide }) {
  const yt = slide.elements.find((e) => e.type === 'youtube');
  const vid = slide.elements.find((e) => e.type === 'video');
  const poll = slide.elements.find((e) => e.type === 'poll');
  return (
    <div className="sl-media">
      {slide.title && <div className="sl-heading sl-media__title">{slide.title}</div>}
      <div className="sl-media__body">
        {yt && yt.type === 'youtube' && <YoutubeEmbed embed={yt} />}
        {vid && vid.type === 'video' && <VideoEmbed embed={vid} />}
        {poll && poll.type === 'poll' && <PollEmbed embed={poll} />}
      </div>
    </div>
  );
}

function CodeLayout({ slide }: { slide: Slide }) {
  const codeEls = slide.elements.filter((e) => e.type === 'code' || e.type === 'mermaid');
  // .sl-code__block already exists per-item and carries `flex: 1` against
  // .sl-code's column layout — apply the gate class directly onto it (like
  // the image layouts above) rather than introducing a wrapper, which would
  // stop it being a direct flex child and drop that sizing entirely. Called
  // once here, not per-item inside the map below, since useContext is a hook.
  const { revealThreshold, enteringStep } = useContext(SlideCtx);
  return (
    <div className="sl-code">
      {slide.title && <div className="sl-heading sl-code__title">{slide.title}</div>}
      {codeEls.map((codeEl, i) => (
        <div
          key={i}
          className={withStepGateClass('sl-code__block', stepGateClassName(codeEl.step, revealThreshold, enteringStep))}
          data-step={codeEl.step}
        >
          {codeEl.type === 'code' && (
            <>
              {codeEl.lang && <div className="sl-code__lang">{codeEl.lang}</div>}
              <CodeBlock lang={codeEl.lang} value={codeEl.value} />
            </>
          )}
          {codeEl.type === 'mermaid' && (
            <MermaidDiagram value={codeEl.value} caption={codeEl.caption} />
          )}
        </div>
      ))}
    </div>
  );
}

function MathLayout({ slide }: { slide: Slide }) {
  const mathEls = slide.elements.filter((e): e is Extract<SlideElement, { type: 'math' }> => e.type === 'math');
  return (
    <div className="sl-math-layout">
      {slide.title && <div className="sl-heading sl-math-layout__title">{slide.title}</div>}
      <div className="sl-math-layout__body">
        {mathEls.map((el, i) => (
          <MathBlock key={i} value={el.value} display={el.display} caption={el.caption} step={el.step} />
        ))}
      </div>
    </div>
  );
}

function BlankLayout() {
  return <div className="sl-blank" />;
}
