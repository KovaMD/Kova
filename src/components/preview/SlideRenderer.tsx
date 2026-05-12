import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import mermaid from 'mermaid';
import QRCode from 'react-qr-code';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Slide, SlideElement, ListItem } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { themeToVars, resolveTemplate, DEFAULT_THEME } from '../../engine/theme';
import './SlideRenderer.css';

mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'antiscript' });

// Parse an image title like "50%" or "300px" into an inline width style.
// Returning a style disables the default max-height cap on the wrapper.
function parseSizeHint(title?: string): React.CSSProperties | null {
  if (!title) return null;
  const t = title.trim();
  if (/^\d+(\.\d+)?(px|%|em|rem|cqi|vw)$/.test(t)) return { width: t, height: 'auto' };
  return null;
}

// Context passed to child components so they can adapt for thumbnail vs full rendering
interface SlideCtxValue { isThumbnail: boolean; textColor: string; mermaidInit: string }
const SlideCtx = createContext<SlideCtxValue>({ isThumbnail: false, textColor: '#1a1a1a', mermaidInit: '' });

// ── Pie-chart palette ─────────────────────────────────────────────────────────
// Derives 12 perceptually distinct colours by rotating 30° around the hue
// wheel from the primary colour, so any theme always has enough unique slices.

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

// Derives 12 colours for Mermaid's cScale system (used by timeline, mindmap, etc.).
// Anchored to the accent, hue-rotated 30° per step, saturation/lightness clamped
// so sections stay vivid on both light and dark slide backgrounds.
function buildCScalePalette(accentHex: string): Record<string, string> {
  const [h, rawS, rawL] = hexToHsl(accentHex);
  const s = Math.min(Math.max(rawS, 0.50), 0.80);
  const l = Math.min(Math.max(rawL, 0.38), 0.58);
  const out: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    out[`cScale${i}`] = hslToHex(h + i * 30, s, l);
  }
  return out;
}

function piePalette(primaryHex: string): Record<string, string> {
  const [h, rawS, rawL] = hexToHsl(primaryHex);
  // Clamp S and L so all slices are vivid enough to read on a white slide
  const s = Math.min(Math.max(rawS, 0.55), 0.85);
  const l = Math.min(Math.max(rawL, 0.28), 0.48);
  const out: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    out[`pie${i + 1}`] = hslToHex(h + i * 30, s, l);
  }
  return out;
}

// Derives 8 perceptually distinct colours for xychart bars/lines.
// Anchored to the theme accent so bars are always legible against the slide background.
function buildChartPalette(accentHex: string): string {
  const [h, rawS, rawL] = hexToHsl(accentHex);
  const s = Math.min(Math.max(rawS, 0.60), 0.88);
  // Keep L in the mid-range so bars show on both light and dark backgrounds.
  const l = Math.min(Math.max(rawL, 0.38), 0.58);
  return Array.from({ length: 8 }, (_, i) => hslToHex(h + i * 45, s, l)).join(',');
}

