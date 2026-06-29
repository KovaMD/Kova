import PptxGenJS from 'pptxgenjs';
import { invoke } from '@tauri-apps/api/core';
import { mermaidSvgCache } from './mermaidSvgCache';
import { svgToPngDataUrl } from './svgToPng';
import { queuedMermaidRender } from './mermaidRenderQueue';
import mermaid from 'mermaid';
import hljs from 'highlight.js';
import type { Slide, SlideElement, Frontmatter } from '../types';
import type { Theme } from '../theme';
import { resolveTemplate, hexToHsl, hslToHex, defaultChartPalette } from '../theme';

mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'antiscript' });

// ── Mermaid rendering helpers ─────────────────────────────────────────────────

function buildCScalePalette(accent: string): Record<string, string> {
  const [h, rawS, rawL] = hexToHsl(accent);
  const s = Math.min(Math.max(rawS, 0.50), 0.80);
  const l = Math.min(Math.max(rawL, 0.38), 0.58);
  const out: Record<string, string> = {};
  for (let i = 0; i < 12; i++) out[`cScale${i}`] = hslToHex(h + i * 30, s, l);
  return out;
}

function piePaletteFromAccent(accent: string): Record<string, string> {
  const [h, rawS, rawL] = hexToHsl(accent);
  const s = Math.min(Math.max(rawS, 0.55), 0.85);
  const l = Math.min(Math.max(rawL, 0.28), 0.48);
  const out: Record<string, string> = {};
  for (let i = 0; i < 12; i++) out[`pie${i + 1}`] = hslToHex(h + i * 30, s, l);
  return out;
}

function parseChannels(bare6: string): [number, number, number] {
  return [parseInt(bare6.slice(0,2),16), parseInt(bare6.slice(2,4),16), parseInt(bare6.slice(4,6),16)];
}

function diagramContrastText(color: string): string {
  const [r, g, b] = parseChannels(color.replace('#', '').toUpperCase());
  return (0.2126 * r/255 + 0.7152 * g/255 + 0.0722 * b/255) > 0.35 ? '#111111' : '#FFFFFF';
}

function diagramMutedSecondary(primaryHex: string): string {
  const [h, s, l] = hexToHsl(primaryHex);
  return hslToHex(h, Math.min(s, 0.35), l < 0.5 ? Math.min(l + 0.20, 0.45) : Math.max(l - 0.20, 0.55));
}

