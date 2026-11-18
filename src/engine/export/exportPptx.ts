import { enginePorts, type AssetLoader } from '../ports';
import { extractYoutubeId } from '../media/youtube';
import { parseChannels } from './mermaidExportTheme';
import { autoSplitElements, explodeListItems, groupProgressRuns, splitByColumnBreaks } from '../layout/elementGrouping';
import hljs from 'highlight.js';
import type { Slide, SlideElement, Frontmatter } from '../types';
import { parseAspectRatio } from '../types';
import type { Theme } from '../theme';
import { resolveDeckMeta, resolveSlideFrame } from '../render/slideModel';
import type { DeckMeta, FooterFrame, SlideFrame } from '../render/slideModel';
import type { PptxSlide, PptxTextRun } from './pptx/pptxTypes';
import { withThemeCodeBg } from './pptx/context';
import { cssColorToHex, hex } from './pptx/colour';
import { TABLE_CELL_HMARGIN, TABLE_CELL_VMARGIN, fitRunsScale, fitTableToArea, scaleRuns } from './pptx/fit';
import type { Area, ElementRenderContext, SlideRenderContext, StepTarget } from './pptx/context';
import { applyPptxPostProcessing, makeStepRegistrar, stepShapeName } from './pptx/timing';
import { resolveSlideImages, resolveThemeLogo, videoExtnFromDataUrl } from './pptx/assets';

const W = 10; // slide width is always 10" regardless of ratio
const M = 0.5;     // standard margin
const HEAD_H = 0.4;
const FOOT_H = 0.35;


// ── Entry point ───────────────────────────────────────────────────────────────

export interface ExportResult { base64: string; warnings: string[] }

export async function exportToPptx(
  slides: Slide[],
  frontmatter: Frontmatter,
  theme: Theme,
  locale: string,
  assets: AssetLoader = enginePorts().assets,
): Promise<ExportResult> {
  // Lazy-loaded: pptxgenjs is only needed once a PPTX export is actually
  // triggered, and shouldn't add weight to the app's initial bundle.
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  // Same ratio parsing as the preview, PDF and presenter, so every output
  // agrees. Width is fixed at W=10", height follows the ratio: 16:9 → 5.625",
  // 4:3 → 7.5", 16:10 → 6.25".
  const ratio = parseAspectRatio(frontmatter.aspect_ratio as string | undefined);
  const H = (W * ratio.h) / ratio.w;
  // LAYOUT_16x9 = 10" × 5.625" and LAYOUT_4x3 = 10" × 7.5" match W=10 above.
  // LAYOUT_WIDE is 13.33" × 7.5" — using that with W=10 would misplace everything.
  // pptxgenjs has no 10" × 6.25" built-in, so 16:10 gets a custom layout.
  if (ratio.w === 4 && ratio.h === 3) {
    pres.layout = 'LAYOUT_4x3';
  } else if (ratio.w === 16 && ratio.h === 10) {
    pres.defineLayout({ name: 'KOVA_16x10', width: W, height: H });
    pres.layout = 'KOVA_16x10';
  } else {
    pres.layout = 'LAYOUT_16x9';
  }

  const deckMeta = resolveDeckMeta(frontmatter, slides, locale);
  const warnings: string[] = [];

  const { logoDataUrl, logoAr } = await resolveThemeLogo(theme, assets);

  const resolvedSlides = await resolveSlideImages(slides, theme, warnings, assets);
  const perSlideStepTargets: StepTarget[][] = [];

  for (let i = 0; i < resolvedSlides.length; i++) {
    const pSlide: PptxSlide = pres.addSlide();
    const stepTargets: StepTarget[] = [];
    const position = { slideNumber: i + 1, totalSlides: slides.length };
    addSlide(pSlide, resolvedSlides[i], theme, deckMeta, position, H, warnings, logoDataUrl, logoAr, stepTargets);
    perSlideStepTargets.push(stepTargets);
  }

  const rawBase64 = (await pres.write({ outputType: 'base64' })) as string;
  const base64 = await applyPptxPostProcessing(rawBase64, perSlideStepTargets);
  return { base64, warnings };
}

// ── Per-slide dispatcher ──────────────────────────────────────────────────────

