import PptxGenJS from 'pptxgenjs';
import type { Slide, SlideElement, Frontmatter } from '../types';
import type { Theme } from '../theme';
import { resolveTemplate } from '../theme';

const W = 10; // slide width is always 10" regardless of ratio
const M = 0.5;     // standard margin
const HEAD_H = 0.4;
const FOOT_H = 0.35;

interface Meta { docTitle: string; docDate: string; slideNum: number; totalSlides: number }
interface Area { x: number; y: number; w: number; h: number }

// ── Entry point ───────────────────────────────────────────────────────────────

export interface ExportResult { base64: string; warnings: string[] }

export async function exportToPptx(
  slides: Slide[],
  frontmatter: Frontmatter,
  theme: Theme,
): Promise<ExportResult> {
  const pres = new PptxGenJS();
  const is4x3 = (frontmatter.aspect_ratio as string | undefined) === '4:3';
  pres.layout = is4x3 ? 'LAYOUT_4x3' : 'LAYOUT_WIDE';
  const H = is4x3 ? 7.5 : 5.625;

  const docTitle = frontmatter.title ?? '';
  const docDate  = frontmatter.date != null ? String(frontmatter.date) : '';
  const warnings: string[] = [];

  for (let i = 0; i < slides.length; i++) {
    const pSlide = pres.addSlide();
    const meta: Meta = { docTitle, docDate, slideNum: i + 1, totalSlides: slides.length };
    addSlide(pSlide as PS, slides[i], theme, meta, H, warnings);
  }

  const base64 = (await pres.write({ outputType: 'base64' })) as string;
  return { base64, warnings };
}

// ── Per-slide dispatcher ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PS = any;

function addSlide(s: PS, slide: Slide, t: Theme, meta: Meta, H: number, warnings: string[]) {
  const hasHead = t.header.show;
  const hasFoot = t.footer.show;
  const cy = M + (hasHead ? HEAD_H : 0);
  const ch = H - M - cy - (hasFoot ? FOOT_H : 0);

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
    case 'code':          addCodeSlide(s, slide, t, cy, ch); break;
    default:              addTitleContentSlide(s, slide, t, cy, ch, warnings);
  }

  if (hasHead) addHeaderBar(s, t, meta);
  if (hasFoot) addFooterBar(s, t, meta, H);
}

// ── Layout renderers ──────────────────────────────────────────────────────────

function addTitleSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number) {
  s.background = { fill: hex(t.colors.primary) };
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: ch,
      fontSize: 40, bold: true,
      color: hex(t.colors.title_text),
      fontFace: firstFont(t.fonts.title),
      align: 'center', valign: 'middle', wrap: true,
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
      align: 'center', valign: 'middle', wrap: true,
    });
  }
}

function addTitleContentSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.75 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 28, bold: true,
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      align: 'left', valign: 'middle', wrap: true,
    });
  }
  addElements(s, slide.elements, t, { x: M, y: cy + hh + 0.1, w: W - M * 2, h: ch - hh - 0.1 }, warnings);
}

function addTitleImageSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const textW = (W - M * 2) * 0.45;
  const imgW  = (W - M * 2) * 0.5;
  const imgX  = W - M - imgW;

  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: textW, h: ch,
      fontSize: 26, bold: true,
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      align: 'left', valign: 'middle', wrap: true,
    });
  }
  const img = slide.elements.find((e) => e.type === 'image');
  if (img && img.type === 'image') {
    tryAddImage(s, img.src, { x: imgX, y: cy, w: imgW, h: ch }, warnings);
  }
}

function addSplitSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      wrap: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const colW  = (W - M * 2 - 0.3) / 2;
  const img   = slide.elements.find((e) => e.type === 'image');
  const rest  = slide.elements.filter((e) => e.type !== 'image');

  if (img && img.type === 'image') {
    tryAddImage(s, img.src, { x: M, y: bodyY, w: colW, h: bodyH }, warnings);
  }
  addElements(s, rest, t, { x: M + colW + 0.3, y: bodyY, w: colW, h: bodyH }, warnings);
}

