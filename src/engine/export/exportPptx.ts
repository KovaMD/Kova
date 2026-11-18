import { enginePorts, type AssetLoader } from '../ports';
import { parseChannels } from './mermaidExportTheme';
import { autoSplitElements, explodeListItems, groupProgressRuns, splitByColumnBreaks } from '../layout/elementGrouping';
import type { Slide, SlideElement, Frontmatter } from '../types';
import { parseAspectRatio } from '../types';
import type { Theme } from '../theme';
import { resolveDeckMeta, resolveSlideFrame } from '../render/slideModel';
import type { DeckMeta, FooterFrame, SlideFrame } from '../render/slideModel';
import type { PptxSlide } from './pptx/pptxTypes';
import { withThemeCodeBg } from './pptx/context';
import { cssColorToHex, hex } from './pptx/colour';
import type { Area, SlideRenderContext, StepTarget } from './pptx/context';
import { applyPptxPostProcessing, stepShapeName } from './pptx/timing';
import { resolveSlideImages, resolveThemeLogo } from './pptx/assets';
import { firstFont, pptxIconFont } from './pptx/fonts';
import { addElements } from './pptx/elements';
import { addCodeBlock } from './pptx/elements/code';
import { CAPTION_H, addCaption, imgAr, tryAddImage } from './pptx/elements/image';
import { addMediaTextFallback, tryAddLocalVideo, tryAddOnlineVideo } from './pptx/elements/media';
import { htmlToInlineRuns } from './pptx/elements/textRuns';

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