function addSlide(
  s: PptxSlide, slide: Slide, t: Theme, deckMeta: DeckMeta,
  position: { slideNumber: number; totalSlides: number }, H: number, warnings: string[],
  logoDataUrl: string | null, logoAr: number | null, stepTargets: StepTarget[] = [],
) {
  const frame: SlideFrame = resolveSlideFrame(slide, t, deckMeta, position);
  const hasHead = frame.header.visible;
  const hasFoot = frame.footer.visible;
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
  //
  // Known difference from the preview: the invert code background is only
  // honoured on title-content, code and math (and the default) layouts.
  // Split, two-/three-column, bsp and grid keep the theme code_bg, so those
  // layouts deliberately render through withThemeCodeBg(ctx).
  const { colours } = frame;
  const ctx: SlideRenderContext = {
    s, slide, theme: t,
    area: { x: M, y: cy, w: W - M * 2, h: ch },
    slideH: H,
    colours: {
      text: cssColorToHex(colours.text),
      heading: cssColorToHex(colours.heading),
      bold: cssColorToHex(colours.bold),
      codeBg: colours.codeBgOverride,
    },
    warnings,
    steps: stepTargets,
  };

  if (slide.backgroundImage) {
    const ar = slide.backgroundImage.size === 'contain' ? slide.backgroundImage.aspectRatio : undefined;
    tryAddImage(s, slide.backgroundImage.src, { x: 0, y: 0, w: W, h: H }, warnings, ar);
  }

  switch (slide.layout) {
    case 'title':         addTitleSlide(ctx); break;
    case 'section':       addSectionSlide(ctx); break;
    case 'title-content': addTitleContentSlide(ctx); break;
    case 'title-image':   addTitleImageSlide(ctx); break;
    case 'split':         addSplitSlide(withThemeCodeBg(ctx)); break;
    case 'full-bleed':    addFullBleedSlide(ctx); break;
    case 'quote':         addQuoteSlide(ctx); break;
    case 'two-column':    addMultiColumnSlide(withThemeCodeBg(ctx), 2); break;
    case 'three-column':  addMultiColumnSlide(withThemeCodeBg(ctx), 3); break;
    case 'bsp':           addBspSlide(withThemeCodeBg(ctx)); break;
    case 'grid':          addGridSlide(withThemeCodeBg(ctx)); break;
    case 'media':         addMediaSlide(ctx); break;
    case 'code':          addCodeSlide(ctx); break;
    case 'math':          addTitleContentSlide(ctx); break;
    case 'blank':         addBlankSlide(ctx); break;
    default:              addTitleContentSlide(ctx);
  }

  if (hasHead) addHeaderBar(s, t, frame.header.segments);
  if (hasFoot) addFooterBar(s, t, frame.footer, H);
  if (logoDataUrl && frame.logo.placement !== 'hidden') {
    addLogo(s, logoDataUrl, logoAr, frame.logo.position, frame.logo.opacity, H);
  }
  if (slide.references.length > 0) addReferences(ctx, hasFoot);
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

function addTitleSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
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

function addSectionSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
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

function addTitleContentSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.85 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 28, bold: true,
      color: ctx.colours.heading,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, valign: 'middle', wrap: true, shrinkText: true,
    });
  }
  addElements(ctx, slide.elements, { x: M, y: cy + hh + 0.1, w: W - M * 2, h: ch - hh - 0.1 });
}

function addTitleImageSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  // 3% gap mirrors .sl-split__body { gap: 3% } in CSS
  const GAP  = 0.3;
  const colW = (W - M * 2 - GAP) / 2;

  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: colW, h: ch,
      fontSize: 26, bold: true,
      color: ctx.colours.heading,
      fontFace: firstFont(t.fonts.title),
      align: 'left', valign: 'middle', wrap: true, shrinkText: true,
    });
  }
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    const capH = img.caption ? CAPTION_H : 0;
    const imgArea: Area = { x: M + colW + GAP, y: cy, w: colW, h: ch - capH };
    const objectName = img.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
    tryAddImage(s, img.src, imgArea, warnings, imgAr(img), objectName);
    if (objectName) ctx.steps.push({ step: img.step!, objectName });
    addCaption(s, img.caption, t, M + colW + GAP, cy + ch - capH, colW);
  }
}

function addSplitSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: ctx.colours.heading,
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
    addElements(ctx, rest, { x: M, y: bodyY, w: colW, h: bodyH });
    if (img && img.type === 'image') {
      const imgX = M + colW + 0.3;
      const imgArea: Area = { x: imgX, y: bodyY, w: colW, h: bodyH - capH };
      const objectName = img.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
      tryAddImage(s, img.src, imgArea, warnings, ar, objectName);
      if (objectName) ctx.steps.push({ step: img.step!, objectName });
      addCaption(s, img.caption, t, imgX, bodyY + bodyH - capH, colW);
    }
  } else {
    if (img && img.type === 'image') {
      const imgArea: Area = { x: M, y: bodyY, w: colW, h: bodyH - capH };
      const objectName = img.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
      tryAddImage(s, img.src, imgArea, warnings, ar, objectName);
      if (objectName) ctx.steps.push({ step: img.step!, objectName });
      addCaption(s, img.caption, t, M, bodyY + bodyH - capH, colW);
    }
    addElements(ctx, rest, { x: M + colW + 0.3, y: bodyY, w: colW, h: bodyH });
  }
}

function addFullBleedSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings, slideH: H } = ctx;
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

function addQuoteSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const bq = slide.elements.find((e) => e.type === 'blockquote');
  if (!bq || bq.type !== 'blockquote') return;
  const attrH  = bq.attribution ? 0.5 : 0;
  const quoteH = ch - attrH - 0.15;

  s.addText(`“${bq.text}”`, {
    x: M + 0.5, y: cy, w: W - M * 2 - 1, h: quoteH,
    fontSize: 24, italic: true,
    color: ctx.colours.text,
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

function addMultiColumnSlide(ctx: SlideRenderContext, columns: 2 | 3) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: ctx.colours.heading,
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
    addElements(ctx, group, { x: M + i * (colW + GAP), y: bodyY, w: colW, h: bodyH });
  });
}

function addBspSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: ctx.colours.heading,
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
    addElements(ctx, slide.elements, { x: M, y: bodyY, w: W - M * 2, h: bodyH });
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

  addElements(ctx, leftGroup, { x: M, y: bodyY, w: colW, h: bodyH });

  if (rightGroups.length === 1) {
    addElements(ctx, rightGroups[0], { x: M + colW + GAP, y: bodyY, w: colW, h: bodyH });
  } else {
    const subH = (bodyH - 0.2) / 2;
    addElements(ctx, rightGroups[0], { x: M + colW + GAP, y: bodyY,              w: colW, h: subH });
    if (rightGroups[1]) {
      addElements(ctx, rightGroups[1], { x: M + colW + GAP, y: bodyY + subH + 0.2, w: colW, h: subH });
    }
  }
}

function addGridSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: ctx.colours.heading,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const GAP   = 0.2;
  const cols  = 2;
  const filtered = slide.elements.filter((e) => e.type !== 'column-break');
  const groups   = groupProgressRuns(explodeListItems(filtered));
  const rows     = Math.ceil(groups.length / cols);
  const cellW    = (W - M * 2 - GAP * (cols - 1)) / cols;
  const cellH    = rows > 0 ? (bodyH - GAP * (rows - 1)) / rows : bodyH;

  groups.forEach((group, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    addElements(ctx, group, {
      x: M + col * (cellW + GAP),
      y: bodyY + row * (cellH + GAP),
      w: cellW, h: cellH,
    });
  });
}

function addMediaSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings } = ctx;
  const { y: cy, h: ch } = ctx.area;
  const tc = ctx.colours.text;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: ctx.colours.heading,
      fontFace: firstFont(t.fonts.title),
      align: t.layout.heading_align, wrap: true, shrinkText: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const yt    = slide.elements.find((e) => e.type === 'youtube');
  const vid   = slide.elements.find((e) => e.type === 'video');
  const poll  = slide.elements.find((e) => e.type === 'poll');

  const both  = yt && poll;
  const halfH = (bodyH - 0.2) / 2;
  const full: Area = { x: M, y: bodyY, w: W - M * 2, h: bodyH };
  const ytArea: Area = { x: M, y: bodyY, w: W - M * 2, h: both ? halfH : bodyH };

  if (vid && vid.type === 'video') {
    if (!tryAddLocalVideo(s, vid.src, full, warnings)) {
      addMediaTextFallback(ctx, vid.label || 'Video', vid.src, full);
    }
  }

  if (yt && yt.type === 'youtube') {
    if (!tryAddOnlineVideo(s, yt.url, ytArea, warnings)) {
      addMediaTextFallback(ctx, yt.label || 'YouTube Video', yt.url, ytArea);
    }
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

function addMediaTextFallback(
  ctx: ElementRenderContext,
  label: string,
  detail: string,
  area: Area,
) {
  const { s, theme: t } = ctx;
  s.addText([
    { text: '▶ ', options: { fontSize: 30, bold: true } },
    { text: label, options: { fontSize: 20, breakLine: true } },
    { text: detail, options: { fontSize: 11, color: hex(t.colors.accent) } },
  ], {
    x: area.x, y: area.y, w: area.w, h: area.h,
    color: ctx.colours.text, fontFace: firstFont(t.fonts.body),
    align: 'center', valign: 'middle', wrap: true,
  });
}

/** Embed a YouTube URL as an online media object (desktop PowerPoint). */
function tryAddOnlineVideo(s: PptxSlide, url: string, area: Area, warnings: string[]): boolean {
  const id = extractYoutubeId(url);
  if (!id) return false;
  try {
    s.addMedia({
      type: 'online',
      link: `https://www.youtube.com/embed/${id}`,
      x: area.x, y: area.y, w: area.w, h: area.h,
    });
    return true;
  } catch {
    warnings.push(`YouTube embed could not be added to PPTX: ${url.slice(0, 80)}`);
    return false;
  }
}

/** Embed a pre-resolved `data:` video via pptxgenjs `addMedia`. */
function tryAddLocalVideo(s: PptxSlide, src: string, area: Area, warnings: string[]): boolean {
  if (!src.startsWith('data:')) {
    warnings.push(`Video skipped (could not be fetched): ${src.slice(0, 80)}`);
    return false;
  }
  try {
    s.addMedia({
      type: 'video',
      data: src,
      extn: videoExtnFromDataUrl(src),
      x: area.x, y: area.y, w: area.w, h: area.h,
    });
    return true;
  } catch {
    warnings.push(`Embedded video could not be added to PPTX: ${src.slice(0, 60)}…`);
    return false;
  }
}

function addCodeSlide(ctx: SlideRenderContext) {
  const { s, slide, theme: t, warnings } = ctx;
  const { y: cy, h: ch } = ctx.area;
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: ctx.colours.heading,
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
    const imgArea: Area = { x: M, y: codeY, w: W - M * 2, h: codeH - capH };
    const objectName = imgEl.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
    tryAddImage(s, imgEl.src, imgArea, warnings, isFinite(ar) ? ar : undefined, objectName);
    if (objectName) ctx.steps.push({ step: imgEl.step!, objectName });
    addCaption(s, imgEl.caption, t, M, codeY + codeH - capH, W - M * 2);
    return;
  }

  const codeEl = slide.elements.find((e) => e.type === 'code' || e.type === 'mermaid');
  if (!codeEl) return;

  addCodeBlock(ctx, codeEl.value, codeEl.type === 'code' ? codeEl.lang : undefined,
    { x: M, y: codeY, w: W - M * 2, h: codeH }, codeEl.step);
}