function addFullBleedSlide(s: PS, slide: Slide, t: Theme, H: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.primary) };
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
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      wrap: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const colW  = (W - M * 2 - 0.3) / 2;
  const bi    = slide.elements.findIndex((e) => e.type === 'column-break');
  const left  = bi >= 0 ? slide.elements.slice(0, bi) : slide.elements;
  const right = bi >= 0 ? slide.elements.slice(bi + 1) : [];

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
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      wrap: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const GAP   = 0.3;
  const colW  = (W - M * 2 - GAP) / 2;

  const isPureText = (type: string) => type === 'paragraph' || type === 'list';
  const body = slide.elements;

  let leftEls: SlideElement[];
  let rightEls: SlideElement[];

  if (body.length === 2) {
    const firstIsText  = isPureText(body[0].type);
    const secondIsText = isPureText(body[1].type);
    if (!firstIsText && secondIsText) {
      leftEls  = [body[1]];
      rightEls = [body[0]];
    } else {
      leftEls  = [body[0]];
      rightEls = [body[1]];
    }
  } else {
    leftEls  = [body[0]];
    rightEls = body.slice(1);
  }

  addElements(s, leftEls, t, { x: M, y: bodyY, w: colW, h: bodyH }, warnings);

  if (rightEls.length === 1) {
    addElements(s, rightEls, t, { x: M + colW + GAP, y: bodyY, w: colW, h: bodyH }, warnings);
  } else {
    const subH = (bodyH - 0.2) / 2;
    addElements(s, [rightEls[0]], t, { x: M + colW + GAP, y: bodyY,              w: colW, h: subH }, warnings);
    addElements(s, [rightEls[1]], t, { x: M + colW + GAP, y: bodyY + subH + 0.2, w: colW, h: subH }, warnings);
  }
}

function addGridSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number, warnings: string[]) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      wrap: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const GAP   = 0.2;
  const cols  = 2;
  const rows  = Math.ceil(slide.elements.length / cols);
  const cellW = (W - M * 2 - GAP * (cols - 1)) / cols;
  const cellH = rows > 0 ? (bodyH - GAP * (rows - 1)) / rows : bodyH;

  slide.elements.forEach((el, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    addElements(s, [el], t, {
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
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      wrap: true,
    });
  }
  const bodyY = cy + hh + 0.1;
  const bodyH = ch - hh - 0.1;
  const yt    = slide.elements.find((e) => e.type === 'youtube');
  const poll  = slide.elements.find((e) => e.type === 'poll');

  if (yt && yt.type === 'youtube') {
    s.addText([
      { text: '▶ ', options: { fontSize: 30, bold: true } },
      { text: yt.label || 'YouTube Video', options: { fontSize: 20, breakLine: true } },
      { text: yt.url, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: bodyY, w: W - M * 2, h: bodyH,
      color: hex(t.colors.text), fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  } else if (poll && poll.type === 'poll') {
    s.addText([
      { text: poll.label || 'Poll', options: { fontSize: 20, bold: true, breakLine: true } },
      { text: poll.url, options: { fontSize: 11, color: hex(t.colors.accent) } },
    ], {
      x: M, y: bodyY, w: W - M * 2, h: bodyH,
      color: hex(t.colors.text), fontFace: firstFont(t.fonts.body),
      align: 'center', valign: 'middle', wrap: true,
    });
  }
}

function addCodeSlide(s: PS, slide: Slide, t: Theme, cy: number, ch: number) {
  s.background = { fill: hex(t.colors.background) };
  const hh = slide.title ? 0.65 : 0;
  if (slide.title) {
    s.addText(slide.title, {
      x: M, y: cy, w: W - M * 2, h: hh,
      fontSize: 24, bold: true,
      color: hex(t.colors.primary),
      fontFace: firstFont(t.fonts.title),
      wrap: true,
    });
  }
  const codeEl = slide.elements.find((e) => e.type === 'code' || e.type === 'mermaid');
  if (!codeEl) return;

  const codeY = cy + hh + 0.1;
  const codeH = ch - hh - 0.1;
  const value = codeEl.value;
  const lang  = codeEl.type === 'code' ? codeEl.lang : 'mermaid';

  // Code background rectangle
  s.addShape('rect', {
    x: M, y: codeY, w: W - M * 2, h: codeH,
    fill: { color: hex(t.colors.code_bg) },
    line: { color: hex(t.colors.accent), pt: 0.5 },
  });
  if (lang) {
    s.addText(lang, {
      x: M + 0.12, y: codeY + 0.06, w: 1.5, h: 0.24,
      fontSize: 9, color: hex(t.colors.accent),
      fontFace: firstFont(t.fonts.code),
    });
  }
  s.addText(value, {
    x: M + 0.15, y: codeY + (lang ? 0.32 : 0.15),
    w: W - M * 2 - 0.3,
    h: codeH - (lang ? 0.48 : 0.3),
    fontSize: 13, color: hex(t.colors.text),
    fontFace: firstFont(t.fonts.code),
    wrap: true, valign: 'top',
  });
}

// ── Header / Footer bars ──────────────────────────────────────────────────────

function addHeaderBar(s: PS, t: Theme, meta: Meta) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: HEAD_H,
    fill: { color: hex(t.colors.primary) },
    line: { type: 'none' },
  });
  const text = resolveTemplate(t.header.text, {
    title: meta.docTitle, date: meta.docDate,
    slideNumber: meta.slideNum, totalSlides: meta.totalSlides,
  });
  if (text) {
    s.addText(text, {
      x: M, y: 0, w: W - M * 2, h: HEAD_H,
      fontSize: 10, color: hex(t.colors.title_text),
      fontFace: firstFont(t.fonts.body),
      align: 'left', valign: 'middle',
    });
  }
}