function buildMermaidInit(theme: Theme): string {
  const c = theme.colors;
  const firstFont = (stack: string) => stack.split(',')[0].trim().replace(/['"]/g, '');
  const vars = {
    primaryColor:          c.primary,
    primaryTextColor:      c.title_text,
    primaryBorderColor:    c.primary,
    lineColor:             c.accent,
    secondaryColor:        c.section_bg,
    tertiaryColor:         c.code_bg,
    background:            c.background,
    mainBkg:               c.primary,
    nodeBorder:            c.primary,
    clusterBkg:            c.code_bg,
    titleColor:            c.text,
    edgeLabelBackground:   c.background,
    fontFamily:            firstFont(theme.fonts.body),
    ...buildCScalePalette(c.accent),
    ...piePalette(c.accent),
    pieTitleTextColor:     c.text,
    pieSectionTextColor:   c.background,
    pieLegendTextColor:    c.text,
    pieStrokeColor:        c.background,
    pieStrokeWidth:        '2px',
    pieOpacity:            '0.9',
    // xychart reads colours from themeVariables.xyChart, not a top-level xyChart key
    xyChart: {
      plotColorPalette:  buildChartPalette(c.accent),
      titleColor:        c.text,
      dataLabelColor:    c.text,
      xAxisTitleColor:   c.text,
      xAxisLabelColor:   c.text,
      xAxisTickColor:    c.text,
      xAxisLineColor:    c.text,
      yAxisTitleColor:   c.text,
      yAxisLabelColor:   c.text,
      yAxisTickColor:    c.text,
      yAxisLineColor:    c.text,
    },
  };
  return `%%{init: ${JSON.stringify({ theme: 'base', themeVariables: vars })}}%%\n`;
}

interface Props {
  slide: Slide;
  theme?: Theme;
  slideNumber?: number;
  totalSlides?: number;
  docTitle?: string;
  scale?: number;
  isThumbnail?: boolean;
}

export function SlideRenderer({ slide, theme = DEFAULT_THEME, slideNumber, totalSlides, docTitle = '', scale = 1, isThumbnail: isThumbnailProp }: Props) {
  const vars = themeToVars(theme);

  const headerText = theme.header.show
    ? resolveTemplate(theme.header.text, { title: docTitle, slideNumber, totalSlides })
    : null;

  const footerText = theme.footer.show
    ? resolveTemplate(theme.footer.text, { title: docTitle, slideNumber, totalSlides })
    : null;

  // Show the floating logo whenever its position doesn't match a visible bar —
  // e.g. logo_position='bottom-right' with only header.show=true still floats.
  const logoInHeader = theme.header.show && theme.logo && ['top-left', 'top-right'].includes(theme.logo_position);
  const logoInFooter = theme.footer.show && theme.logo && ['bottom-left', 'bottom-right'].includes(theme.logo_position);
  const showFloatingLogo = theme.logo && !logoInHeader && !logoInFooter;

  const ctxValue = useMemo<SlideCtxValue>(
    () => ({ isThumbnail: isThumbnailProp ?? scale !== 1, textColor: theme.colors.text, mermaidInit: buildMermaidInit(theme) }),
    [isThumbnailProp, scale, theme],
  );

  return (
    <SlideCtx.Provider value={ctxValue}>
    <div
      className={`slide-frame layout-${slide.layout}`}
      style={{ ...vars, ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: 'top left' } : {}) }}
      data-layout={slide.layout}
    >
      {/* Header bar */}
      {theme.header.show && (
        <div className="sl-header-bar">
          {theme.logo && ['top-left', 'top-right'].includes(theme.logo_position) && (
            <img src={theme.logo} alt="Logo" className="sl-logo"
              style={theme.logo_position === 'top-right' ? { marginLeft: 'auto' } : undefined} />
          )}
          {headerText && <span className="sl-header-text">{headerText}</span>}
        </div>
      )}

      {/* Floating logo (when no header/footer) */}
      {showFloatingLogo && (
        <img
          src={theme.logo}
          alt="Logo"
          className={`sl-logo-float pos-${theme.logo_position}`}
        />
      )}

      {/* Main content area */}
      <div className="sl-content-area">
        <SlideLayout slide={slide} />
      </div>

      {/* Footer bar */}
      {theme.footer.show && (
        <div className="sl-footer-bar">
          {theme.logo && ['bottom-left', 'bottom-right'].includes(theme.logo_position) && (
            <img src={theme.logo} alt="Logo" className="sl-logo-footer"
              style={theme.logo_position === 'bottom-right' ? { marginLeft: 'auto', order: 2 } : undefined} />
          )}
          {footerText && <span className="sl-footer-text">{footerText}</span>}
          {theme.footer.show_slide_number && slideNumber !== undefined && (
            <span className="sl-slide-num">{slideNumber}{totalSlides ? ` / ${totalSlides}` : ''}</span>
          )}
        </div>
      )}
    </div>
    </SlideCtx.Provider>
  );
}

// ── Layout dispatcher ─────────────────────────────────────────────────────────