function addBlankSlide(ctx: SlideRenderContext) {
  ctx.s.background = { fill: hex(ctx.theme.colors.background) };
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

function addReferences(ctx: SlideRenderContext, hasFoot: boolean) {
  const { s, theme: t, slideH: H } = ctx;
  const refs = ctx.slide.references;
  const tc = ctx.colours.text;
  const REF_H = Math.min(0.06 + refs.length * 0.17, H * 0.35);
  const bottomPad = hasFoot ? FOOT_H + 0.08 : 0.15;
  const color = blendColor(tc, t.colors.background, 0.60);
  const codeFont = firstFont(t.fonts.code);
  const accentColor = hex(t.colors.accent);
  const runs = refs.flatMap((ref, i) => {
    const refRuns = htmlToInlineRuns(ref, color, codeFont, accentColor, pptxIconFont(t), color);
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
  s: PptxSlide,
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

function addHeaderBar(s: PptxSlide, t: Theme, segs: string[]) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: HEAD_H,
    fill: { color: hex(t.colors.primary) },
    line: { type: 'none' },
  });
  if (segs.some(Boolean)) {
    addBarText(s, segs, M, 0, W - M * 2, HEAD_H, 10, hex(t.colors.title_text), firstFont(t.fonts.body), 'kova:header-text');
  }
}

function addFooterBar(s: PptxSlide, t: Theme, footer: FooterFrame, H: number) {
  // The CSS footer renders as a thin border-top line, not a filled bar —
  // use a thin accent-coloured rectangle to match the live preview.
  const footY = H - FOOT_H;
  s.addShape('rect', {
    x: 0, y: footY, w: W, h: 0.02,
    fill: { color: hex(t.colors.accent) },
    line: { type: 'none' },
  });
  const showNum = footer.showSlideNumber;
  const segs = footer.segments;
  const textW = W - M * 2 - (showNum ? 1.1 : 0);
  if (footer.hasText) {
    addBarText(s, segs, M, footY + 0.02, textW, FOOT_H - 0.02, 9, hex(t.colors.text), firstFont(t.fonts.body), 'kova:footer-text');
  }
  if (showNum) {
    // PPTX keeps its "n / total" label; the preview shows only "n" (known
    // difference, the model exposes just the numbers).
    s.addText(`${footer.slideNumber} / ${footer.totalSlides}`, {
      x: W - M - 1.1, y: footY + 0.02, w: 1.1, h: FOOT_H - 0.02,
      fontSize: 9, color: hex(t.colors.text),
      fontFace: firstFont(t.fonts.body),
      align: 'right', valign: 'middle',
      objectName: 'kova:slidenum',
    });
  }
}

function addLogo(
  s: PptxSlide,
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
  isIcon: boolean;
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
  iconFont: string,
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
          // Icon glyphs always need their own font regardless of surrounding
          // code/bold/italic formatting — checked first so an icon inside a
          // stray `isCode` context (shouldn't happen, but not load-bearing on
          // the parser never producing one) still gets the right glyph.
          // No vertical lift to match .sl-icon's 0.05em (issue #282): the only
          // run-level offset is `baseline`, which PowerPoint and LibreOffice
          // treat as superscript and shrink the glyph to ~60%.
          ...(f.isIcon ? { fontFace: iconFont }
            : f.isCode ? { fontFace: codeFont } : {}),
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
          isIcon: f.isIcon || (tag === 'span' && el.classList?.contains('sl-icon')),
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
      bold: false, italic: false, isCode: false, isIcon: false, strike: false, underline: false,
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

function addCalloutBlock(
  ctx: ElementRenderContext, el: Extract<SlideElement, { type: 'blockquote' }>, area: Area, step?: number,
) {
  const { s, theme: t, steps: stepTargets } = ctx;
  const tc = ctx.colours.text;
  const color = CALLOUT_COLORS[el.calloutType ?? 'note'] ?? CALLOUT_COLORS.note;
  const BAR_W = 0.06;
  const PAD   = 0.15;

  // Background, accent bar, title, and body all reveal together on one click.
  const { stepName, registerStep } = makeStepRegistrar(step, area, 'callout', stepTargets);

  const bgName = stepName();
  s.addShape('rect', {
    x: area.x, y: area.y, w: area.w, h: area.h,
    fill: { color: hex(t.colors.background) },
    line: { color: hex(color), width: 0.75, transparency: 60 },
    ...(bgName ? { objectName: bgName } : {}),
  });
  registerStep(bgName);

  const barName = stepName();
  s.addShape('rect', {
    x: area.x, y: area.y, w: BAR_W, h: area.h,
    fill: { color: hex(color) },
    line: { type: 'none' },
    ...(barName ? { objectName: barName } : {}),
  });
  registerStep(barName);

  const titleH = 0.35;
  const titleName = stepName();
  s.addText(el.title ?? '', {
    x: area.x + BAR_W + PAD, y: area.y + PAD * 0.5, w: area.w - BAR_W - PAD * 1.5, h: titleH,
    fontSize: 15, bold: true,
    color: hex(color),
    fontFace: firstFont(t.fonts.body),
    valign: 'top',
    ...(titleName ? { objectName: titleName } : {}),
  });
  registerStep(titleName);

  if (el.text.trim()) {
    const bodyName = stepName();
    s.addText(el.text, {
      x: area.x + BAR_W + PAD, y: area.y + PAD * 0.5 + titleH, w: area.w - BAR_W - PAD * 1.5, h: area.h - titleH - PAD,
      fontSize: 14,
      color: tc,
      fontFace: firstFont(t.fonts.body),
      valign: 'top', wrap: true,
      shrinkText: true,
      ...(bodyName ? { objectName: bodyName } : {}),
    });
    registerStep(bodyName);
  }
}

// ── Styled code block (reused by addCodeSlide and addElements) ────────────────

function addCodeBlock(
  ctx: ElementRenderContext, value: string, lang: string | undefined, area: Area, step?: number,
) {
  const { s, theme: t, steps: stepTargets } = ctx;
  const codeBgOverride = ctx.colours.codeBg;
  // A code block is 3-4 separate pptxgenjs shapes (outer rect, optional lang
  // badge, inner rect, code text) rather than one — registering each of them
  // as its own whole-shape target under the *same* step, all inside the same
  // clickEffect (see the ClickTarget[] batching in applyStepAnimations),
  // reveals the whole block together on one click instead of animating just
  // one piece of it while the rest stay visible.
  const { stepName, registerStep } = makeStepRegistrar(step, area, 'code', stepTargets);

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
  const outerName = stepName();
  s.addShape('rect', {
    x: area.x, y: blockY, w: area.w, h: blockH,
    fill: { color: hex(codeBg) },
    line: { type: 'none' },
    ...(outerName ? { objectName: outerName } : {}),
  });
  registerStep(outerName);

  // Language badge — uppercase, accent, letter-spaced (mirrors .sl-code__lang)
  if (lang) {
    const langName = stepName();
    s.addText(lang.toUpperCase(), {
      x: area.x + OUTER_PAD, y: blockY + OUTER_PAD,
      w: 3, h: LANG_H,
      fontSize: 9, color: hex(t.colors.accent),
      fontFace: firstFont(t.fonts.code),
      align: 'left', valign: 'bottom',
      charSpacing: 1,
      ...(langName ? { objectName: langName } : {}),
    });
    registerStep(langName);
  }

  // Inner dark rect — use the github-dark background (#0d1117) for proper contrast.
  // mixBlack(code_bg, 0.4) only yields medium gray for light themes, making text
  // hard to read; the actual highlight.js github-dark theme hardcodes #0d1117.
  const innerX = area.x + OUTER_PAD;
  const innerY = blockY + OUTER_PAD + langExtra;
  const innerW = area.w - OUTER_PAD * 2;

  const innerName = stepName();
  s.addShape('rect', {
    x: innerX, y: innerY, w: innerW, h: innerH,
    fill: { color: '0D1117' },
    line: { type: 'none' },
    ...(innerName ? { objectName: innerName } : {}),
  });
  registerStep(innerName);

  // Syntax-highlight and convert to coloured PptxGenJS runs (github-dark palette).
  const highlighted = lang && hljs.getLanguage(lang)
    ? hljs.highlight(value, { language: lang })
    : hljs.highlightAuto(value);
  const codeRuns = hljsHtmlToRuns(highlighted.value);

  const textName = stepName();
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
    ...(textName ? { objectName: textName } : {}),
  });
  registerStep(textName);
}

