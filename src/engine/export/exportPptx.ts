import JSZip from 'jszip';
import { invoke } from '@tauri-apps/api/core';
import { mermaidSvgCache } from './mermaidSvgCache';
import { svgToPngDataUrl } from './svgToPng';
import { queuedMermaidRender } from './mermaidRenderQueue';
import { buildMermaidRenderSource } from './mermaidSource';
import { imageMime } from './imageMime';
import { buildExportMermaidInit, parseChannels } from './mermaidExportTheme';
import { autoSplitElements, groupProgressRuns, splitByColumnBreaks } from '../layout/elementGrouping';
import mermaid from 'mermaid';
import katex from 'katex';
import { toPng } from 'html-to-image';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js';
import type { Slide, SlideElement, Frontmatter } from '../types';
import type { Theme } from '../theme';
import { resolveTemplate } from '../theme';
import { formatFallbackDate } from '../../i18n';

mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'antiscript' });

async function mermaidToDataUrl(value: string, t: Theme): Promise<{ dataUrl: string; aspectRatio: number } | null> {
  // Prefer the SVG already rendered by the live preview — calling mermaid.render()
  // concurrently hangs when the same diagram is already present in the live-preview DOM.
  const cached = mermaidSvgCache.get(value);
  if (cached) {
    try {
      return await svgToPngDataUrl(cached, t.colors.background);
    } catch {
      return null;
    }
  }

  // Cache miss (slide not yet visible in preview): fall back to direct render,
  // serialized via queuedMermaidRender against every other render() call in
  // the app (not just other calls within this export) — see mermaidRenderQueue.ts.
  const init = buildExportMermaidInit(t);
  const id = `pptx-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const src = buildMermaidRenderSource(value, init);
    const { svg } = await queuedMermaidRender(id, src);
    return await svgToPngDataUrl(svg, t.colors.background);
  } catch {
    return null;
  }
}

/** Render display math (`$$…$$`) to a PNG data URL for PPTX (issue #196). */
async function mathToDataUrl(
  value: string,
  bgColor: string,
): Promise<{ dataUrl: string; aspectRatio: number } | null> {
  let html: string;
  try {
    html = katex.renderToString(value, { displayMode: true, throwOnError: false });
  } catch {
    return null;
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed',
    'left:-99999px',
    'top:0',
    'padding:24px',
    `background:${bgColor}`,
    'display:inline-block',
    'font-size:28px',
    'line-height:1.4',
    'color:#111',
  ].join(';');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  try {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const dataUrl = await toPng(wrap, {
      backgroundColor: bgColor,
      pixelRatio: 2,
      cacheBust: true,
    });
    const w = Math.max(wrap.offsetWidth, 1);
    const h = Math.max(wrap.offsetHeight, 1);
    return { dataUrl, aspectRatio: w / h };
  } catch {
    return null;
  } finally {
    wrap.remove();
  }
}

const W = 10; // slide width is always 10" regardless of ratio
const M = 0.5;     // standard margin
const HEAD_H = 0.4;
const FOOT_H = 0.35;

interface Meta { docTitle: string; docAuthor: string; docDate: string; slideNum: number; totalSlides: number }
interface Area { x: number; y: number; w: number; h: number }

// ── Entry point ───────────────────────────────────────────────────────────────

export interface ExportResult { base64: string; warnings: string[] }

async function assetUrlToDataUrl(src: string): Promise<string> {
  try {
    // asset:// URLs are user files served via Tauri's asset protocol.
    // fetch() on macOS WKWebView cannot reach asset:// because connect-src
    // does not include asset:. Read the file natively instead.
    if (src.startsWith('asset://')) {
      const path = decodeURIComponent(src.replace(/^asset:\/\/[^/]*/, ''));
      const ext  = path.split('.').pop()?.toLowerCase() ?? 'png';
      const b64  = await invoke<string>('read_file_b64', { path });
      return `data:${imageMime(ext)};base64,${b64}`;
    }
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

function getImageAspectRatio(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : null,
    );
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Remote https:// images can't be fetched by PptxGenJS in WKWebView because
// connect-src only allows specific domains. Fetch them natively via Tauri so
// pres.write() always receives data: URLs and never needs to make network calls.
async function fetchUrlToDataUrl(url: string): Promise<string> {
  try {
    const [b64, mime] = await invoke<[string, string]>('fetch_url_b64', { url });
    return `data:${mime};base64,${b64}`;
  } catch {
    return url;
  }
}

async function resolveImageSrcForExport(src: string): Promise<string> {
  if (src.startsWith('asset://') || src.startsWith('tauri://')) return assetUrlToDataUrl(src);
  if (src.startsWith('http://') || src.startsWith('https://')) return fetchUrlToDataUrl(src);
  return src;
}

// Mermaid uses global DOM state and cannot handle concurrent render() calls —
// running slides in parallel causes the second Mermaid render to hang forever.
// Process everything sequentially so Mermaid renders one at a time.
async function resolveSlideImages(slides: Slide[], theme: Theme, warnings: string[]): Promise<Slide[]> {
  const resolved: Slide[] = [];
  for (const slide of slides) {
    const elements: SlideElement[] = [];
    for (const el of slide.elements) {
      if (el.type === 'image') {
        const src = (el.src.startsWith('asset://') || el.src.startsWith('tauri://'))
          ? await assetUrlToDataUrl(el.src)
          : (el.src.startsWith('http://') || el.src.startsWith('https://'))
          ? await fetchUrlToDataUrl(el.src)
          : el.src;
        const ar = src.startsWith('data:') ? await getImageAspectRatio(src) : null;
        elements.push({ ...el, src, title: ar != null ? String(ar) : el.title });
      } else if (el.type === 'mermaid') {
        const result = await mermaidToDataUrl(el.value, theme);
        if (result) {
          elements.push({ type: 'image' as const, src: result.dataUrl, alt: 'Diagram', title: String(result.aspectRatio), caption: el.caption });
        } else {
          warnings.push(`Mermaid diagram could not be rendered and was skipped (slide: "${slide.title ?? 'untitled'}")`);
          elements.push(el);
        }
      } else if (el.type === 'math' && el.display) {
        const result = await mathToDataUrl(el.value, theme.colors.background);
        if (result) {
          elements.push({
            type: 'image' as const,
            src: result.dataUrl,
            alt: 'Formula',
            title: String(result.aspectRatio),
            caption: el.caption,
          });
        } else {
          warnings.push(`Display math could not be rendered and was skipped (slide: "${slide.title ?? 'untitled'}")`);
          elements.push(el);
        }
      } else {
        elements.push(el);
      }
    }
    let backgroundImage = slide.backgroundImage;
    if (backgroundImage) {
      const src = await resolveImageSrcForExport(backgroundImage.src);
      let aspectRatio: number | undefined;
      if (backgroundImage.size === 'contain' && src.startsWith('data:')) {
        const ar = await getImageAspectRatio(src);
        if (ar != null && isFinite(ar)) aspectRatio = ar;
      }
      backgroundImage = { ...backgroundImage, src, aspectRatio };
    }
    resolved.push({ ...slide, elements, backgroundImage });
  }
  return resolved;
}

export async function exportToPptx(
  slides: Slide[],
  frontmatter: Frontmatter,
  theme: Theme,
  locale: string,
): Promise<ExportResult> {
  // Lazy-loaded: pptxgenjs is only needed once a PPTX export is actually
  // triggered, and shouldn't add weight to the app's initial bundle.
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  const is4x3 = (frontmatter.aspect_ratio as string | undefined) === '4:3';
  // LAYOUT_16x9 = 10" × 5.625", which matches W=10 and H=5.625 below.
  // LAYOUT_WIDE is 13.33" × 7.5" — using that with W=10 would misplace everything.
  pres.layout = is4x3 ? 'LAYOUT_4x3' : 'LAYOUT_16x9';
  const H = is4x3 ? 7.5 : 5.625;

  // Falls back to the deck's cover slide (first H1) when frontmatter has no
  // explicit `title:` — mirrors the same fallback used for the live preview
  // (see docTitle in App.tsx), so exported footers/headers match what's shown.
  const docTitle = frontmatter.title ?? slides.find((s) => s.titleLevel === 1)?.title ?? '';
  const docAuthor = frontmatter.author ?? '';
  const docDate  = frontmatter.date != null ? String(frontmatter.date) : formatFallbackDate(locale);
  const warnings: string[] = [];

  // Pre-resolve theme logo once (fetch → data URL, measure AR) so it can be
  // stamped on every slide without repeated network requests.
  let logoDataUrl: string | null = null;
  let logoAr: number | null = null;
  if (theme.logo) {
    try {
      const resolved = await assetUrlToDataUrl(theme.logo);
      if (resolved.startsWith('data:')) {
        logoDataUrl = resolved;
        logoAr = await getImageAspectRatio(resolved);
      }
    } catch { /* logo unavailable — skip silently */ }
  }

  const resolvedSlides = await resolveSlideImages(slides, theme, warnings);

  for (let i = 0; i < resolvedSlides.length; i++) {
    const pSlide = pres.addSlide();
    const meta: Meta = { docTitle, docAuthor, docDate, slideNum: i + 1, totalSlides: slides.length };
    addSlide(pSlide as PS, resolvedSlides[i], theme, meta, H, warnings, logoDataUrl, logoAr);
  }

  const rawBase64 = (await pres.write({ outputType: 'base64' })) as string;
  const base64 = await applyFadeTransitions(rawBase64, resolvedSlides.length);
  return { base64, warnings };
}

// PptxGenJS has no API for slide transitions, so the fade used between slides in
// presentation mode (PresentationOverlay.tsx) is applied by patching the generated
// OOXML directly — "Fade Through Black" is the closest built-in PowerPoint transition
// to that black fade-overlay effect.
const TRANSITION_XML =
  '<p:transition spd="fast" p14:dur="300" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">' +
  '<p:fade thruBlk="1"/>' +
  '</p:transition>';

async function applyFadeTransitions(base64: string, slideCount: number): Promise<string> {
  const zip = await JSZip.loadAsync(base64, { base64: true });
  for (let i = 1; i <= slideCount; i++) {
    const path = `ppt/slides/slide${i}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async('string');
    if (xml.includes('<p:transition')) continue;
    zip.file(path, xml.replace('</p:sld>', `${TRANSITION_XML}</p:sld>`));
  }
  return zip.generateAsync({ type: 'base64' });
}