// Each layout must fill its parent (.sl-content-area) which is a flex child
function SlideLayout({ slide }: { slide: Slide }) {
  switch (slide.layout) {
    case 'title':         return <TitleLayout slide={slide} />;
    case 'section':       return <SectionLayout slide={slide} />;
    case 'title-content': return <TitleContentLayout slide={slide} />;
    case 'title-image':   return <TitleImageLayout slide={slide} />;
    case 'split':         return <SplitLayout slide={slide} />;
    case 'full-bleed':    return <FullBleedLayout slide={slide} />;
    case 'quote':         return <QuoteLayout slide={slide} />;
    case 'two-column':    return <TwoColumnLayout slide={slide} />;
    case 'bsp':           return <BspLayout slide={slide} />;
    case 'grid':          return <GridLayout slide={slide} />;
    case 'media':         return <MediaLayout slide={slide} />;
    case 'code':          return <CodeLayout slide={slide} />;
    default:              return <TitleContentLayout slide={slide} />;
  }
}

// ── Layout components ─────────────────────────────────────────────────────────

function TitleLayout({ slide }: { slide: Slide }) {
  const subtitles = slide.elements.filter((e): e is Extract<SlideElement, { type: 'paragraph' }> => e.type === 'paragraph');
  return (
    <div className="sl-title">
      <div className="sl-title__text">{slide.title}</div>
      {subtitles.length > 0 && (
        <div className="sl-title__subtitles">
          {subtitles.map((el, i) => (
            <p key={i} className="sl-title__subtitle" dangerouslySetInnerHTML={{ __html: el.html }} />
          ))}
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
      <div className="sl-body">
        <Elements elements={slide.elements} />
      </div>
    </div>
  );
}

function TitleImageLayout({ slide }: { slide: Slide }) {
  const img = slide.elements.find((e) => e.type === 'image');
  return (
    <div className="sl-title-image">
      <div className="sl-ti-text">
        <div className="sl-heading">{slide.title}</div>
      </div>
      <div className="sl-ti-img">
        {img && img.type === 'image' && (
          <img src={img.src} alt={img.alt} className="sl-img-fill" />
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

  const textCol = (
    <div className="sl-split__right">
      <Elements elements={rest} />
    </div>
  );
  const imgCol = (
    <div className="sl-split__left">
      {img && img.type === 'image' && (
        <img src={img.src} alt={img.alt} className="sl-img-fill" />
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
  return (
    <div className="sl-full-bleed">
      {img && img.type === 'image' && (
        <img src={img.src} alt={img.alt} className="sl-img-cover" />
      )}
    </div>
  );
}

function QuoteLayout({ slide }: { slide: Slide }) {
  const bq = slide.elements.find((e) => e.type === 'blockquote');
  return (
    <div className="sl-quote">
      {bq && bq.type === 'blockquote' && (
        <>
          <div className="sl-quote__mark">"</div>
          <div className="sl-quote__text">{bq.text}</div>
          {bq.attribution && (
            <div className="sl-quote__attr">— {bq.attribution}</div>
          )}
        </>
      )}
    </div>
  );
}

function autoSplitElements(elements: SlideElement[]): [SlideElement[], SlideElement[]] {
  // Single list: split its items evenly between the two columns
  if (elements.length === 1 && elements[0].type === 'list') {
    const list = elements[0];
    const mid = Math.ceil(list.items.length / 2);
    return [
      [{ ...list, items: list.items.slice(0, mid) }],
      [{ ...list, items: list.items.slice(mid) }],
    ];
  }
  // Multiple elements: split at midpoint
  const mid = Math.ceil(elements.length / 2);
  return [elements.slice(0, mid), elements.slice(mid)];
}

function TwoColumnLayout({ slide }: { slide: Slide }) {
  const breakIdx = slide.elements.findIndex((e) => e.type === 'column-break');

  let left: SlideElement[];
  let right: SlideElement[];

  if (breakIdx >= 0) {
    left  = slide.elements.slice(0, breakIdx);
    right = slide.elements.slice(breakIdx + 1);
  } else {
    [left, right] = autoSplitElements(slide.elements);
  }

  return (
    <div className="sl-two-col">
      {slide.title && <div className="sl-heading sl-two-col__title">{slide.title}</div>}
      <div className="sl-two-col__body">
        <div className="sl-two-col__col">
          <Elements elements={left} />
        </div>
        <div className="sl-two-col__divider" />
        <div className="sl-two-col__col">
          <Elements elements={right} />
        </div>
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

  return (
    <div className="sl-bsp">
      {slide.title && <div className="sl-heading sl-bsp__title">{slide.title}</div>}
      <div className="sl-bsp__body">
        <div className="sl-bsp__pane">
          <Elements elements={leftGroup} />
        </div>
        {rightGroups.length === 1 ? (
          <div className="sl-bsp__pane">
            <Elements elements={rightGroups[0]} />
          </div>
        ) : (
          <div className="sl-bsp__right">
            {rightGroups.slice(0, 2).map((g, i) => (
              <div key={i} className="sl-bsp__subpane">
                <Elements elements={g} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GridLayout({ slide }: { slide: Slide }) {
  // Filter column-break elements, then group consecutive progress bars into one cell.
  const filtered = slide.elements.filter((e) => e.type !== 'column-break');
  const groups = groupProgressRuns(filtered);
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
  const poll = slide.elements.find((e) => e.type === 'poll');
  return (
    <div className="sl-media">
      {slide.title && <div className="sl-heading sl-media__title">{slide.title}</div>}
      <div className="sl-media__body">
        {yt && yt.type === 'youtube' && <YoutubeEmbed embed={yt} />}
        {poll && poll.type === 'poll' && <PollEmbed embed={poll} />}
      </div>
    </div>
  );
}

function CodeLayout({ slide }: { slide: Slide }) {
  const codeEls = slide.elements.filter((e) => e.type === 'code' || e.type === 'mermaid');
  return (
    <div className="sl-code">
      {slide.title && <div className="sl-heading sl-code__title">{slide.title}</div>}
      {codeEls.map((codeEl, i) => (
        <div key={i} className="sl-code__block">
          {codeEl.type === 'code' && (
            <>
              {codeEl.lang && <div className="sl-code__lang">{codeEl.lang}</div>}
              <CodeBlock lang={codeEl.lang} value={codeEl.value} />
            </>
          )}
          {codeEl.type === 'mermaid' && (
            <MermaidDiagram value={codeEl.value} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Progress grouping helper ──────────────────────────────────────────────────

/**
 * Collapses consecutive `progress` elements into sub-arrays so that bsp/grid
 * renderers can place them all in a single pane/cell.
 */
function groupProgressRuns(elements: SlideElement[]): SlideElement[][] {
  const groups: SlideElement[][] = [];
  for (const el of elements) {
    const last = groups[groups.length - 1];
    if (el.type === 'progress' && last && last[0]?.type === 'progress') {
      last.push(el);
    } else {
      groups.push([el]);
    }
  }
  return groups;
}

// ── Element renderer ──────────────────────────────────────────────────────────

function Elements({ elements }: { elements: SlideElement[] }) {
  return (
    <>
      {elements.map((el, i) => <ElementNode key={i} el={el} />)}
    </>
  );
}

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
        <div className={`sl-img-wrap${size ? ' sl-img-wrap--user' : ''}`}>
          <img src={el.src} alt={el.alt} className="sl-img" style={size ?? undefined} />
        </div>
      );
    }

    case 'blockquote':
      return (
        <blockquote className="sl-blockquote">
          <p>{el.text}</p>
          {el.attribution && <cite>— {el.attribution}</cite>}
        </blockquote>
      );

    case 'table':
      return (
        <table className="sl-table">
          <thead>
            <tr>{el.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {el.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
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

    case 'poll':
      return <PollEmbed embed={el} />;

    case 'progress':
      return <ProgressBar el={el} />;

    case 'column-break':
      return null;

    case 'mermaid':
      return <MermaidDiagram value={el.value} />;

    default:
      return null;
  }
}

function ListItemNode({ item }: { item: ListItem }) {
  return (
    <li>
      <span dangerouslySetInnerHTML={{ __html: item.html }} />
      {item.children.length > 0 && (
        <ul className="sl-list sl-list--nested">
          {item.children.map((child, i) => <ListItemNode key={i} item={child} />)}
        </ul>
      )}
    </li>
  );
}

// ── Media embeds ──────────────────────────────────────────────────────────────

function YoutubeEmbed({ embed }: { embed: Extract<SlideElement, { type: 'youtube' }> }) {
  const { isThumbnail } = useContext(SlideCtx);
  const thumb = youtubeThumb(embed.url);

  const handleClick = (e: React.MouseEvent) => {
    if (isThumbnail) return;
    e.stopPropagation(); // prevent click bubbling to PresentationOverlay navigation handler
    openUrl(embed.url).catch(() => {});
  };

  return (
    <div
      className={`sl-youtube${!isThumbnail ? ' sl-youtube--clickable' : ''}`}
      onClick={handleClick}
      title={!isThumbnail ? `Open in browser: ${embed.url}` : undefined}
    >
      {thumb
        ? <img src={thumb} alt={embed.label} className="sl-youtube__thumb" />
        : <div className="sl-youtube__placeholder">▶ YouTube</div>
      }
      <div className="sl-youtube__label">{embed.label}</div>
      {!isThumbnail && <div className="sl-youtube__open-hint">Click to open in browser</div>}
    </div>
  );
}

function PollEmbed({ embed }: { embed: Extract<SlideElement, { type: 'poll' }> }) {
  const { isThumbnail, textColor } = useContext(SlideCtx);

  if (isThumbnail) {
    return (
      <div className="sl-poll">
        <div className="sl-poll__icon">📊</div>
        <div className="sl-poll__label">{embed.label}</div>
      </div>
    );
  }

  return (
    <div className="sl-poll">
      <div className="sl-poll__qr">
        <QRCode value={embed.url} size={160} bgColor="transparent" fgColor={textColor} />
      </div>
      <div className="sl-poll__label">{embed.label}</div>
      <div className="sl-poll__url">{embed.url}</div>
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

function CodeBlock({ lang, value }: { lang: string; value: string }) {
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

// ── Mermaid diagram ───────────────────────────────────────────────────────────

function MermaidDiagram({ value }: { value: string }) {
  const { mermaidInit } = useContext(SlideCtx);
  const rawId  = useId();
  const baseId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  // mermaid.render rejects a second call with the same id because it tries to
  // reuse a DOM node from the previous render. A counter forces a fresh id.
  const counter = useRef(0);
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const src = value.trimStart().startsWith('%%{') ? value : mermaidInit + value;
    const renderId = `${baseId}-${++counter.current}`;
    mermaid.render(renderId, src)
      .then(({ svg: out }: { svg: string }) => {
        if (!cancelled) {
          // Mermaid injects style="max-width: Npx;" on the SVG element which
          // caps the rendered size regardless of CSS. Strip it and set
          // width="100%" so the diagram fills its container.
          // Mermaid produces two SVG modes depending on diagram type:
          //   useMaxWidth=true  (most diagrams): width="100%", style="max-width:Npx;", no height attr
          //   useMaxWidth=false (timeline, etc.): width="Npx", height="Npx", no style attr
          // Normalise both to width/height="100%" + preserveAspectRatio so the
          // diagram scales to fill its container like object-fit:contain.
          const scaled = out
            .replace(/\bwidth="[^"]*"/, 'width="100%"')
            .replace(/\bheight="[^"]*"/, 'height="100%"')
            .replace(/style="[^"]*max-width[^"]*"/, 'style=""')
            .replace(/<svg (?![^>]*preserveAspectRatio)/, '<svg preserveAspectRatio="xMidYMid meet" ');
          setSvg(scaled);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [baseId, value, mermaidInit]);

  if (!svg) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', fontSize: 'clamp(7px, 1.5cqi, 12px)',
        color: 'var(--sl-accent)', opacity: 0.7,
      }}>
        ◇ Diagram
      </div>
    );
  }

  return (
    <div
      className="sl-mermaid"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