function addFooterBar(s: PS, t: Theme, meta: Meta, H: number) {
  const footY = H - FOOT_H;
  s.addShape('rect', {
    x: 0, y: footY, w: W, h: FOOT_H,
    fill: { color: hex(t.colors.primary) },
    line: { type: 'none' },
  });
  const showNum = t.footer.show_slide_number;
  const text = resolveTemplate(t.footer.text, {
    title: meta.docTitle, date: meta.docDate,
    slideNumber: meta.slideNum, totalSlides: meta.totalSlides,
  });
  if (text) {
    s.addText(text, {
      x: M, y: footY, w: W - M * 2 - (showNum ? 1.1 : 0), h: FOOT_H,
      fontSize: 9, color: hex(t.colors.title_text),
      fontFace: firstFont(t.fonts.body),
      align: 'left', valign: 'middle',
    });
  }
  if (showNum) {
    s.addText(`${meta.slideNum} / ${meta.totalSlides}`, {
      x: W - M - 1.1, y: footY, w: 1.1, h: FOOT_H,
      fontSize: 9, color: hex(t.colors.title_text),
      fontFace: firstFont(t.fonts.body),
      align: 'right', valign: 'middle',
    });
  }
}

// ── Element renderer ──────────────────────────────────────────────────────────

function addElements(s: PS, elements: SlideElement[], t: Theme, area: Area, warnings: string[] = []) {
  if (elements.length === 0) return;

  // Single image fills the area
  if (elements.length === 1 && elements[0].type === 'image') {
    tryAddImage(s, elements[0].src, area, warnings);
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
          runs.push({
            text: stripHtml(item.html),
            options: {
              bullet: el.ordered ? { type: 'number', style: 'arabicPeriod' } : true,
              fontSize: 18,
              paraSpaceAfter: 4,
            },
          });
          for (const child of item.children) {
            runs.push({
              text: stripHtml(child.html),
              options: { bullet: true, indentLevel: 1, fontSize: 16, paraSpaceAfter: 3 },
            });
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
        runs.push({
          text: el.value,
          options: { fontFace: firstFont(t.fonts.code), fontSize: 13, breakLine: true },
        });
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
  const headerRow = el.headers.map((h) => ({
    text: h,
    options: {
      bold: true,
      color: hex(t.colors.title_text),
      fill: { color: hex(t.colors.primary) },
      align: 'center' as const,
    },
  }));
  const bodyRows = el.rows.map((row) =>
    row.map((cell) => ({ text: cell, options: { color: hex(t.colors.text), fontSize: 14 } }))
  );
  s.addTable([headerRow, ...bodyRows], {
    x: area.x, y: area.y, w: area.w,
    fontSize: 14,
    fontFace: firstFont(t.fonts.body),
    border: { color: hex(t.colors.accent), pt: 0.5 },
  });
}

function tryAddImage(s: PS, src: string, area: Area, warnings: string[]) {
  if (!src) return;
  if (src.startsWith('asset://') || src.startsWith('tauri://')) {
    warnings.push(`Image skipped (local file paths cannot be embedded in PPTX): ${src}`);
    return;
  }
  if (src.startsWith('http://') || src.startsWith('https://')) {
    try {
      s.addImage({ path: src, x: area.x, y: area.y, w: area.w, h: area.h });
    } catch {
      warnings.push(`Image could not be fetched and was skipped: ${src}`);
    }
    return;
  }
  warnings.push(`Image skipped (unsupported source): ${src}`);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function hex(color: string): string {
  return color.replace('#', '').toUpperCase();
}

function firstFont(stack: string): string {
  return stack.split(',')[0].trim().replace(/['"]/g, '');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}