function buildExportMermaidInit(t: Theme): string {
  const c = t.colors;
  const ff = (stack: string) => stack.split(',')[0].trim().replace(/['"]/g, '');
  const customPalette = c.chart_colors && c.chart_colors.length > 0 ? c.chart_colors : null;
  let pie: Record<string, string>, cScale: Record<string, string>, xy: string;
  if (customPalette) {
    pie = {}; cScale = {};
    for (let i = 0; i < 12; i++) { pie[`pie${i + 1}`] = customPalette[i % customPalette.length]; cScale[`cScale${i}`] = customPalette[i % customPalette.length]; }
    xy = customPalette.join(',');
  } else {
    pie = piePaletteFromAccent(c.accent);
    cScale = buildCScalePalette(c.accent);
    xy = defaultChartPalette(c.accent).join(',');
  }
  const secondary = diagramMutedSecondary(c.primary);
  const tertiaryBg = c.code_bg;
  const vars = {
    primaryColor: c.primary, primaryTextColor: diagramContrastText(c.primary),
    primaryBorderColor: c.primary, lineColor: c.accent,
    secondaryColor: secondary, secondaryTextColor: diagramContrastText(secondary),
    tertiaryColor: tertiaryBg, tertiaryTextColor: diagramContrastText(tertiaryBg),
    background: c.background, mainBkg: c.primary, nodeBorder: c.primary,
    clusterBkg: tertiaryBg, titleColor: c.text, edgeLabelBackground: c.background,
    fontFamily: ff(t.fonts.body), ...cScale, ...pie,
    pieTitleTextColor: c.text, pieSectionTextColor: c.title_text,
    pieLegendTextColor: c.text, pieStrokeColor: c.background,
    pieStrokeWidth: '2px', pieOpacity: '0.9',
    xyChart: {
      plotColorPalette: xy, titleColor: c.text, dataLabelColor: c.text,
      xAxisTitleColor: c.text, xAxisLabelColor: c.text, xAxisTickColor: c.text, xAxisLineColor: c.text,
      yAxisTitleColor: c.text, yAxisLabelColor: c.text, yAxisTickColor: c.text, yAxisLineColor: c.text,
    },
  };
  return `%%{init: ${JSON.stringify({ theme: 'base', themeVariables: vars })}}%%\n`;
}


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
  const normalised = value.replace(/\\n/g, '<br/>');
  const id = `pptx-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const src = normalised.trimStart().startsWith('%%{') ? normalised : init + normalised;
    const { svg } = await queuedMermaidRender(id, src);
    return await svgToPngDataUrl(svg, t.colors.background);
  } catch {
    return null;
  }
}

const W = 10; // slide width is always 10" regardless of ratio
const M = 0.5;     // standard margin
const HEAD_H = 0.4;
const FOOT_H = 0.35;

interface Meta { docTitle: string; docDate: string; slideNum: number; totalSlides: number }
interface Area { x: number; y: number; w: number; h: number }

// ── Entry point ───────────────────────────────────────────────────────────────

export interface ExportResult { base64: string; warnings: string[] }

function extToMime(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif')  return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg')  return 'image/svg+xml';
  return 'image/png';
}

async function assetUrlToDataUrl(src: string): Promise<string> {
  try {
    // asset:// URLs are user files served via Tauri's asset protocol.
    // fetch() on macOS WKWebView cannot reach asset:// because connect-src
    // does not include asset:. Read the file natively instead.
    if (src.startsWith('asset://')) {
      const path = decodeURIComponent(src.replace(/^asset:\/\/[^/]*/, ''));
      const ext  = path.split('.').pop()?.toLowerCase() ?? 'png';
      const b64  = await invoke<string>('read_file_b64', { path });
      return `data:${extToMime(ext)};base64,${b64}`;
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
          // For portrait diagrams (AR < 1) containArea places them in a narrow
          // column, making text illegibly small. Omit the AR so tryAddImage fills
          // the available area instead — the slight horizontal stretch is far
          // more readable than 4-5pt text. Landscape diagrams keep containArea.
          const arTitle = result.aspectRatio >= 1 ? String(result.aspectRatio) : undefined;
          elements.push({ type: 'image' as const, src: result.dataUrl, alt: 'Diagram', title: arTitle });
        } else {
          warnings.push(`Mermaid diagram could not be rendered and was skipped (slide: "${slide.title ?? 'untitled'}")`);
          elements.push(el);
        }
      } else {
        elements.push(el);
      }
    }
    resolved.push({ ...slide, elements });
  }
  return resolved;
}

export async function exportToPptx(
  slides: Slide[],
  frontmatter: Frontmatter,
  theme: Theme,
): Promise<ExportResult> {
  const pres = new PptxGenJS();
  const is4x3 = (frontmatter.aspect_ratio as string | undefined) === '4:3';
  // LAYOUT_16x9 = 10" × 5.625", which matches W=10 and H=5.625 below.
  // LAYOUT_WIDE is 13.33" × 7.5" — using that with W=10 would misplace everything.
  pres.layout = is4x3 ? 'LAYOUT_4x3' : 'LAYOUT_16x9';
  const H = is4x3 ? 7.5 : 5.625;

  const docTitle = frontmatter.title ?? '';
  const docDate  = frontmatter.date != null ? String(frontmatter.date) : '';
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
    const meta: Meta = { docTitle, docDate, slideNum: i + 1, totalSlides: slides.length };
    addSlide(pSlide as PS, resolvedSlides[i], theme, meta, H, warnings, logoDataUrl, logoAr);
  }

  const base64 = (await pres.write({ outputType: 'base64' })) as string;
  return { base64, warnings };
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

  switch (slide.layout) {
    case 'title':         addTitleSlide(s, slide, t, cy, ch); break;
    case 'section':       addSectionSlide(s, slide, t, cy, ch); break;
    case 'title-content': addTitleContentSlide(s, slide, t, cy, ch, warnings); break;
    case 'title-image':   addTitleImageSlide(s, slide, t, cy, ch, warnings); break;
    case 'split':         addSplitSlide(s, slide, t, cy, ch, warnings); break;
    case 'full-bleed':    addFullBleedSlide(s, slide, t, H, warnings); break;
    case 'quote':         addQuoteSlide(s, slide, t, cy, ch); break;
    case 'two-column':    addTwoColumnSlide(s, slide, t, cy, ch, warnings); break;
    case 'bsp':           addBspSlide(s, slide, t, cy, ch, warnings); break;
    case 'grid':          addGridSlide(s, slide, t, cy, ch, warnings); break;
    case 'media':         addMediaSlide(s, slide, t, cy, ch); break;
    case 'code':          addCodeSlide(s, slide, t, cy, ch, warnings); break;
    case 'math':          addTitleContentSlide(s, slide, t, cy, ch, warnings); break;
    case 'blank':         addBlankSlide(s, t); break;
    default:              addTitleContentSlide(s, slide, t, cy, ch, warnings);
  }

  if (hasHead) addHeaderBar(s, t, meta);
  if (hasFoot) addFooterBar(s, t, meta, H);
  if (logoDataUrl) addLogo(s, logoDataUrl, logoAr, t.logo_position, t.logo_opacity, H);
  if (slide.references.length > 0) addReferences(s, slide.references, t, H, hasFoot);
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

function addTitleContentSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.85 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 28, bold: true,
      color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, valign: 'middle', wrap: true, shrinkText: true,
    });
  }
  addElements(s, slide.elements, t, { x: M, y: cy + hh + 0.1, w: W - M * 2, h: ch - hh - 0.1 }, warnings);
}

function addTitleImageSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  // 3% gap mirrors .sl-split__body { gap: 3% } in CSS
  const GAP  = 0.3;
  const colW = (W - M * 2 - GAP) / 2;

  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: colW, h: ch,
      fontSize: 26, bold: true,
      color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.title),
      align: 'left', valign: 'middle', wrap: true, shrinkText: true,
    });
  }
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    tryAddImage(s, img.src, { x: M + colW + GAP, y: cy, w: colW, h: ch }, warnings, imgAr(img));
  }
}

function addSplitSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.text),
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

  if (imgOnRight) {
    addElements(s, rest, t, { x: M, y: bodyY, w: colW, h: bodyH }, warnings);
    if (img && img.type === 'image') {
      tryAddImage(s, img.src, { x: M + colW + 0.3, y: bodyY, w: colW, h: bodyH }, warnings, ar);
    }
  } else {
    if (img && img.type === 'image') {
      tryAddImage(s, img.src, { x: M, y: bodyY, w: colW, h: bodyH }, warnings, ar);
    }
    addElements(s, rest, t, { x: M + colW + 0.3, y: bodyY, w: colW, h: bodyH }, warnings);
  }
}

function addFullBleedSlide(s: PS, slide: Slide, t: Theme, H: number, warnings: string[]) {
  // Use background colour as fallback so a missing image doesn't render as a
  // dark primary-coloured slide that looks like a broken title slide.
  s.background = { fill: hex(t.colors.background) };
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    tryAddImage(s, img.src, { x: 0, y: 0, w: W, h: H }, warnings);
  }
}

function addQuoteSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number) {
  s.background = { fill: hex(t.colors.background) };
  const bq = slide.elements.find((e) => e.type === 'blockquote');
  if (!bq || bq.type !== 'blockquote') return;
  const attrH  = bq.attribution ? 0.5 : 0;
  const quoteH = ch - attrH - 0.15;

  s.addText(`“${bq.text}”`, {
    x: M + 0.5, y: cy, w: W - M * 2 - 1, h: quoteH,
    fontSize: 24, italic: true,
    color: hex(t.colors.text),
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

function addTwoColumnSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const colW  = (W - M * 2 - 0.3) / 2;
  const bi    = slide.elements.findIndex((e) => e.type === 'column-break');

  let left: SlideElement[];
  let right: SlideElement[];
  if (bi >= 0) {
    left  = slide.elements.slice(0, bi);
    right = slide.elements.slice(bi + 1);
  } else {
    [left, right] = autoSplitElements(slide.elements);
  }

  addElements(s, left,  t, { x: M,               y: bodyY, w: colW, h: bodyH }, warnings);
  addElements(s, right, t, { x: M + colW + 0.3,  y: bodyY, w: colW, h: bodyH }, warnings);
}

function addBspSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.text),
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
    addElements(s, slide.elements, t, { x: M, y: bodyY, w: W - M * 2, h: bodyH }, warnings);
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

  addElements(s, leftGroup, t, { x: M, y: bodyY, w: colW, h: bodyH }, warnings);

  if (rightGroups.length === 1) {
    addElements(s, rightGroups[0], t, { x: M + colW + GAP, y: bodyY, w: colW, h: bodyH }, warnings);
  } else {
    const subH = (bodyH - 0.2) / 2;
    addElements(s, rightGroups[0], t, { x: M + colW + GAP, y: bodyY,              w: colW, h: subH }, warnings);
    if (rightGroups[1]) {
      addElements(s, rightGroups[1], t, { x: M + colW + GAP, y: bodyY + subH + 0.2, w: colW, h: subH }, warnings);
    }
  }
}

function addGridSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.text),
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
    }, warnings);
  });
}

function addMediaSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const yt    = slide.elements.find((e) => e.type === 'youtube');
  const poll  = slide.elements.find((e) => e.type === 'poll');

  const both  = yt && poll;
  const halfH = (bodyH - 0.2) / 2;

  if (yt && yt.type === 'youtube') {
    s.addText([
      { text: '▶ ', options: { fontSize: 30, bold: true } },
      { text: yt.label || 'YouTube Video', options: { fontSize: 20, breakLine: true } },
      { text: yt.url, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: bodyY, w: W - M * 2, h: both ? halfH : bodyH,
      color: hex(t.colors.text), fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  }
  if (poll && poll.type === 'poll') {
    const pollY = both ? bodyY + halfH + 0.2 : bodyY;
    s.addText([
      { text: poll.label || 'Poll', options: { fontSize: 20, bold: true, breakLine: true } },
      { text: poll.url, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: pollY, w: W - M * 2, h: both ? halfH : bodyH,
      color: hex(t.colors.text), fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  }
}

function addCodeSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.text),
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
    tryAddImage(s, imgEl.src, { x: M, y: codeY, w: W - M * 2, h: codeH }, warnings, isFinite(ar) ? ar : undefined);
    return;
  }

  const codeEl = slide.elements.find((e) => e.type === 'code' || e.type === 'mermaid');
  if (!codeEl) return;

  addCodeBlock(s, codeEl.value, codeEl.type === 'code' ? codeEl.lang : undefined, t,
    { x: M, y: codeY, w: W - M * 2, h: codeH });
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

function addReferences(s: PS, refs: string[], t: Theme, H: number, hasFoot: boolean) {
  const REF_H = Math.min(0.06 + refs.length * 0.17, H * 0.35);
  const bottomPad = hasFoot ? FOOT_H + 0.08 : 0.15;
  const color = blendColor(t.colors.text, t.colors.background, 0.60);
  const runs = refs.map((ref, i) => ({
    text: ref,
    options: { fontSize: 7, breakLine: i < refs.length - 1, color },
  }));
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
) {
  if (segments.length <= 1) {
    s.addText(segments[0] ?? '', { x, y, w, h, fontSize, color, fontFace, align: 'left', valign: 'middle' });
    return;
  }
  const [left = '', center = '', ...rest] = segments;
  const right = rest.join(' | ');
  const colW = w / 3;
  if (left)   s.addText(left,   { x,            y, w: colW, h, fontSize, color, fontFace, align: 'left',   valign: 'middle' });
  if (center) s.addText(center, { x: x + colW,  y, w: colW, h, fontSize, color, fontFace, align: 'center', valign: 'middle' });
  if (right)  s.addText(right,  { x: x + colW * 2, y, w: colW, h, fontSize, color, fontFace, align: 'right',  valign: 'middle' });
}

function addHeaderBar(s: PS, t: Theme, meta: Meta) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: HEAD_H,
    fill: { color: hex(t.colors.primary) },
    line: { type: 'none' },
  });
  const vars = { title: meta.docTitle, date: meta.docDate, slideNumber: meta.slideNum, totalSlides: meta.totalSlides };
  const segs = t.header.text.split('|').map((p) => resolveTemplate(p.trim(), vars));
  if (segs.some(Boolean)) {
    addBarText(s, segs, M, 0, W - M * 2, HEAD_H, 10, hex(t.colors.title_text), firstFont(t.fonts.body));
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
  const vars = { title: meta.docTitle, date: meta.docDate, slideNumber: meta.slideNum, totalSlides: meta.totalSlides };
  const segs = t.footer.text.split('|').map((p) => resolveTemplate(p.trim(), vars));
  const textW = W - M * 2 - (showNum ? 1.1 : 0);
  if (segs.some(Boolean)) {
    addBarText(s, segs, M, footY + 0.02, textW, FOOT_H - 0.02, 9, hex(t.colors.text), firstFont(t.fonts.body));
  }
  if (showNum) {
    s.addText(`${meta.slideNum} / ${meta.totalSlides}`, {
      x: W - M - 1.1, y: footY + 0.02, w: 1.1, h: FOOT_H - 0.02,
      fontSize: 9, color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.body),
      align: 'right', valign: 'middle',
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
    s.addImage({ data: logoDataUrl, x: lx, y: ly, w: LOGO_W, h: LOGO_H, transparency });
  } catch { /* ignore */ }
}

// ── Layout helpers (mirror SlideRenderer.tsx) ─────────────────────────────────

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

function autoSplitElements(elements: SlideElement[]): [SlideElement[], SlideElement[]] {
  if (elements.length === 1 && elements[0].type === 'list') {
    const list = elements[0];
    const mid = Math.ceil(list.items.length / 2);
    return [
      [{ ...list, items: list.items.slice(0, mid) }],
      [{ ...list, items: list.items.slice(mid) }],
    ];
  }
  const mid = Math.ceil(elements.length / 2);
  return [elements.slice(0, mid), elements.slice(mid)];
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

// Walk markdown-generated HTML (bold, italic, code, links) into PptxGenJS runs.
function htmlToInlineRuns(
  html: string,
  defaultColor: string,
  codeFont: string,
  accentColor: string,
): PptxRun[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const runs: PptxRun[] = [];

  function walk(node: Node, bold: boolean, italic: boolean, isCode: boolean, color: string) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (!text) return;
      runs.push({
        text,
        options: {
          color,
          ...(bold   ? { bold: true }   : {}),
          ...(italic ? { italic: true } : {}),
          ...(isCode ? { fontFace: codeFont } : {}),
        },
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      for (const child of node.childNodes) {
        walk(
          child,
          bold   || tag === 'strong' || tag === 'b',
          italic || tag === 'em'     || tag === 'i',
          isCode || tag === 'code',
          tag === 'a' ? accentColor : color,
        );
      }
    }
  }

  for (const child of div.childNodes) walk(child, false, false, false, defaultColor);
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

// ── Styled code block (reused by addCodeSlide and addElements) ────────────────

function addCodeBlock(s: PS, value: string, lang: string | undefined, t: Theme, area: Area) {
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
  s.addShape('rect', {
    x: area.x, y: blockY, w: area.w, h: blockH,
    fill: { color: hex(t.colors.code_bg) },
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

function addElements(s: PS, elements: SlideElement[], t: Theme, area: Area, warnings: string[] = []) {
  if (elements.length === 0) return;

  // Single image fills the area
  if (elements.length === 1 && elements[0].type === 'image') {
    const el = elements[0];
    const ar = el.title ? parseFloat(el.title) : NaN;
    tryAddImage(s, el.src, area, warnings, isFinite(ar) ? ar : undefined);
    return;
  }

  // Single code element — render with full dark-background styling
  if (elements.length === 1 && elements[0].type === 'code') {
    const el = elements[0];
    addCodeBlock(s, el.value, el.lang, t, area);
    return;
  }

  // Build a text run array for all text-based elements
  const runs: Array<{ text: string; options?: Record<string, unknown> }> = [];

  for (const el of elements) {
    switch (el.type) {
      case 'paragraph':
        if (el.text.trim()) {
          runs.push({ text: el.text, options: { fontSize: 18, breakLine: true } });
        }
        break;

      case 'list':
        for (const item of el.items) {
          const bulletBase = {
            bullet: el.ordered ? { type: 'number', style: 'arabicPeriod' } as const : true as const,
            fontSize: 18,
            paraSpaceAfter: 4,
          };
          const itemRuns = htmlToInlineRuns(item.html, hex(t.colors.text), firstFont(t.fonts.code), hex(t.colors.accent));
          runs.push({ text: itemRuns[0].text, options: { ...itemRuns[0].options, ...bulletBase } });
          for (let ri = 1; ri < itemRuns.length; ri++) {
            runs.push({ text: itemRuns[ri].text, options: { fontSize: 18, ...itemRuns[ri].options } });
          }
          for (const child of item.children) {
            const childBase = { bullet: true as const, indentLevel: 1, fontSize: 16, paraSpaceAfter: 3 };
            const childRuns = htmlToInlineRuns(child.html, hex(t.colors.text), firstFont(t.fonts.code), hex(t.colors.accent));
            runs.push({ text: childRuns[0].text, options: { ...childRuns[0].options, ...childBase } });
            for (let ri = 1; ri < childRuns.length; ri++) {
              runs.push({ text: childRuns[ri].text, options: { fontSize: 16, ...childRuns[ri].options } });
            }
          }
        }
        break;

      case 'blockquote':
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
        break;

      case 'code':
        // Code mixed with other elements: fall back to plain monospaced text.
        // (Single-element code is caught above and rendered with full styling.)
        runs.push({ text: el.value, options: { fontFace: firstFont(t.fonts.code), fontSize: 13, breakLine: true } });
        break;

      case 'math':
        runs.push({ text: el.value, options: { fontFace: firstFont(t.fonts.code), fontSize: 15, breakLine: true } });
        break;

      case 'toc':
        for (const entry of el.entries ?? []) {
          runs.push({ text: entry.title, options: { bullet: { type: 'number', style: 'arabicPeriod' } as const, fontSize: 18, paraSpaceAfter: 4, breakLine: true } });
        }
        break;

      // Images and tables handled separately below
      default:
        break;
    }
  }

  if (runs.length > 0) {
    s.addText(runs, {
      x: area.x, y: area.y, w: area.w, h: area.h,
      fontSize: 18, color: hex(t.colors.text),
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
        color: hex(t.colors.text), fontFace: firstFont(t.fonts.body),
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

  // Tables: split remaining height proportionally based on how many text runs precede the table
  const tableEl = elements.find((e) => e.type === 'table');
  if (tableEl && tableEl.type === 'table') {
    const textFrac = runs.length > 0 ? Math.min(0.5, 0.15 + runs.length * 0.08) : 0;
    const tableY = area.y + area.h * textFrac;
    const tableH = area.h * (1 - textFrac - 0.02);
    addTable(s, tableEl, t, { x: area.x, y: tableY, w: area.w, h: tableH });
  }
}

function addTable(
  s: PS,
  el: Extract<SlideElement, { type: 'table' }>,
  t: Theme,
  area: Area,
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
    row.map((cell, i) => ({ text: stripHtml(cell), options: { color: hex(t.colors.text), fontSize: 14, align: colAlign(i) } }))
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

function firstFont(stack: string): string {
  return stack.split(',')[0].trim().replace(/['"]/g, '');
}

function stripHtml(html: string): string {
  return html
    .replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, '$1')
    .replace(/<[^>]+>/g, '');
}
