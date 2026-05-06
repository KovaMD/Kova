import { createContext, useContext, useEffect, useId, useState } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import mermaid from 'mermaid';
import type { Slide, SlideElement, ListItem } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import { themeToVars, resolveTemplate, DEFAULT_THEME } from '../../engine/theme';
import './SlideRenderer.css';

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });

// Passed via context so child components can skip heavy work in thumbnails
const SlideScaleCtx = createContext(1);

interface Props {
  slide: Slide;
  theme?: Theme;
  slideNumber?: number;
  totalSlides?: number;
  docTitle?: string;
  /** Uniform scale applied to the slide frame, used for thumbnail rendering */
  scale?: number;
}

export function SlideRenderer({ slide, theme = DEFAULT_THEME, slideNumber, totalSlides, docTitle = '', scale = 1 }: Props) {
  const vars = themeToVars(theme);

  const headerText = theme.header.show
    ? resolveTemplate(theme.header.text, { title: docTitle, slideNumber, totalSlides })
    : null;

  const footerText = theme.footer.show
    ? resolveTemplate(theme.footer.text, { title: docTitle, slideNumber, totalSlides })
    : null;

  const showFloatingLogo =
    theme.logo &&
    !theme.header.show &&
    !theme.footer.show;

  return (
    <SlideScaleCtx.Provider value={scale}>
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
    </SlideScaleCtx.Provider>
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
    case 'grid':          return <GridLayout slide={slide} />;
    case 'media':         return <MediaLayout slide={slide} />;
    case 'code':          return <CodeLayout slide={slide} />;
    default:              return <TitleContentLayout slide={slide} />;
  }
}

// ── Layout components ─────────────────────────────────────────────────────────

function TitleLayout({ slide }: { slide: Slide }) {
  return (
    <div className="sl-title">
      <div className="sl-title__text">{slide.title}</div>
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
  const img = slide.elements.find((e) => e.type === 'image');
  const rest = slide.elements.filter((e) => e.type !== 'image');
  return (
    <div className="sl-split">
      {slide.title && <div className="sl-heading sl-split__title">{slide.title}</div>}
      <div className="sl-split__body">
        <div className="sl-split__left">
          {img && img.type === 'image' && (
            <img src={img.src} alt={img.alt} className="sl-img-fill" />
          )}
        </div>
        <div className="sl-split__right">
          <Elements elements={rest} />
        </div>
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

function TwoColumnLayout({ slide }: { slide: Slide }) {
  const breakIdx = slide.elements.findIndex((e) => e.type === 'column-break');
  const left = breakIdx >= 0 ? slide.elements.slice(0, breakIdx) : slide.elements;
  const right = breakIdx >= 0 ? slide.elements.slice(breakIdx + 1) : [];
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

function GridLayout({ slide }: { slide: Slide }) {
  return (
    <div className="sl-grid">
      {slide.title && <div className="sl-heading sl-grid__title">{slide.title}</div>}
      <div className="sl-grid__cells">
        {slide.elements.map((el, i) => (
          <div key={i} className="sl-grid__cell">
            <Elements elements={[el]} />
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
  const codeEl = slide.elements.find((e) => e.type === 'code' || e.type === 'mermaid');
  return (
    <div className="sl-code">
      {slide.title && <div className="sl-heading sl-code__title">{slide.title}</div>}
      {codeEl && (
        <div className="sl-code__block">
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
      )}
    </div>
  );
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

    case 'image':
      return <img src={el.src} alt={el.alt} className="sl-img" />;

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

    case 'column-break':
    case 'mermaid':
      return null;

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
  const thumb = youtubeThumb(embed.url);
  return (
    <div className="sl-youtube">
      {thumb
        ? <img src={thumb} alt={embed.label} className="sl-youtube__thumb" />
        : <div className="sl-youtube__placeholder">▶ YouTube</div>
      }
      <div className="sl-youtube__label">{embed.label}</div>
      <div className="sl-youtube__url">{embed.url}</div>
    </div>
  );
}

function PollEmbed({ embed }: { embed: Extract<SlideElement, { type: 'poll' }> }) {
  return (
    <div className="sl-poll">
      <div className="sl-poll__icon">📊</div>
      <div className="sl-poll__label">{embed.label}</div>
      <div className="sl-poll__url">{embed.url}</div>
      <div className="sl-poll__hint">QR code generation — Sprint 5</div>
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
  const highlighted = lang && hljs.getLanguage(lang)
    ? hljs.highlight(value, { language: lang }).value
    : hljs.highlightAuto(value).value;

  return (
    <pre>
      <code
        className={lang ? `language-${lang}` : ''}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}

// ── Mermaid diagram ───────────────────────────────────────────────────────────

function MermaidDiagram({ value }: { value: string }) {
  const scale = useContext(SlideScaleCtx);
  const rawId = useId();
  const id    = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState('');

  useEffect(() => {
    if (scale < 1) return; // skip async render in thumbnails
    let cancelled = false;
    mermaid.render(id, value)
      .then(({ svg: out }) => { if (!cancelled) setSvg(out); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, value, scale]);

  if (scale < 1 || !svg) {
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