// ── Element renderer ──────────────────────────────────────────────────────────

function addElements(ctx: ElementRenderContext, elements: SlideElement[], area: Area) {
  if (elements.length === 0) return;
  const { s, theme: t, warnings, steps: stepTargets } = ctx;
  const { text: tc, bold: boldColor } = ctx.colours;

  // Single image fills the area
  if (elements.length === 1 && elements[0].type === 'image') {
    const el = elements[0];
    const ar = el.title ? parseFloat(el.title) : NaN;
    const capH = el.caption ? CAPTION_H : 0;
    const objectName = el.step !== undefined ? stepShapeName(area, 'img') : undefined;
    tryAddImage(s, el.src, { ...area, h: area.h - capH }, warnings, isFinite(ar) ? ar : undefined, objectName);
    if (objectName) stepTargets.push({ step: el.step!, objectName });
    addCaption(s, el.caption, t, area.x, area.y + area.h - capH, area.w);
    return;
  }

  // Single code element — render with full dark-background styling. Renders
  // as 3-4 separate pptxgenjs shapes (background rect, inner rect, optional
  // language badge, code text) rather than one — addCodeBlock registers each
  // of them under the same step so they all reveal together on one click
  // (see the ClickTarget[] batching in applyStepAnimations), rather than
  // animating just one piece while the rest stay visible. Same reasoning
  // applies to the callout case just below.
  if (elements.length === 1 && elements[0].type === 'code') {
    const el = elements[0];
    addCodeBlock(ctx, el.value, el.lang, area, el.step);
    return;
  }

  // Single callout — render as a bordered/accent-barred box, not a plain quote
  if (elements.length === 1 && elements[0].type === 'blockquote' && elements[0].calloutType) {
    addCalloutBlock(ctx, elements[0], area, elements[0].step);
    return;
  }

  // Build a text run array for all text-based elements. `paraIdx` tracks
  // which 0-based OOXML paragraph (<a:p>) each pushed run lands in, purely
  // from this loop's own knowledge of where paragraphs begin — a list item
  // has no explicit `breakLine` (pptxgenjs starts a new paragraph on its own
  // whenever a run carries a `bullet` option, confirmed by inspecting actual
  // export output), so paragraph boundaries here are asserted at each point
  // this code already knows semantically starts a new paragraph, not
  // inferred generically from run options. `paraSteps` collects, per build
  // step, every paragraph index that step should reveal — consumed by
  // applyStepAnimations() once this shape's real OOXML shape id is known.
  const runs: PptxTextRun[] = [];
  let paraIdx = -1; // -1 so the first startParagraph() call lands on 0
  const paraSteps = new Map<number, number[]>();
  const startParagraph = (step: number | undefined) => {
    paraIdx += 1;
    if (step === undefined) return;
    const list = paraSteps.get(step) ?? [];
    list.push(paraIdx);
    paraSteps.set(step, list);
  };

  for (const el of elements) {
    switch (el.type) {
      case 'paragraph':
        if (el.text.trim()) {
          startParagraph(el.step);
          const paraRuns = htmlToInlineRuns(el.html, tc, firstFont(t.fonts.code), hex(t.colors.accent), pptxIconFont(t), boldColor);
          paraRuns.forEach((run, ri) => {
            runs.push({ text: run.text, options: { fontSize: 18, ...run.options, breakLine: ri === paraRuns.length - 1 } });
          });
        }
        break;

      case 'list':
        for (const item of el.items) {
          startParagraph(el.step ?? item.step);
          const bulletBase = {
            bullet: el.ordered ? { type: 'number', style: 'arabicPeriod' } as const : true as const,
            fontSize: 18,
            paraSpaceAfter: 4,
          };
          const itemRuns = htmlToInlineRuns(item.html, tc, firstFont(t.fonts.code), hex(t.colors.accent), pptxIconFont(t), boldColor);
          runs.push({ text: itemRuns[0].text, options: { ...itemRuns[0].options, ...bulletBase } });
          for (let ri = 1; ri < itemRuns.length; ri++) {
            runs.push({ text: itemRuns[ri].text, options: { fontSize: 18, ...itemRuns[ri].options } });
          }
          for (const child of item.children) {
            startParagraph(el.step ?? child.step);
            const childBase = { bullet: true as const, indentLevel: 1, fontSize: 16, paraSpaceAfter: 3 };
            const childRuns = htmlToInlineRuns(child.html, tc, firstFont(t.fonts.code), hex(t.colors.accent), pptxIconFont(t), boldColor);
            runs.push({ text: childRuns[0].text, options: { ...childRuns[0].options, ...childBase } });
            for (let ri = 1; ri < childRuns.length; ri++) {
              runs.push({ text: childRuns[ri].text, options: { fontSize: 16, ...childRuns[ri].options } });
            }
          }
        }
        break;

      case 'blockquote':
        if (el.calloutType) {
          startParagraph(el.step);
          const color = CALLOUT_COLORS[el.calloutType] ?? CALLOUT_COLORS.note;
          runs.push({
            text: el.title ?? '',
            options: { bold: true, fontSize: 16, color: hex(color), breakLine: true, paraSpaceAfter: 2 },
          });
          if (el.text.trim()) {
            startParagraph(el.step);
            runs.push({ text: el.text, options: { fontSize: 16, breakLine: true, paraSpaceAfter: 4 } });
          }
        } else {
          startParagraph(el.step);
          runs.push({
            text: `“${el.text}”`,
            options: { italic: true, fontSize: 18, breakLine: true },
          });
          if (el.attribution) {
            startParagraph(el.step);
            runs.push({
              text: `— ${el.attribution}`,
              options: { fontSize: 14, color: hex(t.colors.accent), breakLine: true },
            });
          }
        }
        break;

      case 'toc': {
        // Mirrors TocElement: only top-level entries are numbered or bolded,
        // deeper ones are indented 2em per level (issue #277). pptxgenjs only
        // indents bulleted paragraphs, so sub-entries carry an invisible
        // (no-break space) bullet whose indent sets the text position.
        const subBase = t.toc.numbered ? 27 : 0; // pptxgenjs' default numbered-text indent, pt
        let n = el.numberStart ?? 0;
        el.entries.forEach((entry) => {
          const depth = entry.depth ?? 0;
          startParagraph(el.step);
          runs.push({
            text: entry.title,
            options: {
              ...(t.toc.numbered && !depth
                ? { bullet: { type: 'number', numberType: 'arabicPeriod', numberStartAt: ++n } }
                : {}),
              ...(depth
                ? { bullet: { characterCode: '00A0', indent: subBase + depth * 36 } }
                : el.nested ? { bold: true } : {}),
              fontSize: 18, paraSpaceAfter: 4, breakLine: true,
            },
          });
        });
        break;
      }

      case 'code':
        // Code mixed with other elements: fall back to plain monospaced text.
        // (Single-element code is caught above and rendered with full styling.)
        startParagraph(el.step);
        runs.push({ text: el.value, options: { fontFace: firstFont(t.fonts.code), fontSize: 13, breakLine: true } });
        break;

      case 'math':
        startParagraph(el.step);
        runs.push({ text: el.value, options: { fontFace: firstFont(t.fonts.code), fontSize: 15, breakLine: true } });
        if (el.caption) {
          startParagraph(el.step);
          runs.push({ text: el.caption, options: { fontSize: 11, italic: true, breakLine: true, paraSpaceAfter: 4 } });
        }
        break;

      case 'mermaid':
        // Reached only when resolveSlideImages' mermaidToDataUrl failed to
        // rasterise the diagram (already pushed a warning there) — this had
        // no case at all before, so a diagram mixed with other content
        // silently vanished with nothing in its place, unlike code/math's
        // plain-text fallback just above.
        startParagraph(el.step);
        runs.push({ text: el.value, options: { fontFace: firstFont(t.fonts.code), fontSize: 13, breakLine: true } });
        if (el.caption) {
          startParagraph(el.step);
          runs.push({ text: el.caption, options: { fontSize: 11, italic: true, breakLine: true, paraSpaceAfter: 4 } });
        }
        break;

      case 'video':
      case 'youtube':
        // Placed as real media objects below (with text/image/table), not as runs.
        break;

      // Images and tables handled separately below
      default:
        break;
    }
  }

  const tableEl = elements.find((e) => e.type === 'table');
  const imageEls = elements.filter((e) => e.type === 'image') as Extract<SlideElement, { type: 'image' }>[];
  const mediaEls = elements.filter((e) => e.type === 'youtube' || e.type === 'video');
  const hasBelow = tableEl?.type === 'table' || imageEls.length > 0 || mediaEls.length > 0;
  const textFrac = runs.length > 0 ? Math.min(0.5, 0.15 + runs.length * 0.08) : 0;

  if (runs.length > 0) {
    const objectName = paraSteps.size > 0 ? stepShapeName(area, 'text') : undefined;
    // With a table/image below, the text only owns the top textFrac share.
    const fit = fitRunsScale(runs, hasBelow ? { ...area, h: area.h * textFrac } : area);
    if (fit.overflow) {
      const label = runs[0].text.trim().slice(0, 40);
      warnings.push(
        `Text too long for the slide — scaled down to ${Math.round(fit.scale * 100)}% and may still overflow${label ? ` (starts: "${label}")` : ''}`,
      );
    }
    s.addText(scaleRuns(runs, fit.scale), {
      x: area.x, y: area.y, w: area.w, h: area.h,
      fontSize: Math.max(1, Math.round(18 * fit.scale * 2) / 2), color: tc,
      fontFace: firstFont(t.fonts.body),
      valign: 'top', wrap: true,
      // The runs are already pre-scaled to fit (fitRunsScale above). shrinkText
      // additionally sets PowerPoint's "Shrink text on overflow" flag, so the
      // box keeps fitting as the recipient edits it.
      shrinkText: true,
      ...(objectName ? { objectName } : {}),
    });
    if (objectName) {
      for (const [step, paragraphs] of paraSteps) {
        stepTargets.push({ step, objectName, paragraphs });
      }
    }
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
  if (hasBelow) {
    const belowY = area.y + area.h * textFrac;
    const belowH = area.h * (1 - textFrac - 0.02);
    // With both a table and image(s) present, give the table the larger share
    // (it usually carries the primary content) and stack the image(s) below it.
    const tableFrac = tableEl?.type === 'table' && (imageEls.length > 0 || mediaEls.length > 0) ? 0.6 : 1;

    if (tableEl?.type === 'table') {
      const tableH = belowH * tableFrac;
      const capH = tableEl.caption ? CAPTION_H : 0;
      const tableArea: Area = { x: area.x, y: belowY, w: area.w, h: tableH - capH };
      // A table is its own dedicated shape (like the lone-image fast path
      // above), so a step on it can target the whole shape directly — unlike
      // addTable itself, this was previously never wired to stepTargets at
      // all, so a stepped table rendered fully visible regardless of step.
      const objectName = tableEl.step !== undefined ? stepShapeName(tableArea, 'table') : undefined;
      const usedH = addTable(ctx, tableEl, tableArea, objectName);
      if (objectName) stepTargets.push({ step: tableEl.step!, objectName });
      // Anchor the caption just under the fitted table (which is usually
      // shorter than its allotted share) rather than at the bottom of the
      // share, but never past it — images, if any, start at that boundary.
      addCaption(s, tableEl.caption, t, area.x, belowY + Math.min(usedH, tableH - capH), area.w);
    }

    const mediaY = belowY + belowH * (tableEl?.type === 'table' ? tableFrac : 0);
    const mediaH = belowH * (1 - (tableEl?.type === 'table' ? tableFrac : 0));
    const stackCount = imageEls.length + mediaEls.length;
    const perH = stackCount > 0 ? mediaH / stackCount : mediaH;
    let stackI = 0;

    imageEls.forEach((img) => {
      const capH = img.caption ? CAPTION_H : 0;
      const y = mediaY + stackI * perH;
      stackI += 1;
      const imgArea: Area = { x: area.x, y, w: area.w, h: perH - capH };
      const objectName = img.step !== undefined ? stepShapeName(imgArea, 'img') : undefined;
      tryAddImage(s, img.src, imgArea, warnings, imgAr(img), objectName);
      if (objectName) stepTargets.push({ step: img.step!, objectName });
      addCaption(s, img.caption, t, area.x, y + perH - capH, area.w);
    });

    mediaEls.forEach((el) => {
      const y = mediaY + stackI * perH;
      stackI += 1;
      const mediaArea: Area = { x: area.x, y, w: area.w, h: perH };
      if (el.type === 'youtube') {
        if (!tryAddOnlineVideo(s, el.url, mediaArea, warnings)) {
          addMediaTextFallback(ctx, el.label || 'YouTube Video', el.url, mediaArea);
        }
      } else if (el.type === 'video') {
        if (!tryAddLocalVideo(s, el.src, mediaArea, warnings)) {
          addMediaTextFallback(ctx, el.label || 'Video', el.src, mediaArea);
        }
      }
    });
  }
}

/** Renders the table into `area`, auto-fitting font/columns/rows. Returns the
 *  height actually consumed (<= area.h) so the caller can place a caption. */
function addTable(
  ctx: ElementRenderContext,
  el: Extract<SlideElement, { type: 'table' }>,
  area: Area,
  objectName?: string,
): number {
  const { s, theme: t, warnings } = ctx;
  const tc = ctx.colours.text;
  const colAlign = (i: number): 'left' | 'center' | 'right' =>
    (el.align?.[i] as 'left' | 'center' | 'right' | null | undefined) ?? 'left';

  const cellText = (html: string) => progressBarText(html) ?? stripHtml(html);
  const headerText = el.headers.map(cellText);
  const bodyText = el.rows.map((row) => row.map(cellText));
  const fit = fitTableToArea([headerText, ...bodyText], area);

  if (fit.overflow) {
    const label = headerText.join(' | ').slice(0, 40);
    warnings.push(
      `Table too large for the slide — scaled down to ${fit.fontSize}pt and may still be tight${label ? ` (columns: "${label}")` : ''}`,
    );
  }

  const headerRow = headerText.map((h, i) => ({
    text: h,
    options: {
      bold: true,
      color: hex(t.colors.title_text),
      fill: { color: hex(t.colors.primary) },
      align: colAlign(i),
      fontSize: fit.fontSize,
    },
  }));
  const bodyRows = bodyText.map((row) =>
    row.map((cell, i) => ({ text: cell, options: { color: tc, fontSize: fit.fontSize, align: colAlign(i) } })),
  );

  s.addTable([headerRow, ...bodyRows], {
    x: area.x, y: area.y, w: area.w, h: fit.height,
    colW: fit.colW,
    rowH: fit.rowH,
    fontSize: fit.fontSize,
    fontFace: firstFont(t.fonts.body),
    valign: 'top',
    margin: [TABLE_CELL_VMARGIN, TABLE_CELL_HMARGIN, TABLE_CELL_VMARGIN, TABLE_CELL_HMARGIN],
    border: { color: hex(t.colors.accent), pt: 0.5 },
    ...(objectName ? { objectName } : {}),
  });

  return fit.height;
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

function addCaption(s: PptxSlide, caption: string | undefined, t: Theme, x: number, y: number, w: number) {
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

function tryAddImage(s: PptxSlide, src: string, area: Area, warnings: string[], aspectRatio?: number, objectName?: string) {
  if (!src) return;
  const placed = aspectRatio ? containArea(area, aspectRatio) : area;
  if (src.startsWith('data:')) {
    try {
      s.addImage({ data: src, x: placed.x, y: placed.y, w: placed.w, h: placed.h, ...(objectName ? { objectName } : {}) });
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

function firstFont(stack: string): string {
  return stack.split(',')[0].trim().replace(/['"]/g, '');
}

// "Kova Icons" is only the name the app registers its bundled icon font under;
// the font itself is Nerd Fonts' "Symbols Nerd Font". PptxGenJS can't embed
// fonts, so name the public family a recipient can actually install.
const BUNDLED_ICON_FONT = 'Kova Icons';
const PUBLIC_ICON_FONT = 'Symbols Nerd Font';

function pptxIconFont(t: Theme): string {
  const font = firstFont(t.fonts.icon);
  return font === BUNDLED_ICON_FONT ? PUBLIC_ICON_FONT : font;
}

// A `!progress` directive in a table cell is rendered as an HTML bar (see
// progressBar.ts). PptxGenJS table cells can't hold shapes, so the block
// `!progress` path's rect drawing isn't available here — fall back to a text
// meter (label · filled/empty blocks · percent) rather than stripHtml's
// run-together "Done75%".
function progressBarText(cellHtml: string): string | null {
  if (!cellHtml.includes('sl-progress')) return null;
  const div = document.createElement('div');
  div.innerHTML = cellHtml;
  const bar = div.querySelector('.sl-progress');
  if (!bar) return null;
  const label = (bar.querySelector('.sl-progress__label')?.textContent ?? '').trim();
  const pctText = (bar.querySelector('.sl-progress__pct')?.textContent ?? '').trim();
  const pct = Math.max(0, Math.min(100, parseFloat(pctText) || 0));
  const filled = Math.round(pct / 10);
  const meter = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return [label, meter, pctText].filter(Boolean).join('  ');
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