// ── Per-slide dispatcher ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PS = any;

function addSlide(
  s: PS, slide: Slide, t: Theme, meta: Meta, H: number, warnings: string[],
  logoDataUrl: string | null, logoAr: number | null,
) {
  const hasHead = t.header.show;
  const hasFoot = t.footer.show;
  const cy = M + (hasHead ? HEAD_H : 0);
  const ch = H - M - cy - (hasFoot ? FOOT_H : 0);

  // Bar-left accent stripe: drawn first so it sits behind all content.
  if (t.layout.decoration === 'bar-left') {
    s.addShape('rect', {
      x: 0, y: 0, w: 0.07, h: H,
      fill: { color: hex(t.colors.accent) },
      line: { type: 'none' },
    });
  }

  // Per-slide text colour may be a named colour (`white`, Marp `_color: white`)
  // or a functional notation (`rgb(...)`). PptxGenJS only accepts 6-digit hex,
  // so convert any CSS colour to hex before it reaches the layout renderers —
  // otherwise pptxgenjs silently falls back to black (DEF_FONT_COLOR).
  const slideTextColor = cssColorToHex(
    slide.textColor
      ?? (slide.invert ? t.colors.title_text : t.colors.text),
  );
  const slideCodeBg = slide.invert && !slide.textColor ? '#0D1117' : undefined;

  // A per-slide override (explicit colour or invert) wins for heading/bold
  // too, mirroring the live preview's `themeToVars` precedence; otherwise
  // each falls back to its own theme colour, then the deck's text colour.
  const slideHeadingColor = cssColorToHex(
    slide.textColor
      ?? (slide.invert ? t.colors.title_text : (t.colors.heading ?? t.colors.text)),
  );
  const slideBoldColor = cssColorToHex(
    slide.textColor
      ?? (slide.invert ? t.colors.title_text : (t.colors.bold ?? t.colors.text)),
  );

  if (slide.backgroundImage) {
    const ar = slide.backgroundImage.size === 'contain' ? slide.backgroundImage.aspectRatio : undefined;
    tryAddImage(s, slide.backgroundImage.src, { x: 0, y: 0, w: W, h: H }, warnings, ar);
  }

  switch (slide.layout) {
    case 'title':         addTitleSlide(s, slide, t, cy, ch); break;
    case 'section':       addSectionSlide(s, slide, t, cy, ch); break;
    case 'title-content': addTitleContentSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideCodeBg, slideHeadingColor, slideBoldColor); break;
    case 'title-image':   addTitleImageSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideHeadingColor); break;
    case 'split':         addSplitSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideHeadingColor, slideBoldColor); break;
    case 'full-bleed':    addFullBleedSlide(s, slide, t, H, warnings); break;
    case 'quote':         addQuoteSlide(s, slide, t, cy, ch, slideTextColor); break;
    case 'two-column':    addMultiColumnSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideHeadingColor, slideBoldColor, 2); break;
    case 'three-column':  addMultiColumnSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideHeadingColor, slideBoldColor, 3); break;
    case 'bsp':           addBspSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideHeadingColor, slideBoldColor); break;
    case 'grid':          addGridSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideHeadingColor, slideBoldColor); break;
    case 'media':         addMediaSlide(s, slide, t, cy, ch, slideTextColor, slideHeadingColor); break;
    case 'code':          addCodeSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideCodeBg, slideHeadingColor); break;
    case 'math':          addTitleContentSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideCodeBg, slideHeadingColor, slideBoldColor); break;
    case 'blank':         addBlankSlide(s, t); break;
    default:              addTitleContentSlide(s, slide, t, cy, ch, warnings, slideTextColor, slideCodeBg, slideHeadingColor, slideBoldColor);
  }

  if (hasHead) addHeaderBar(s, t, meta);
  if (hasFoot) addFooterBar(s, t, meta, H);
  if (logoDataUrl) addLogo(s, logoDataUrl, logoAr, t.logo_position, t.logo_opacity, H);
  if (slide.references.length > 0) addReferences(s, slide.references, t, H, hasFoot, slideTextColor);
  if (slide.speakerNotes) s.addNotes(slide.speakerNotes);
}

// ── Layout renderers ──────────────────────────────────────────────────────────

// Map theme title_align → PptxGenJS horizontal text align
function titleHAlign(a: Theme['layout']['title_align']): 'left' | 'center' {
  return a === 'center' ? 'center' : 'left';
}
// Map theme title_align → PptxGenJS vertical align for the title block
function titleVAlign(a: Theme['layout']['title_align'], hasSubs: boolean): 'top' | 'middle' | 'bottom' {
  if (hasSubs) return 'bottom';
  return a === 'bottom-left' ? 'bottom' : 'middle';
}

function addTitleSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number) {
  s.background = { fill: hex(t.colors.primary) };
  const subtitles = slide.elements.filter((e) => e.type === 'paragraph') as Extract<SlideElement, { type: 'paragraph' }>[];
  const hasSubs   = subtitles.length > 0;
  const titleH    = hasSubs ? ch * 0.55 : ch;
  const hAlign    = titleHAlign(t.layout.title_align);

  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: titleH,
      fontSize: 40, bold: true,
      color: hex(t.colors.title_text),
      fontFace: firstFont(t.fonts.title),
      align: hAlign, valign: titleVAlign(t.layout.title_align, hasSubs), wrap: true, shrinkText: true,
    });
  }

  if (hasSubs) {
    const runs = subtitles.map((el) => ({
      text: el.text,
      options: { fontSize: 20, breakLine: true },
    }));
    s.addText(runs, {
      x: M, y: cy + titleH + 0.15, w: W - M * 2, h: ch - titleH - 0.15,
      color: hex(t.colors.title_text),
      fontFace: firstFont(t.fonts.body),
      align: hAlign, valign: 'top', wrap: true, shrinkText: true,
    });
  }
}

function addSectionSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number) {
  s.background = { fill: hex(t.colors.section_bg) };
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: ch,
      fontSize: 32, bold: true,
      color: hex(t.colors.title_text),
      fontFace: firstFont(t.fonts.title),
      align: titleHAlign(t.layout.title_align),
      valign: t.layout.title_align === 'bottom-left' ? 'bottom' : 'middle',
      wrap: true, shrinkText: true,
    });
  }
}

function addTitleContentSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[], tc: string = hex(t.colors.text), codeBg?: string, hc: string = tc, boldColor: string = tc) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.85 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 28, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, valign: 'middle', wrap: true, shrinkText: true,
    });
  }
  addElements(s, slide.elements, t, { x: M, y: cy + hh + 0.1, w: W - M * 2, h: ch - hh - 0.1 }, warnings, tc, codeBg, boldColor);
}

function addTitleImageSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[], tc: string = hex(t.colors.text), hc: string = tc) {
  s.background = { fill: hex(t.colors.background) };
  // 3% gap mirrors .sl-split__body { gap: 3% } in CSS
  const GAP  = 0.3;
  const colW = (W - M * 2 - GAP) / 2;

  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: colW, h: ch,
      fontSize: 26, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: 'left', valign: 'middle', wrap: true, shrinkText: true,
    });
  }
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    const capH = img.caption ? CAPTION_H : 0;
    tryAddImage(s, img.src, { x: M + colW + GAP, y: cy, w: colW, h: ch - capH }, warnings, imgAr(img));
    addCaption(s, img.caption, t, M + colW + GAP, cy + ch - capH, colW);
  }
}

function addSplitSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[], tc: string = hex(t.colors.text), hc: string = tc, boldColor: string = tc) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const colW  = (W - M * 2 - 0.3) / 2;
  const imgIdx = slide.elements.findIndex((e) => e.type === 'image');
  const img    = imgIdx >= 0 ? slide.elements[imgIdx] : undefined;
  const rest   = slide.elements.filter((e) => e.type !== 'image');
  // Mirror the preview: image goes right when it appears after text in source
  const imgOnRight = imgIdx > 0;

  const ar = img && img.type === 'image' ? imgAr(img) : undefined;
  const capH = img && img.type === 'image' && img.caption ? CAPTION_H : 0;

  if (imgOnRight) {
    addElements(s, rest, t, { x: M, y: bodyY, w: colW, h: bodyH }, warnings, tc, undefined, boldColor);
    if (img && img.type === 'image') {
      const imgX = M + colW + 0.3;
      tryAddImage(s, img.src, { x: imgX, y: bodyY, w: colW, h: bodyH - capH }, warnings, ar);
      addCaption(s, img.caption, t, imgX, bodyY + bodyH - capH, colW);
    }
  } else {
    if (img && img.type === 'image') {
      tryAddImage(s, img.src, { x: M, y: bodyY, w: colW, h: bodyH - capH }, warnings, ar);
      addCaption(s, img.caption, t, M, bodyY + bodyH - capH, colW);
    }
    addElements(s, rest, t, { x: M + colW + 0.3, y: bodyY, w: colW, h: bodyH }, warnings, tc, undefined, boldColor);
  }
}

function addFullBleedSlide(s: PS, slide: Slide, t: Theme, H: number, warnings: string[]) {
  // Use background colour as fallback so a missing image doesn't render as a
  // dark primary-coloured slide that looks like a broken title slide.
  s.background = { fill: hex(t.colors.background) };
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    tryAddImage(s, img.src, { x: 0, y: 0, w: W, h: H }, warnings);
    // Overlay bar, mirroring .sl-full-bleed__caption — the image fills the
    // whole slide edge-to-edge so the caption can't just sit "below" it.
    if (img.caption) {
      const barH = 0.5;
      s.addText(img.caption, {
        x: 0, y: H - barH, w: W, h: barH,
        fontSize: 12, italic: true, color: 'FFFFFF',
        fontFace: firstFont(t.fonts.body),
        fill: { color: '000000', transparency: 35 },
        align: 'center', valign: 'middle',
      });
    }
  }
}

function addQuoteSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, tc: string = hex(t.colors.text)) {
  s.background = { fill: hex(t.colors.background) };
  const bq = slide.elements.find((e) => e.type === 'blockquote');
  if (!bq || bq.type !== 'blockquote') return;
  const attrH  = bq.attribution ? 0.5 : 0;
  const quoteH = ch - attrH - 0.15;

  s.addText(`“${bq.text}”`, {
    x: M + 0.5, y: cy, w: W - M * 2 - 1, h: quoteH,
    fontSize: 24, italic: true,
    color: tc,
    fontFace: firstFont(t.fonts.body),
    align: 'center', valign: 'middle', wrap: true,
  });
  if (bq.attribution) {
    s.addText(`— ${bq.attribution}`, {
      x: M, y: cy + quoteH + 0.1, w: W - M * 2, h: attrH,
      fontSize: 14,
      color: hex(t.colors.accent),
      fontFace: firstFont(t.fonts.body),
      align: 'right', valign: 'middle',
    });
  }
}

function addMultiColumnSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[], tc: string = hex(t.colors.text), hc: string = tc, boldColor: string = tc, columns: 2 | 3 = 2) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const GAP   = 0.3;
  const colW  = (W - M * 2 - GAP * (columns - 1)) / columns;
  const hasBreak = slide.elements.some((e) => e.type === 'column-break');
  const groups = hasBreak
    ? splitByColumnBreaks(slide.elements, columns)
    : [...autoSplitElements(slide.elements), ...Array(columns - 2).fill([])];

  groups.forEach((group, i) => {
    addElements(s, group, t, { x: M + i * (colW + GAP), y: bodyY, w: colW, h: bodyH }, warnings, tc, undefined, boldColor);
  });
}

function addBspSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[], tc: string = hex(t.colors.text), hc: string = tc, boldColor: string = tc) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const GAP   = 0.3;
  const colW  = (W - M * 2 - GAP) / 2;

  // Mirror preview: group consecutive progress bars, then apply same placement logic
  const groups = groupProgressRuns(slide.elements);
  if (groups.length < 2) {
    addElements(s, slide.elements, t, { x: M, y: bodyY, w: W - M * 2, h: bodyH }, warnings, tc, undefined, boldColor);
    return;
  }

  const isPureText = (g: SlideElement[]) =>
    g.every((e) => e.type === 'paragraph' || e.type === 'list' || e.type === 'progress');

  let leftGroup: SlideElement[];
  let rightGroups: SlideElement[][];

  if (groups.length === 2) {
    if (!isPureText(groups[0]) && isPureText(groups[1])) {
      leftGroup   = groups[1];
      rightGroups = [groups[0]];
    } else {
      leftGroup   = groups[0];
      rightGroups = [groups[1]];
    }
  } else {
    leftGroup   = groups[0];
    rightGroups = groups.slice(1);
  }

  addElements(s, leftGroup, t, { x: M, y: bodyY, w: colW, h: bodyH }, warnings, tc, undefined, boldColor);

  if (rightGroups.length === 1) {
    addElements(s, rightGroups[0], t, { x: M + colW + GAP, y: bodyY, w: colW, h: bodyH }, warnings, tc, undefined, boldColor);
  } else {
    const subH = (bodyH - 0.2) / 2;
    addElements(s, rightGroups[0], t, { x: M + colW + GAP, y: bodyY,              w: colW, h: subH }, warnings, tc, undefined, boldColor);
    if (rightGroups[1]) {
      addElements(s, rightGroups[1], t, { x: M + colW + GAP, y: bodyY + subH + 0.2, w: colW, h: subH }, warnings, tc, undefined, boldColor);
    }
  }
}

function addGridSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[], tc: string = hex(t.colors.text), hc: string = tc, boldColor: string = tc) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const GAP   = 0.2;
  const cols  = 2;
  const filtered = slide.elements.filter((e) => e.type !== 'column-break');
  const groups   = groupProgressRuns(filtered);
  const rows     = Math.ceil(groups.length / cols);
  const cellW    = (W - M * 2 - GAP * (cols - 1)) / cols;
  const cellH    = rows > 0 ? (bodyH - GAP * (rows - 1)) / rows : bodyH;

  groups.forEach((group, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    addElements(s, group, t, {
      x: M + col * (cellW + GAP),
      y: bodyY + row * (cellH + GAP),
      w: cellW, h: cellH,
    }, warnings, tc, undefined, boldColor);
  });
}

function addMediaSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, tc: string = hex(t.colors.text), hc: string = tc) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const yt    = slide.elements.find((e) => e.type === 'youtube');
  const vid   = slide.elements.find((e) => e.type === 'video');
  const poll  = slide.elements.find((e) => e.type === 'poll');

  // ponytail: PPTX can't embed local video without bundling the file — emit a
  // labelled placeholder, same as the YouTube branch. Real embed is the upgrade path.
  if (vid && vid.type === 'video') {
    s.addText([
      { text: '▶ ', options: { fontSize: 30, bold: true } },
      { text: vid.label || 'Video', options: { fontSize: 20, breakLine: true } },
      { text: vid.src, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: bodyY, w: W - M * 2, h: bodyH,
      color: tc, fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  }

  const both  = yt && poll;
  const halfH = (bodyH - 0.2) / 2;

  if (yt && yt.type === 'youtube') {
    s.addText([
      { text: '▶ ', options: { fontSize: 30, bold: true } },
      { text: yt.label || 'YouTube Video', options: { fontSize: 20, breakLine: true } },
      { text: yt.url, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: bodyY, w: W - M * 2, h: both ? halfH : bodyH,
      color: tc, fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  }
  if (poll && poll.type === 'poll') {
    const pollY = both ? bodyY + halfH + 0.2 : bodyY;
    s.addText([
      { text: poll.label || 'QR Code', options: { fontSize: 20, bold: true, breakLine: true } },
      { text: poll.url, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: pollY, w: W - M * 2, h: both ? halfH : bodyH,
      color: tc, fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  }
}

function addCodeSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[], tc: string = hex(t.colors.text), codeBg?: string, hc: string = tc) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hc,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const codeY = cy + hh + 0.1;
  const codeH = ch - hh - 0.1;

  // Mermaid diagrams are pre-converted to image elements during resolveSlideImages.
  // If conversion succeeded, it shows up as an image element here.
  const imgEl = slide.elements.find((e) => e.type === 'image');
  if (imgEl && imgEl.type === 'image') {
    const ar = imgEl.title ? parseFloat(imgEl.title) : NaN;
    const capH = imgEl.caption ? CAPTION_H : 0;
    tryAddImage(s, imgEl.src, { x: M, y: codeY, w: W - M * 2, h: codeH - capH }, warnings, isFinite(ar) ? ar : undefined);
    addCaption(s, imgEl.caption, t, M, codeY + codeH - capH, W - M * 2);
    return;
  }

  const codeEl = slide.elements.find((e) => e.type === 'code' || e.type === 'mermaid');
  if (!codeEl) return;

  addCodeBlock(s, codeEl.value, codeEl.type === 'code' ? codeEl.lang : undefined, t,
    { x: M, y: codeY, w: W - M * 2, h: codeH }, codeBg);
}

function addBlankSlide(s: PS, t: Theme) {
  s.background = { fill: hex(t.colors.background) };
}

// ── Academic references ───────────────────────────────────────────────────────

function blendColor(fg: string, bg: string, alpha: number): string {
  const [fr, fg2, fb] = parseChannels(hex(fg));
  const [br, bg2, bb] = parseChannels(hex(bg));
  const r = Math.round(fr * alpha + br * (1 - alpha));
  const g = Math.round(fg2 * alpha + bg2 * (1 - alpha));
  const b = Math.round(fb * alpha + bb * (1 - alpha));
  return [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function addReferences(s: PS, refs: string[], t: Theme, H: number, hasFoot: boolean, tc: string = hex(t.colors.text)) {
  const REF_H = Math.min(0.06 + refs.length * 0.17, H * 0.35);
  const bottomPad = hasFoot ? FOOT_H + 0.08 : 0.15;
  const color = blendColor(tc, t.colors.background, 0.60);
  const codeFont = firstFont(t.fonts.code);
  const accentColor = hex(t.colors.accent);
  const runs = refs.flatMap((ref, i) => {
    const refRuns = htmlToInlineRuns(ref, color, codeFont, accentColor, color);
    return refRuns.map((run, ri) => ({
      text: run.text,
      options: { fontSize: 7, ...run.options, color, breakLine: ri === refRuns.length - 1 && i < refs.length - 1 },
    }));
  });
  s.addText(runs, {
    x: W / 2, y: H - bottomPad - REF_H, w: W / 2 - M, h: REF_H,
    fontSize: 7, color,
    fontFace: firstFont(t.fonts.body),
    align: 'right', valign: 'bottom',
    wrap: true,
  });
}

// ── Header / Footer bars ──────────────────────────────────────────────────────

// Mirrors the BarText component and .sl-bar-parts CSS (issue #30/#44).
// Receives pre-split segments (split from the template *before* variable resolution
// so a doc title containing `|` is never treated as a column separator).
function addBarText(
  s: PS,
  segments: string[],
  x: number, y: number, w: number, h: number,
  fontSize: number, color: string, fontFace: string,
  objectName: string,
) {
  if (segments.length <= 1) {
    s.addText(segments[0] ?? '', { x, y, w, h, fontSize, color, fontFace, align: 'left', valign: 'middle', objectName });
    return;
  }
  const [left = '', center = '', ...rest] = segments;
  const right = rest.join(' | ');
  const colW = w / 3;
  if (left)   s.addText(left,   { x,            y, w: colW, h, fontSize, color, fontFace, align: 'left',   valign: 'middle', objectName });
  if (center) s.addText(center, { x: x + colW,  y, w: colW, h, fontSize, color, fontFace, align: 'center', valign: 'middle', objectName });
  if (right)  s.addText(right,  { x: x + colW * 2, y, w: colW, h, fontSize, color, fontFace, align: 'right',  valign: 'middle', objectName });
}

function addHeaderBar(s: PS, t: Theme, meta: Meta) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: HEAD_H,
    fill: { color: hex(t.colors.primary) },
    line: { type: 'none' },
  });
  const vars = { title: meta.docTitle, author: meta.docAuthor, date: meta.docDate, slideNumber: meta.slideNum, totalSlides: meta.totalSlides };
  const segs = t.header.text.split('|').map((p) => resolveTemplate(p.trim(), vars));
  if (segs.some(Boolean)) {
    addBarText(s, segs, M, 0, W - M * 2, HEAD_H, 10, hex(t.colors.title_text), firstFont(t.fonts.body), 'kova:header-text');
  }
}

function addFooterBar(s: PS, t: Theme, meta: Meta, H: number) {
  // The CSS footer renders as a thin border-top line, not a filled bar —
  // use a thin accent-coloured rectangle to match the live preview.
  const footY = H - FOOT_H;
  s.addShape('rect', {
    x: 0, y: footY, w: W, h: 0.02,
    fill: { color: hex(t.colors.accent) },
    line: { type: 'none' },
  });
  const showNum = t.footer.show_slide_number;
  const vars = { title: meta.docTitle, author: meta.docAuthor, date: meta.docDate, slideNumber: meta.slideNum, totalSlides: meta.totalSlides };
  const segs = t.footer.text.split('|').map((p) => resolveTemplate(p.trim(), vars));
  const textW = W - M * 2 - (showNum ? 1.1 : 0);
  if (segs.some(Boolean)) {
    addBarText(s, segs, M, footY + 0.02, textW, FOOT_H - 0.02, 9, hex(t.colors.text), firstFont(t.fonts.body), 'kova:footer-text');
  }
  if (showNum) {
    s.addText(`${meta.slideNum} / ${meta.totalSlides}`, {
      x: W - M - 1.1, y: footY + 0.02, w: 1.1, h: FOOT_H - 0.02,
      fontSize: 9, color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.body),
      align: 'right', valign: 'middle',
      objectName: 'kova:slidenum',
    });
  }
}

function addLogo(
  s: PS,
  logoDataUrl: string,
  logoAr: number | null,
  position: Theme['logo_position'],
  opacity: number,
  H: number,
) {
  const LOGO_H = 0.35;
  const LOGO_W = logoAr ? LOGO_H * logoAr : 0.7;
  const PAD    = 0.12;
  let lx: number;
  let ly: number;
  switch (position) {
    case 'top-left':     lx = PAD;                ly = PAD; break;
    case 'top-right':    lx = W - PAD - LOGO_W;   ly = PAD; break;
    case 'bottom-left':  lx = PAD;                ly = H - PAD - LOGO_H; break;
    case 'bottom-right':
    default:             lx = W - PAD - LOGO_W;   ly = H - PAD - LOGO_H; break;
  }
  const transparency = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 100);
  try {
    s.addImage({ data: logoDataUrl, x: lx, y: ly, w: LOGO_W, h: LOGO_H, transparency, objectName: 'kova:logo' });
  } catch { /* ignore */ }
}

// ── Syntax-highlight helpers (github-dark colour map) ─────────────────────────

const HLJS_DEFAULT = 'C9D1D9'; // .hljs base text colour

const HLJS_STYLE: Record<string, { color: string; bold?: true; italic?: true }> = {
  'hljs-keyword':           { color: 'FF7B72' },
  'hljs-doctag':            { color: 'FF7B72' },
  'hljs-template-tag':      { color: 'FF7B72' },
  'hljs-template-variable': { color: 'FF7B72' },
  'hljs-type':              { color: 'FF7B72' },
  'hljs-title':             { color: 'D2A8FF' },
  'hljs-attr':              { color: '79C0FF' },
  'hljs-attribute':         { color: '79C0FF' },
  'hljs-literal':           { color: '79C0FF' },
  'hljs-meta':              { color: '79C0FF' },
  'hljs-number':            { color: '79C0FF' },
  'hljs-operator':          { color: '79C0FF' },
  'hljs-variable':          { color: '79C0FF' },
  'hljs-selector-attr':     { color: '79C0FF' },
  'hljs-selector-class':    { color: '79C0FF' },
  'hljs-selector-id':       { color: '79C0FF' },
  'hljs-regexp':            { color: 'A5D6FF' },
  'hljs-string':            { color: 'A5D6FF' },
  'hljs-built_in':          { color: 'FFA657' },
  'hljs-symbol':            { color: 'FFA657' },
  'hljs-comment':           { color: '8B949E' },
  'hljs-code':              { color: '8B949E' },
  'hljs-formula':           { color: '8B949E' },
  'hljs-name':              { color: '7EE787' },
  'hljs-quote':             { color: '7EE787' },
  'hljs-selector-tag':      { color: '7EE787' },
  'hljs-selector-pseudo':   { color: '7EE787' },
  'hljs-subst':             { color: 'C9D1D9' },
  'hljs-section':           { color: '1F6FEB', bold: true },
  'hljs-bullet':            { color: 'F2CC60' },
  'hljs-emphasis':          { color: 'C9D1D9', italic: true },
  'hljs-strong':            { color: 'C9D1D9', bold: true },
  'hljs-addition':          { color: 'AFF5B4' },
  'hljs-deletion':          { color: 'FFDCD7' },
};

type PptxRun = { text: string; options: Record<string, unknown> };

// KaTeX emits both MathML (accessible) and HTML layers. Walking both text
// nodes concatenates duplicated runs (e.g. "x2x^2x2") — issue #170. Prefer
// the TeX source from the MathML annotation when present.
function katexTexSource(el: Element): string | null {
  if (!el.classList?.contains('katex')) return null;
  const ann = el.querySelector('annotation[encoding="application/x-tex"]');
  const tex = ann?.textContent?.trim();
  return tex || null;
}

// Inline formatting state accumulated while walking down the DOM. Bundled
// into one object (rather than one positional bool per attribute) so adding
// a new inline format only touches this type and the two places that read
// or derive it, not every walk() call site.
interface RunFormatting {
  bold: boolean;
  italic: boolean;
  isCode: boolean;
  strike: boolean;
  underline: boolean;
  color: string;
  href: string | null;
}

// Options shared by every run regardless of node kind; callers layer on
// italic/fontFace since those two vary for the KaTeX-TeX-source case.
function baseRunOptions(f: RunFormatting): Record<string, unknown> {
  return {
    color: f.color,
    ...(f.bold      ? { bold: true }                    : {}),
    ...(f.strike    ? { strike: true }                  : {}),
    ...(f.underline ? { underline: { style: 'sng' } }    : {}),
    ...(f.href      ? { hyperlink: { url: f.href } }     : {}),
  };
}

// Walk markdown-generated HTML (bold, italic, code, links) into PptxGenJS runs.
function htmlToInlineRuns(
  html: string,
  defaultColor: string,
  codeFont: string,
  accentColor: string,
  boldColor: string = defaultColor,
): PptxRun[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const runs: PptxRun[] = [];

  function walk(node: Node, f: RunFormatting) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (!text) return;
      runs.push({
        text,
        options: {
          ...baseRunOptions(f),
          ...(f.italic ? { italic: true }        : {}),
          ...(f.isCode ? { fontFace: codeFont }  : {}),
        },
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      const tex = katexTexSource(el);
      if (tex !== null) {
        runs.push({
          text: tex,
          options: { ...baseRunOptions(f), italic: true },
        });
        return;
      }
      // Fallback: strip MathML and walk only the visual HTML layer once.
      if (el.classList?.contains('katex')) {
        el.querySelector('.katex-mathml')?.remove();
      }

      const isBold = tag === 'strong' || tag === 'b';
      // '#' is escUrl's sentinel for a stripped/invalid href (see markdownToSlides.ts) — never link to it.
      const linkHref = tag === 'a' ? el.getAttribute('href') : null;
      const nextHref = linkHref && linkHref !== '#' ? linkHref : f.href;
      for (const child of node.childNodes) {
        walk(child, {
          bold: f.bold || isBold,
          italic: f.italic || tag === 'em' || tag === 'i',
          isCode: f.isCode || tag === 'code',
          strike: f.strike || tag === 'del' || tag === 's',
          underline: f.underline || tag === 'u',
          // Link colour wins over bold colour when both apply (e.g. a bolded
          // link, or bold text nested inside a link), matching the existing
          // precedent that link text always takes accentColor regardless of
          // surrounding formatting. `nextHref` stays truthy for every
          // descendant of an `<a>`, so this holds even past an intervening
          // <strong>.
          color: (tag === 'a' || nextHref) ? accentColor : (isBold ? boldColor : f.color),
          href: nextHref,
        });
      }
    }
  }

  for (const child of div.childNodes) {
    walk(child, {
      bold: false, italic: false, isCode: false, strike: false, underline: false,
      color: defaultColor, href: null,
    });
  }
  return runs.length > 0 ? runs : [{ text: stripHtml(html) || ' ', options: { color: defaultColor } }];
}

// Walk the hljs HTML DOM and produce a flat list of coloured text runs.
// Newlines inside runs are converted to explicit breakLine: true entries.
function hljsHtmlToRuns(html: string): PptxRun[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const runs: PptxRun[] = [];

  function walk(node: Node, color: string, bold: boolean, italic: boolean) {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? '';
      if (!raw) return;
      const lines = raw.split('\n');
      lines.forEach((line, i) => {
        const last = i === lines.length - 1;
        if (last && line === '') return; // trailing \n — skip phantom fragment
        runs.push({
          text: line || ' ',
          options: {
            color,
            ...(bold   ? { bold }   : {}),
            ...(italic ? { italic } : {}),
            ...(!last  ? { breakLine: true } : {}),
          },
        });
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const cls = (node as Element).getAttribute('class') ?? '';
      let nodeColor = color;
      let nodeBold  = bold;
      let nodeItalic = italic;
      for (const c of cls.split(/\s+/)) {
        const s = HLJS_STYLE[c];
        if (s) { nodeColor = s.color; nodeBold = bold || !!s.bold; nodeItalic = italic || !!s.italic; break; }
      }
      for (const child of node.childNodes) walk(child, nodeColor, nodeBold, nodeItalic);
    }
  }

  for (const child of div.childNodes) walk(child, HLJS_DEFAULT, false, false);
  return runs;
}

// ── Callout/admonition box (mirrors .sl-callout in SlideRenderer.css) ─────────
// Colors are fixed per type, not theme-derived — same rationale as the web
// renderer: users expect note=blue/warning=amber/danger=red regardless of theme.
const CALLOUT_COLORS: Record<string, string> = {
  note: '#448AFF',
  info: '#00B8D4',
  tip: '#00C853',
  warning: '#FF9100',
  danger: '#FF5252',
};

function addCalloutBlock(s: PS, el: Extract<SlideElement, { type: 'blockquote' }>, t: Theme, area: Area, tc: string = hex(t.colors.text)) {
  const color = CALLOUT_COLORS[el.calloutType ?? 'note'] ?? CALLOUT_COLORS.note;
  const BAR_W = 0.06;
  const PAD   = 0.15;

  s.addShape('rect', {
    x: area.x, y: area.y, w: area.w, h: area.h,
    fill: { color: hex(t.colors.background) },
    line: { color: hex(color), width: 0.75, transparency: 60 },
  });
  s.addShape('rect', {
    x: area.x, y: area.y, w: BAR_W, h: area.h,
    fill: { color: hex(color) },
    line: { type: 'none' },
  });

  const titleH = 0.35;
  s.addText(el.title ?? '', {
    x: area.x + BAR_W + PAD, y: area.y + PAD * 0.5, w: area.w - BAR_W - PAD * 1.5, h: titleH,
    fontSize: 15, bold: true,
    color: hex(color),
    fontFace: firstFont(t.fonts.body),
    valign: 'top',
  });

  if (el.text.trim()) {
    s.addText(el.text, {
      x: area.x + BAR_W + PAD, y: area.y + PAD * 0.5 + titleH, w: area.w - BAR_W - PAD * 1.5, h: area.h - titleH - PAD,
      fontSize: 14,
      color: tc,
      fontFace: firstFont(t.fonts.body),
      valign: 'top', wrap: true,
      shrinkText: true,
    });
  }
}

// ── Styled code block (reused by addCodeSlide and addElements) ────────────────

function addCodeBlock(s: PS, value: string, lang: string | undefined, t: Theme, area: Area, codeBgOverride?: string) {
  const OUTER_PAD = 0.15;
  const LANG_H    = 0.25;
  const INNER_PAD = 0.15;
  // 12pt text at ~1.2 line spacing in PowerPoint ≈ 0.22" per line
  const LINE_H    = 0.22;

  const lineCount = Math.max(1, value.split('\n').length);
  const langExtra = lang ? LANG_H + 0.06 : 0;
  const textH     = lineCount * LINE_H;

  // Natural height of the whole code block; clamp to the available area
  const naturalH = OUTER_PAD + langExtra + INNER_PAD + textH + INNER_PAD + OUTER_PAD;
  const blockH   = Math.min(naturalH, area.h);

  // Derive inner dimensions from the clamped block height so nothing overflows.
  const innerAvail   = blockH - OUTER_PAD * 2 - langExtra;
  const innerH       = Math.max(INNER_PAD * 2 + LINE_H, Math.min(INNER_PAD + textH + INNER_PAD, innerAvail));
  const clampedTextH = Math.max(LINE_H, innerH - INNER_PAD * 2);

  // Vertically centre within the area
  const blockY = area.y + (area.h - blockH) / 2;

  // Outer area — code_bg background, no border (mirrors .sl-code)
  const codeBg = codeBgOverride ?? t.colors.code_bg;
  s.addShape('rect', {
    x: area.x, y: blockY, w: area.w, h: blockH,
    fill: { color: hex(codeBg) },
    line: { type: 'none' },
  });

  // Language badge — uppercase, accent, letter-spaced (mirrors .sl-code__lang)
  if (lang) {
    s.addText(lang.toUpperCase(), {
      x: area.x + OUTER_PAD, y: blockY + OUTER_PAD,
      w: 3, h: LANG_H,
      fontSize: 9, color: hex(t.colors.accent),
      fontFace: firstFont(t.fonts.code),
      align: 'left', valign: 'bottom',
      charSpacing: 1,
    });
  }

  // Inner dark rect — use the github-dark background (#0d1117) for proper contrast.
  // mixBlack(code_bg, 0.4) only yields medium gray for light themes, making text
  // hard to read; the actual highlight.js github-dark theme hardcodes #0d1117.
  const innerX = area.x + OUTER_PAD;
  const innerY = blockY + OUTER_PAD + langExtra;
  const innerW = area.w - OUTER_PAD * 2;

  s.addShape('rect', {
    x: innerX, y: innerY, w: innerW, h: innerH,
    fill: { color: '0D1117' },
    line: { type: 'none' },
  });

  // Syntax-highlight and convert to coloured PptxGenJS runs (github-dark palette).
  const highlighted = lang && hljs.getLanguage(lang)
    ? hljs.highlight(value, { language: lang })
    : hljs.highlightAuto(value);
  const codeRuns = hljsHtmlToRuns(highlighted.value);

  s.addText(codeRuns.length > 0 ? codeRuns : [{ text: value || ' ', options: { color: HLJS_DEFAULT } }], {
    x: innerX + INNER_PAD, y: innerY + INNER_PAD,
    w: innerW - INNER_PAD * 2,
    h: clampedTextH,
    fontSize: 12, color: HLJS_DEFAULT,
    fontFace: firstFont(t.fonts.code),
    align: 'left', valign: 'top',
    wrap: false,
    // Box height is already clamped to the slide above; shrinkText is a
    // PowerPoint-side autofit hint for excess *line count* (applied on first
    // edit/resize in PowerPoint — see the comment in addElements). It does
    // nothing for excess *line length* since wrap is intentionally off here
    // to preserve code indentation/alignment.
    shrinkText: true,
  });
}

// ── Element renderer ──────────────────────────────────────────────────────────

function addElements(s: PS, elements: SlideElement[], t: Theme, area: Area, warnings: string[] = [], tc: string = hex(t.colors.text), codeBg?: string, boldColor: string = tc) {
  if (elements.length === 0) return;

  // Single image fills the area
  if (elements.length === 1 && elements[0].type === 'image') {
    const el = elements[0];
    const ar = el.title ? parseFloat(el.title) : NaN;
    const capH = el.caption ? CAPTION_H : 0;
    tryAddImage(s, el.src, { ...area, h: area.h - capH }, warnings, isFinite(ar) ? ar : undefined);
    addCaption(s, el.caption, t, area.x, area.y + area.h - capH, area.w);
    return;
  }

  // Single code element — render with full dark-background styling
  if (elements.length === 1 && elements[0].type === 'code') {
    const el = elements[0];
    addCodeBlock(s, el.value, el.lang, t, area, codeBg);
    return;
  }

  // Single callout — render as a bordered/accent-barred box, not a plain quote
  if (elements.length === 1 && elements[0].type === 'blockquote' && elements[0].calloutType) {
    addCalloutBlock(s, elements[0], t, area, tc);
    return;
  }

  // Build a text run array for all text-based elements
  const runs: Array<{ text: string; options?: Record<string, unknown> }> = [];

  for (const el of elements) {
    switch (el.type) {
      case 'paragraph':
        if (el.text.trim()) {
          const paraRuns = htmlToInlineRuns(el.html, tc, firstFont(t.fonts.code), hex(t.colors.accent), boldColor);
          paraRuns.forEach((run, ri) => {
            runs.push({ text: run.text, options: { fontSize: 18, ...run.options, breakLine: ri === paraRuns.length - 1 } });
          });
        }
        break;

      case 'list':
        for (const item of el.items) {
          const bulletBase = {
            bullet: el.ordered ? { type: 'number', style: 'arabicPeriod' } as const : true as const,
            fontSize: 18,
            paraSpaceAfter: 4,
          };
          const itemRuns = htmlToInlineRuns(item.html, tc, firstFont(t.fonts.code), hex(t.colors.accent), boldColor);
          runs.push({ text: itemRuns[0].text, options: { ...itemRuns[0].options, ...bulletBase } });
          for (let ri = 1; ri < itemRuns.length; ri++) {
            runs.push({ text: itemRuns[ri].text, options: { fontSize: 18, ...itemRuns[ri].options } });
          }
          for (const child of item.children) {
            const childBase = { bullet: true as const, indentLevel: 1, fontSize: 16, paraSpaceAfter: 3 };
            const childRuns = htmlToInlineRuns(child.html, tc, firstFont(t.fonts.code), hex(t.colors.accent), boldColor);
            runs.push({ text: childRuns[0].text, options: { ...childRuns[0].options, ...childBase } });
            for (let ri = 1; ri < childRuns.length; ri++) {
              runs.push({ text: childRuns[ri].text, options: { fontSize: 16, ...childRuns[ri].options } });
            }
          }
        }
        break;

      case 'blockquote':
        if (el.calloutType) {
          const color = CALLOUT_COLORS[el.calloutType] ?? CALLOUT_COLORS.note;
          runs.push({
            text: el.title ?? '',
            options: { bold: true, fontSize: 16, color: hex(color), breakLine: true, paraSpaceAfter: 2 },
          });
          if (el.text.trim()) {
            runs.push({ text: el.text, options: { fontSize: 16, breakLine: true, paraSpaceAfter: 4 } });
          }
        } else {
          runs.push({
            text: `“${el.text}”`,
            options: { italic: true, fontSize: 18, breakLine: true },
          });
          if (el.attribution) {
            runs.push({
              text: `— ${el.attribution}`,
              options: { fontSize: 14, color: hex(t.colors.accent), breakLine: true },
            });
          }
        }
        break;

      case 'toc': {
        const numberStart = el.numberStart ?? 0;
        el.entries.forEach((entry, i) => {
          runs.push({
            text: entry.title,
            options: {
              ...(t.toc.numbered
                ? { bullet: { type: 'number', numberType: 'arabicPeriod', numberStartAt: numberStart + i + 1 } }
                : {}),
              fontSize: 18, paraSpaceAfter: 4, breakLine: true,
            },
          });
        });
        break;
      }

      case 'code':
        // Code mixed with other elements: fall back to plain monospaced text.
        // (Single-element code is caught above and rendered with full styling.)
        runs.push({ text: el.value, options: { fontFace: firstFont(t.fonts.code), fontSize: 13, breakLine: true } });
        break;

      case 'math':
        runs.push({ text: el.value, options: { fontFace: firstFont(t.fonts.code), fontSize: 15, breakLine: true } });
        if (el.caption) {
          runs.push({ text: el.caption, options: { fontSize: 11, italic: true, breakLine: true, paraSpaceAfter: 4 } });
        }
        break;

      case 'video':
        // pptx can't embed local video without bundling the file — emit a
        // labelled placeholder, matching the media-slide placeholder in addMediaSlide.
        runs.push({ text: `▶ ${el.label || 'Video'}`, options: { fontSize: 16, bold: true, breakLine: true } });
        runs.push({ text: el.src, options: { fontSize: 11, color: hex(t.colors.accent), breakLine: true, paraSpaceAfter: 4 } });
        break;

      case 'youtube':
        // Mirrors the addMediaSlide YouTube placeholder styling above.
        runs.push({ text: `▶ ${el.label || 'YouTube Video'}`, options: { fontSize: 16, bold: true, breakLine: true } });
        runs.push({ text: el.url, options: { fontSize: 11, color: hex(t.colors.accent), breakLine: true, paraSpaceAfter: 4 } });
        break;

      // Images and tables handled separately below
      default:
        break;
    }
  }

  if (runs.length > 0) {
    s.addText(runs, {
      x: area.x, y: area.y, w: area.w, h: area.h,
      fontSize: 18, color: tc,
      fontFace: firstFont(t.fonts.body),
      valign: 'top', wrap: true,
      // Unlike the live preview's OverflowPane (which measures real DOM height
      // and applies a CSS scale-to-fit), PptxGenJS has no way to pre-shrink text
      // at export time — shrinkText only sets PowerPoint's "Shrink text on
      // overflow" autofit flag, which PowerPoint itself applies the next time the
      // box is edited or resized (pptxgenjs can't trigger that calculation here).
      // It's a partial mitigation — the box opens at full size and self-corrects
      // on first edit — rather than nothing, which is what dense slides had before.
      shrinkText: true,
    });
  }

  // Progress bars: stacked, centred in the area
  const progressEls = elements.filter((e) => e.type === 'progress') as Extract<SlideElement, { type: 'progress' }>[];
  if (progressEls.length > 0) {
    const rowH   = 0.55;
    const trackH = 0.1;
    const labelH = rowH - trackH - 0.05;
    const totalH = progressEls.length * rowH;
    const startY = area.y + Math.max(0, (area.h - totalH) / 2);

    progressEls.forEach((el, i) => {
      const pct = Math.max(0, Math.min(100, el.value)) / 100;
      const y   = startY + i * rowH;

      s.addText(el.label, {
        x: area.x, y, w: area.w * 0.78, h: labelH,
        fontSize: 13, bold: true,
        color: tc, fontFace: firstFont(t.fonts.body),
        valign: 'bottom',
      });
      s.addText(`${el.value}%`, {
        x: area.x + area.w * 0.78, y, w: area.w * 0.22, h: labelH,
        fontSize: 13, bold: true,
        color: hex(t.colors.accent), fontFace: firstFont(t.fonts.body),
        align: 'right', valign: 'bottom',
      });
      const trackY = y + labelH + 0.02;
      s.addShape('rect', { x: area.x, y: trackY, w: area.w, h: trackH, fill: { color: 'DDDDDD' }, line: { type: 'none' } });
      if (pct > 0) {
        s.addShape('rect', { x: area.x, y: trackY, w: area.w * pct, h: trackH, fill: { color: hex(t.colors.accent) }, line: { type: 'none' } });
      }
    });
  }

  // Table + any remaining images (elements.length === 1 && type === 'image' is
  // caught by the fast path at the top of this function; this is for an image
  // that shares its area with other content, e.g. a table, or any element mix
  // reached via an explicit ||| column break) share the space left below the
  // text runs. Without this, such images used to fall through the switch's
  // `default` case above and vanish from the export with no warning.
  const tableEl = elements.find((e) => e.type === 'table');
  const imageEls = elements.filter((e) => e.type === 'image') as Extract<SlideElement, { type: 'image' }>[];
  if (tableEl?.type === 'table' || imageEls.length > 0) {
    const textFrac = runs.length > 0 ? Math.min(0.5, 0.15 + runs.length * 0.08) : 0;
    const belowY = area.y + area.h * textFrac;
    const belowH = area.h * (1 - textFrac - 0.02);
    // With both a table and image(s) present, give the table the larger share
    // (it usually carries the primary content) and stack the image(s) below it.
    const tableFrac = tableEl?.type === 'table' && imageEls.length > 0 ? 0.6 : 1;

    if (tableEl?.type === 'table') {
      const tableH = belowH * tableFrac;
      const capH = tableEl.caption ? CAPTION_H : 0;
      addTable(s, tableEl, t, { x: area.x, y: belowY, w: area.w, h: tableH - capH }, tc);
      addCaption(s, tableEl.caption, t, area.x, belowY + tableH - capH, area.w);
    }

    if (imageEls.length > 0) {
      const imagesY = belowY + belowH * (tableEl?.type === 'table' ? tableFrac : 0);
      const imagesH = belowH * (1 - (tableEl?.type === 'table' ? tableFrac : 0));
      const perImgH = imagesH / imageEls.length;
      imageEls.forEach((img, i) => {
        const capH = img.caption ? CAPTION_H : 0;
        const y = imagesY + i * perImgH;
        tryAddImage(s, img.src, { x: area.x, y, w: area.w, h: perImgH - capH }, warnings, imgAr(img));
        addCaption(s, img.caption, t, area.x, y + perImgH - capH, area.w);
      });
    }
  }
}

function addTable(
  s: PS,
  el: Extract<SlideElement, { type: 'table' }>,
  t: Theme,
  area: Area,
  tc: string = hex(t.colors.text),
) {
  const colAlign = (i: number): 'left' | 'center' | 'right' =>
    (el.align?.[i] as 'left' | 'center' | 'right' | null | undefined) ?? 'left';

  const headerRow = el.headers.map((h, i) => ({
    text: stripHtml(h),
    options: {
      bold: true,
      color: hex(t.colors.title_text),
      fill: { color: hex(t.colors.primary) },
      align: colAlign(i),
    },
  }));
  const bodyRows = el.rows.map((row) =>
    row.map((cell, i) => ({ text: stripHtml(cell), options: { color: tc, fontSize: 14, align: colAlign(i) } }))
  );

  s.addTable([headerRow, ...bodyRows], {
    x: area.x, y: area.y, w: area.w, h: area.h,
    fontSize: 14,
    fontFace: firstFont(t.fonts.body),
    border: { color: hex(t.colors.accent), pt: 0.5 },
  });
}

// PptxGenJS `sizing.contain` is broken for pre-encoded data URLs because it
// initialises imgWidth/imgHeight from the box dimensions (not the PNG pixels).
// We do the contain math ourselves when we know the aspect ratio.
function imgAr(el: Extract<SlideElement, { type: 'image' }>): number | undefined {
  const v = el.title ? parseFloat(el.title) : NaN;
  return isFinite(v) ? v : undefined;
}

// Height reserved below an image/diagram for its !caption text, mirroring
// the web renderer's .sl-caption. Callers shrink the image area by this much
// before placing the caption in the freed strip.
const CAPTION_H = 0.28;

function addCaption(s: PS, caption: string | undefined, t: Theme, x: number, y: number, w: number) {
  if (!caption) return;
  s.addText(caption, {
    x, y, w, h: CAPTION_H,
    fontSize: 10, italic: true,
    color: hex(t.colors.text),
    fontFace: firstFont(t.fonts.body),
    align: 'center', valign: 'top',
  });
}

function containArea(area: Area, aspectRatio: number): Area {
  const areaAspect = area.w / area.h;
  if (aspectRatio > areaAspect) {
    // Width-limited: fill width, reduce height
    const h = area.w / aspectRatio;
    return { x: area.x, y: area.y + (area.h - h) / 2, w: area.w, h };
  } else {
    // Height-limited: fill height, reduce width
    const w = area.h * aspectRatio;
    return { x: area.x + (area.w - w) / 2, y: area.y, w, h: area.h };
  }
}

function tryAddImage(s: PS, src: string, area: Area, warnings: string[], aspectRatio?: number) {
  if (!src) return;
  const placed = aspectRatio ? containArea(area, aspectRatio) : area;
  if (src.startsWith('data:')) {
    try {
      s.addImage({ data: src, x: placed.x, y: placed.y, w: placed.w, h: placed.h });
    } catch {
      warnings.push(`Embedded image could not be added to PPTX: ${src.slice(0, 60)}…`);
    }
    return;
  }
  // Do NOT pass http/https URLs to PptxGenJS — it would attempt its own XHR fetch
  // during write(), which is blocked by CSP on macOS WKWebView and throws, killing
  // the entire export. All remote images should have been pre-resolved to data: URLs
  // by resolveSlideImages; reaching here means the fetch failed, so skip gracefully.
  warnings.push(`Image skipped (could not be fetched): ${src.slice(0, 80)}`);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function hex(color: string): string {
  const h = color.replace('#', '').toUpperCase();
  return h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
}

// Convert any CSS colour value accepted by the parser into the 6-digit hex
// string PptxGenJS requires. `parseColorValue` in the parser already blocks
// injection-y values, so only legit colours reach here.
//
// Resolution order (per review of #150): resolve via the DOM first. A browser
// (and jsdom) normalises every sRGB-compatible colour — hex, named colours,
// `hsl()`/`hwb()`, and all modern notations like `lab()/lch()/oklab()/oklch()`
// — to `rgb(...)`, so this single path covers far more than a hand-maintained
// table ever could (and survives future CSS additions). We fall back to a local
// converter for exotic notations the DOM left unresolved (e.g. `oklch()` under
// jsdom) or for DOM-less contexts.
function cssColorToHex(color: string, fallback = '000000'): string {
  const v = (color ?? '').trim();
  if (!v) return hex(fallback);

  // 1) DOM resolution — normalises to `rgb(...)` wherever the engine supports it.
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const el = document.createElement('div');
    el.style.color = v;
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    document.body.removeChild(el);
    const fromDom = rgbToHex(resolved);
    if (fromDom) return fromDom;
  }

  // 2) Local fallback: hex handling, then the functional/colour notations the
  //    parser accepts, then the named-colour table.

  // #rgb / #rrggbb (with or without leading #) → 6-digit hex
  const h = v.replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{3}$/.test(h)) return h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (/^[0-9A-F]{6}$/.test(h)) return h;
  // #rrggbbaa → drop alpha
  if (/^[0-9A-F]{8}$/.test(h)) return h.slice(0, 6);

  // functional notations rgb()/rgba()/hsl()/hsla()/color()/hwb()/lab()/lch()/oklab()/oklch()
  const fn = v.match(/^(rgb|rgba|hsl|hsla|color|hwb|lab|lch|oklab|oklch)\(\s*(.*?)\s*\)$/i);
  if (fn) {
    const args = fn[2].split(/[\s,/]+/).filter(Boolean);
    const rgb = fn[1].toLowerCase();
    // rgb()/rgba() with numeric channels → hex. hsl()/hsla() are deliberately
    // NOT handled here: their h/s/l channels aren't 0-255 RGB values, so
    // reusing parseCssChannel on them would produce a wrong colour rather than
    // a safe fallback (e.g. hsl(0,100%,50%) red → 00FF80, not FF0000). The DOM
    // resolution path above already covers hsl() correctly for every real
    // call site; this branch only needs rgb()/rgba().
    if ((rgb === 'rgb' || rgb === 'rgba') && args.length >= 3) {
      const r = parseCssChannel(args[0], 255);
      const g = parseCssChannel(args[1], 255);
      const b = parseCssChannel(args[2], 255);
      if (r !== null && g !== null && b !== null) {
        return [r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
      }
    }
    // For `color(...)` with three 0–255-style sRGB channels, keep them.
    if (rgb === 'color') {
      const nums = args.map((a) => parseFloat(a)).filter((n) => !Number.isNaN(n));
      if (nums.length >= 3 && nums.every((n) => n >= 0 && n <= 255)) {
        return nums.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, '0').toUpperCase()).join('');
      }
    }
  }

  // named colours
  const named = NAMED_COLORS[v.toLowerCase()];
  if (named) return named;

  return hex(fallback);
}

// Extract a 6-digit hex from a `rgb(...)` / `rgba(...)` computed-style string.
// Returns null for anything that isn't an rgb family value (e.g. an unresolved
// `oklch(...)`), so the caller can fall through to the local converter.
function rgbToHex(resolved: string): string | null {
  const m = resolved.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const toHex = (n: string) => Math.round(Number(n)).toString(16).padStart(2, '0').toUpperCase();
  return toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
}

// Map a single rgb() channel value: integer 0–255 or percentage 0–100%.
// Returns null when the value isn't a plain channel (e.g. an hsl angle).
function parseCssChannel(token: string | undefined, max: number): number | null {
  if (!token) return null;
  if (/^\d+(\.\d+)?%$/.test(token)) {
    return Math.round((parseFloat(token) / 100) * max);
  }
  if (/^\d+(\.\d+)?$/.test(token)) {
    return Math.round(Math.min(max, Math.max(0, parseFloat(token))));
  }
  return null;
}

// CSS named colours commonly used for slide text. Marp decks frequently use
// bare names like `white`/`red`; the parser's colour validator already blocks
// anything containing spaces/quotes/`;{}/`, so this only resolves valid names.
const NAMED_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', lime: '00FF00',
  blue: '0000FF', yellow: 'FFFF00', cyan: '00FFFF', aqua: '00FFFF', magenta: 'FF00FF',
  fuchsia: 'FF00FF', silver: 'C0C0C0', gray: '808080', grey: '808080', maroon: '800000',
  olive: '808000', purple: '800080', teal: '008080', navy: '000080', orange: 'FFA500',
  pink: 'FFC0CB', brown: 'A52A2A', gold: 'FFD700', indigo: '4B0082', violet: 'EE82EE',
  turquoise: '40E0D0', salmon: 'FA8072', crimson: 'DC143C', tomato: 'FF6347',
  coral: 'FF7F50', khaki: 'F0E68C', plum: 'DDA0DD', orchid: 'DA70D6', slateblue: '6A5ACD',
  steelblue: '4682B4', skyblue: '87CEEB', lightblue: 'ADD8E6', darkblue: '00008B',
  darkgreen: '006400', darkred: '8B0000', darkgray: 'A9A9A9', darkgrey: 'A9A9A9',
  lightgray: 'D3D3D3', lightgrey: 'D3D3D3', midnightblue: '191970', rebeccapurple: '663399',
  dodgerblue: '1E90FF', forestgreen: '228B22', firebrick: 'B22222', hotpink: 'FF69B4',
  chocolate: 'D2691E', peru: 'CD853F', saddlebrown: '8B4513', sienna: 'A0522D',
  indianred: 'CD5C5C', rosybrown: 'BC8F8F', dimgray: '696969', dimgrey: '696969',
  lightslategray: '778899', lightslategrey: '778899', slategray: '708090', slategrey: '708090',
  darkslategray: '2F4F4F', darkslategrey: '2F4F4F', whitesmoke: 'F5F5F5', snow: 'FFFAFA',
  gainsboro: 'DCDCDC', lightcoral: 'F08080', palevioletred: 'DB7093', mediumvioletred: 'C71585',
  deeppink: 'FF1493', orangered: 'FF4500', darkorange: 'FF8C00', darkgoldenrod: 'B8860B',
  goldenrod: 'DAA520', darkkhaki: 'BDB76B', yellowgreen: '9ACD32', lawngreen: '7CFC00',
  chartreuse: '7FFF00', greenyellow: 'ADFF2F', springgreen: '00FF7F', mediumspringgreen: '00FA9A',
  aquamarine: '7FFFD4', mediumaquamarine: '66CDAA', lightseagreen: '20B2AA',
  cadetblue: '5F9EA0', darkturquoise: '00CED1', mediumturquoise: '48D1CC', powderblue: 'B0E0E6',
  lightcyan: 'E0FFFF', paleturquoise: 'AFEEEE', lightsteelblue: 'B0C4DE', cornflowerblue: '6495ED',
  royalblue: '4169E1', mediumblue: '0000CD', mediumslateblue: '7B68EE', blueviolet: '8A2BE2',
  darkviolet: '9400D3', darkorchid: '9932CC', mediumorchid: 'BA55D3', thistle: 'D8BFD8',
  lavender: 'E6E6FA', mistyrose: 'FFE4E1', antiquewhite: 'FAEBD7', linen: 'FAF0E6',
  oldlace: 'FDF5E6', floralwhite: 'FFFAF0', ivory: 'FFFFF0', beige: 'F5F5DC', wheat: 'F5DEB3',
  burlywood: 'DEB887', tan: 'D2B48C', moccasin: 'FFE4B5', navajowhite: 'FFDEAD',
  peachpuff: 'FFDAB9', bisque: 'FFE4C4', blanchedalmond: 'FFEBCD', cornsilk: 'FFF8DC',
  lemonchiffon: 'FFFACD', lightgoldenrodyellow: 'FAFAD2', palegoldenrod: 'EEE8AA',
  darkolivegreen: '556B2F', olivedrab: '6B8E23', seagreen: '2E8B57', mediumseagreen: '3CB371',
  lightgreen: '90EE90', darkseagreen: '8FBC8F', darkcyan: '008B8B',
  lightyellow: 'FFFFE0', honeydew: 'F0FFF0', mintcream: 'F5FFFA', azure: 'F0FFFF',
  aliceblue: 'F0F8FF', ghostwhite: 'F8F8FF', lavenderblush: 'FFF0F5', seashell: 'FFF5EE',
  mediumpurple: '9370DB', darkslateblue: '483D8B',
  // Remaining standard CSS keyword names (the DOM path resolves these in a
  // real browser; listed here so the local fallback stays complete).
  darkmagenta: '8B008B', darksalmon: 'E9967A', deepskyblue: '00BFFF',
  lightpink: 'FFB6C1', lightsalmon: 'FFA07A', lightskyblue: '87CEFA',
  limegreen: '32CD32', palegreen: '98FB98', papayawhip: 'FFEFD5', sandybrown: 'F4A460',
};

function firstFont(stack: string): string {
  return stack.split(',')[0].trim().replace(/['"]/g, '');
}

function stripHtml(html: string): string {
  const withAltText = html.replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, '$1');
  // Use the DOM (as htmlToInlineRuns/hljsHtmlToRuns already do elsewhere in
  // this file) rather than a tag-stripping regex followed by hand-rolled
  // entity decoding — inlineToHtml() escapes & < > into entities, and
  // textContent decodes them back correctly (including numeric entities),
  // instead of leaving e.g. "AT&amp;T" as literal text in the exported pptx.
  // Walk with the same KaTeX helper as htmlToInlineRuns so table cells don't
  // reintroduce the MathML+HTML duplication (issue #170 / PR #174 review).
  const div = document.createElement('div');
  div.innerHTML = withAltText;
  return flattenHtmlText(div);
}

/** Plain-text flatten that collapses KaTeX roots to a single TeX fragment. */
function flattenHtmlText(root: Node): string {
  let out = '';
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tex = katexTexSource(el);
    if (tex !== null) {
      out += tex;
      return;
    }
    if (el.classList?.contains('katex')) {
      el.querySelector('.katex-mathml')?.remove();
    }
    for (const child of node.childNodes) walk(child);
  }
  walk(root);
  return out;
}
