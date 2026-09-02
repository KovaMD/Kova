import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import katex from 'katex';
import { parseColorValue } from './colorValue';
import { toString } from 'mdast-util-to-string';
import type { Root, Node, Paragraph, List, ListItem as MdastListItem, Code, Blockquote, Table, Heading } from 'mdast';

import type { Slide, SlideElement, ListItem, LayoutType, Frontmatter, ParsedDocument } from '../types';
import { detectLayout } from '../layout/autoLayout';
import { progressBarInnerHtml } from '../progressBar';
import { extractFrontmatter } from './frontmatter';
import { extractSpeakerNotes } from './speakerNotes';
import { extractBgImage } from './bgImage';
import { collectConstants } from '../sheet/constants';
import { evaluateSheet, isFooterRow, parseSheetDirective, type SheetOpts } from '../sheet/sheet';
import type { Value } from '../sheet/evaluate';
import { matchStepMarker, createStepAssigner, STEP_MARKER_PATTERN, type StepAssigner } from './stepMarkers';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

// Reuses the previous call's Slide objects (by position) whenever a slide's
// raw text is byte-identical to last time. Without this, every keystroke
// re-parses and rebuilds the *entire* deck's Slide objects (remark, KaTeX,
// highlight.js classification, etc. for every slide, not just the one being
// edited) — and since the result is a brand-new object graph each time, any
// downstream React.memo on a per-slide component (e.g. ThumbnailPanel) can
// never skip a re-render either, because the prop reference always changes.
// Positional (not content-hash) comparison: a slide insertion/deletion shifts
// every later index out of alignment and is a deliberate, accepted miss —
// simpler and bounded (one prior array, no growing cache) at the cost of not
// optimising that less-common edit. Module-level cache mirrors the existing
// mermaidSvgCache pattern elsewhere in this codebase.
let prevRawSlides: string[] = [];
let prevParsedSlides: Slide[] = [];
// A !let on slide 1 can change a sheet on slide 7, so an unchanged slide is
// only safe to reuse while the constants are unchanged too.
let prevConstKey = '';

// Splits the document body into per-slide raw text on a line that trims to
// exactly '---', the same way a plain regex split would — except a '---'
// line inside a fenced code block (e.g. a YAML sample) doesn't count as a
// boundary, mirroring the inFencedCode tracking preprocess() already does.
export function splitIntoRawSlides(body: string): string[] {
  const slides: string[] = [];
  let current: string[] = [];
  let inFencedCode = false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (/^(`{3,}|~{3,})/.test(t)) inFencedCode = !inFencedCode;
    if (!inFencedCode && t === '---') {
      slides.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  slides.push(current.join('\n'));
  return slides;
}

/**
 * 1-based line numbers of the first body line of every slide parseDocument
 * would produce, for the raw (un-normalised) editor content. The editor uses
 * this to map cursor position ↔ slide index; it must apply exactly the same
 * fenced-code and empty-slide rules as parseDocument, otherwise a '---' inside
 * a fenced block (e.g. a mermaid front-matter config) shifts the mapping.
 */
export function slideStartLines(rawContent: string): number[] {
  // \r\n → \n is 1:1 per line, so line numbers are unaffected by normalising.
  const normalised = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { body } = extractFrontmatter(normalised);
  const frontmatterLineCount = normalised.slice(0, normalised.length - body.length).split('\n').length - 1;

  const starts: number[] = [];
  const lines = body.split('\n');
  let inFencedCode = false;
  let segmentStart = 0;
  let segment: string[] = [];

  const flush = () => {
    if (segment.join('\n').trim()) starts.push(frontmatterLineCount + segmentStart + 1);
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^(`{3,}|~{3,})/.test(t)) inFencedCode = !inFencedCode;
    if (!inFencedCode && t === '---') {
      flush();
      segment = [];
      segmentStart = i + 1;
      continue;
    }
    segment.push(lines[i]);
  }
  flush();

  return starts;
}

// A step-marker occurrence found anywhere on a line — unanchored, so it
// matches both the trailing-inline form and the own-line-after form alike;
// this only needs to *find* markers in document order, not validate their
// placement (that's mergeStepMarker's job during real parsing).
const STEP_MARKER_ANYWHERE_RE = new RegExp(STEP_MARKER_PATTERN, 'g');

/**
 * The step value a *new*, bare `<!-- step -->` marker would receive if
 * appended after every existing marker in the slide containing `lineNumber`
 * (1-based, counting from the very first line of `content`, frontmatter
 * included) — used by the editor's multi-line "reveal on click" toggle
 * (contextMenuActions.ts) to pick one shared explicit number when grouping
 * several lines onto a single click. Reuses this file's own frontmatter
 * extraction and slide-splitting, and replays the exact same StepAssigner
 * parseSlide() uses, so the number offered here can never drift from what
 * parseDocument would actually assign a same-positioned bare marker.
 */
export function computeNextStep(content: string, lineNumber: number): number {
  const normalised = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { body } = extractFrontmatter(normalised);
  // extractFrontmatter returns body as a suffix of normalised, so the
  // length difference is the frontmatter block's own line count.
  const frontmatterLineCount = normalised.slice(0, normalised.length - body.length).split('\n').length - 1;
  const rawSlides = splitIntoRawSlides(body);

  let lineCursor = frontmatterLineCount;
  let targetSlide = rawSlides[rawSlides.length - 1] ?? '';
  for (const raw of rawSlides) {
    const slideLineCount = raw.split('\n').length;
    if (lineNumber <= lineCursor + slideLineCount) {
      targetSlide = raw;
      break;
    }
    lineCursor += slideLineCount + 1; // +1 for the '---' separator line itself
  }

  const assignStep = createStepAssigner();
  let inFencedCode = false;
  for (const line of targetSlide.split('\n')) {
    const t = line.trim();
    if (/^(`{3,}|~{3,})/.test(t)) { inFencedCode = !inFencedCode; continue; }
    if (inFencedCode) continue;
    for (const m of line.matchAll(STEP_MARKER_ANYWHERE_RE)) {
      assignStep(m[1] !== undefined ? parseInt(m[1], 10) : null);
    }
  }
  return assignStep(null);
}

export function parseDocument(rawContent: string): ParsedDocument {
  const normalised = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { frontmatter, body } = extractFrontmatter(normalised);
  const rawSlides = splitIntoRawSlides(body).map((s) => s.trim()).filter(Boolean);
  const constants = collectConstants(rawSlides);
  const constKey = JSON.stringify([...constants]);
  const slides = rawSlides.map((raw, index) =>
    raw === prevRawSlides[index] && prevParsedSlides[index] && constKey === prevConstKey
      ? prevParsedSlides[index]
      : parseSlide(raw, index, constants),
  );
  prevRawSlides = rawSlides;
  prevParsedSlides = slides;
  prevConstKey = constKey;
  return { slides, frontmatter };
}

// ── Per-slide parser ─────────────────────────────────────────────────────────

function parseSlide(raw: string, index: number, constants: Map<string, Value>): Slide {
  const { body: rawWithoutBg, bg: bgImage } = extractBgImage(raw);

  // Extract layout override from HTML comment before anything else
  const layoutOverrideMatch = rawWithoutBg.match(/<!--\s*layout:\s*(\S+)\s*-->/);
  const layoutOverride = layoutOverrideMatch
    ? (layoutOverrideMatch[1] as LayoutType)
    : undefined;

  const hidden = /<!--\s*hidden\s*-->/.test(rawWithoutBg);

  // Per-slide text colour override. Kova uses `<!-- color: #fff -->`; Marp
  // decks use `<!-- _color: white -->`. Both set the same `textColor` field.
  const colorMatch = rawWithoutBg.match(/<!--\s*(?:_?color)\s*:\s*([^\s-][^\n]*?)\s*-->/i);
  const textColor = colorMatch ? parseColorValue(colorMatch[1]) : undefined;

  // Marp `<!-- _class: invert -->` — swap to an inverted palette for this slide.
  const invertMatch = rawWithoutBg.match(/<!--\s*_class\s*:\s*([^\n]*?)\s*-->/);
  const invert = !!invertMatch && /\binvert\b/.test(invertMatch[1]);

  // Preprocess before speaker-notes extraction so ??? inside custom URLs is not
  // misinterpreted as speaker-note markers. Custom elements become inline HTML
  // comment placeholders so remark preserves their position in the element list.
  const { cleanContent, placeholders, sheets, references } = preprocess(rawWithoutBg);
  const { content, notes } = extractSpeakerNotes(cleanContent);

  const tree = processor.parse(content) as Root;
  let { title, titleLevel, elements } = convertRoot(tree, placeholders, sheets, content, constants);

  let layout = layoutOverride ?? detectLayout(elements, titleLevel, !!title);
  let backgroundImage: Slide['backgroundImage'];

  if (bgImage) {
    const imgEl: SlideElement = { type: 'image', src: bgImage.src, alt: '' };
    if (bgImage.side) {
      // bg split takes precedence — section/blank overrides would drop the image.
      layout = 'split';
      elements = bgImage.side === 'left' ? [imgEl, ...elements] : [...elements, imgEl];
    } else if (!title && elements.length === 0) {
      layout = 'full-bleed';
      elements = [imgEl];
    } else {
      backgroundImage = { src: bgImage.src, size: bgImage.size };
    }
  }

  return { index, raw, title, titleLevel, elements, speakerNotes: notes, references, layout, layoutOverride, hidden, backgroundImage, textColor, invert };
}

// ── Custom syntax pre-processor ──────────────────────────────────────────────

// A caption never survives to the renderer as its own element — it is merged
// into the image/mermaid/math element it directly follows (see convertRoot's
// html-node handling) so it can never trip layout detection into treating it
// as extra body content (e.g. forcing a split/two-column layout — issue #151).
interface CaptionMarker {
  type: 'caption';
  text: string;
}

interface PreprocessResult {
  cleanContent: string;
  placeholders: Map<number, SlideElement | CaptionMarker>;
  sheets: Map<number, SheetOpts>;
  references: string[];
}

const YOUTUBE_RE      = /^!youtube\[([^\]]*)\]\(([^)]*)\)$/;
const VIDEO_RE        = /^!video\[([^\]]*)\]\(([^)]*)\)$/;
const POLL_RE         = /^!poll\[([^\]]*)\]\(([^)]*)\)$/;
const PROGRESS_RE     = /^!progress\[([^\]]*)\]\((\d+(?:\.\d+)?)\)$/;
const CAPTION_RE      = /^!caption\[([^\]]*)\]$/;
const REF_RE          = /^!ref\[([^\]]*)\]$/;
const TOC_RE          = /^!toc$/;
const SHEET_RE        = /^!sheet\b(.*)$/;
const LET_RE          = /^!let\b/;
const RESERVED_RE     = /^!(include|fmt|code)\b/;
// remark-math v6 only recognises block math when $$ appears on its own line.
// Normalise single-line $$...$$ → multi-line so it is parsed as a math block.
const DISPLAY_MATH_RE = /^\$\$(.+)\$\$\s*$/;
// A GFM table row: starts and ends with '|' (also matches the header
// separator row, e.g. '|---|---|', and an unpadded all-empty '|||' row).
const TABLE_ROW_RE    = /^\|.*\|$/;

function preprocess(content: string): PreprocessResult {
  const placeholders = new Map<number, SlideElement | CaptionMarker>();
  const references: string[] = [];
  const sheets = new Map<number, SheetOpts>();
  let nextSheet = 0;
  let nextIdx = 0;
  const cleanLines: string[] = [];
  let inFencedCode = false;
  let inTable = false;

  for (const line of content.split('\n')) {
    const t = line.trim();

    if (/^(`{3,}|~{3,})/.test(t)) {
      inFencedCode = !inFencedCode;
      cleanLines.push(line);
      continue;
    }
    if (inFencedCode) {
      cleanLines.push(line);
      continue;
    }

    // A GFM table row can legitimately be an unpadded all-empty two-cell row,
    // i.e. exactly '|||' — don't mistake it for a column-break sentinel while
    // inside a table. Check against the table state as of the *previous*
    // line first (a standalone '|||' also matches TABLE_ROW_RE, so updating
    // inTable before this check would make it swallow itself, breaking the
    // ordinary/explicit-three-column column-break use of consecutive '|||').
    if (t === '|||' && !inTable) {
      cleanLines.push('<!-- column-break -->');
      continue;
    }
    // TABLE_ROW_RE also matches the header separator row (e.g. '|---|---|'),
    // which is fine: both keep inTable true.
    if (TABLE_ROW_RE.test(t)) inTable = true;
    else if (t === '') inTable = false;

    const yt = t.match(YOUTUBE_RE);
    if (yt) {
      const idx = nextIdx++;
      placeholders.set(idx, { type: 'youtube', label: yt[1], url: yt[2] });
      cleanLines.push(`<!-- kova-el:${idx} -->`);
      continue;
    }

    const vid = t.match(VIDEO_RE);
    if (vid) {
      const idx = nextIdx++;
      placeholders.set(idx, { type: 'video', label: vid[1], src: vid[2] });
      cleanLines.push(`<!-- kova-el:${idx} -->`);
      continue;
    }

    const poll = t.match(POLL_RE);
    if (poll) {
      const idx = nextIdx++;
      placeholders.set(idx, { type: 'poll', label: poll[1], url: poll[2] });
      cleanLines.push(`<!-- kova-el:${idx} -->`);
      continue;
    }

    const progress = t.match(PROGRESS_RE);
    if (progress) {
      const idx = nextIdx++;
      placeholders.set(idx, { type: 'progress', label: progress[1], value: parseFloat(progress[2]) });
      cleanLines.push(`<!-- kova-el:${idx} -->`);
      continue;
    }

    const caption = t.match(CAPTION_RE);
    if (caption) {
      const idx = nextIdx++;
      placeholders.set(idx, { type: 'caption', text: caption[1] });
      cleanLines.push(`<!-- kova-el:${idx} -->`);
      continue;
    }

    // Constants are collected document-wide by collectConstants; the line itself
    // never renders.
    if (LET_RE.test(t)) continue;

    const reserved = t.match(RESERVED_RE);
    if (reserved) {
      const idx = nextIdx++;
      placeholders.set(idx, {
        type: 'paragraph',
        text: '',
        html: `#ERR '!${reserved[1]}' is reserved for a future release`,
      });
      cleanLines.push(`<!-- kova-el:${idx} -->`);
      continue;
    }

    const sheet = t.match(SHEET_RE);
    if (sheet) {
      const idx = nextSheet++;
      sheets.set(idx, parseSheetDirective(sheet[1]));
      // The blank line closes the HTML block, so the table below still parses
      // as a table rather than being swallowed into it.
      cleanLines.push(`<!-- kova-sheet:${idx} -->`, '');
      continue;
    }

    const ref = t.match(REF_RE);
    if (ref) {
      if (ref[1].trim()) references.push(referenceInlineToHtml(ref[1]));
      continue;
    }

    if (TOC_RE.test(t)) {
      const idx = nextIdx++;
      placeholders.set(idx, { type: 'toc', entries: [] });
      cleanLines.push(`<!-- kova-el:${idx} -->`);
      continue;
    }

    // Strip layout override + hidden comments (already captured above)
    if (/^<!--\s*layout:/.test(t)) continue;
    if (/^<!--\s*hidden\s*-->$/.test(t)) continue;
    // Strip per-slide colour + invert directives (also captured above)
    if (/^<!--\s*(?:_?color)\s*:/.test(t)) continue;
    if (/^<!--\s*_class\s*:/.test(t)) continue;

    // Expand single-line $$...$$ to multi-line so remark-math treats it as a block
    const dm = t.match(DISPLAY_MATH_RE);
    if (dm) {
      cleanLines.push(`$$\n${dm[1]}\n$$`);
      continue;
    }

    cleanLines.push(line);
  }

  return { cleanContent: cleanLines.join('\n').trim(), placeholders, sheets, references };
}

// ── mdast → SlideElement converter ───────────────────────────────────────────

interface ConvertResult {
  title: string;
  titleLevel: number;
  elements: SlideElement[];
}

function convertRoot(
  tree: Root,
  placeholders: Map<number, SlideElement | CaptionMarker>,
  sheets: Map<number, SheetOpts>,
  src: string,
  constants: Map<string, Value>,
): ConvertResult {
  let title = '';
  let titleLevel = 0;
  const elements: SlideElement[] = [];
  let pendingSheet: SheetOpts | undefined;
  // Single per-slide sequence: auto-increment continues across top-level
  // elements, list items (incl. nested), and own-line markers alike, so
  // `<!-- step -->` numbering always reflects true document order.
  const assignStep = createStepAssigner();

  for (const node of tree.children) {
    // A !sheet annotates the table on the very next line and nothing else.
    if (pendingSheet && node.type !== 'table') {
      elements.push({ type: 'paragraph', text: '', html: '#ERR !sheet must sit directly above a table' });
      pendingSheet = undefined;
    }

    switch (node.type) {
      case 'heading': {
        const h = node as Heading;
        if (!title) {
          title = toString(h);
          titleLevel = h.depth;
        } else {
          // A secondary heading is body content, not the slide title — it can
          // carry a trailing step marker exactly like a plain paragraph.
          const { children: hChildren, step } = extractTrailingStep(h.children as Node[], assignStep);
          elements.push({
            type: 'paragraph',
            text: toString({ ...h, children: hChildren }),
            html: `<h${h.depth}>${inlineToHtml(hChildren)}</h${h.depth}>`,
            step,
          });
        }
        break;
      }

      case 'paragraph': {
        const p = node as Paragraph;
        for (const el of convertParagraph(p, assignStep)) elements.push(el);
        break;
      }

      case 'list': {
        const l = node as List;
        elements.push({
          type: 'list',
          ordered: l.ordered ?? false,
          items: l.children.map((item) => convertListItem(item, assignStep)),
        });
        break;
      }

      case 'code': {
        const c = node as Code;
        if (c.lang === 'mermaid') {
          elements.push({ type: 'mermaid', value: c.value });
        } else {
          elements.push({ type: 'code', lang: c.lang ?? '', value: c.value });
        }
        break;
      }

      case 'math': {
        const m = node as { type: 'math'; value: string };
        elements.push({ type: 'math', value: m.value, display: true });
        break;
      }

      case 'blockquote': {
        const bq = node as Blockquote;
        const callout = extractCallout(bq);
        if (callout) {
          const bodyBq: Blockquote = { ...bq, children: callout.children as Blockquote['children'] };
          elements.push({
            type: 'blockquote',
            text: toString(bodyBq),
            html: blockquoteInnerHtml(bodyBq),
            calloutType: callout.calloutType,
            title: callout.title,
          });
          break;
        }
        // Attribution (— Author on the last line) applies to a single-paragraph
        // quote; the body keeps its inline formatting via `html`. Structured
        // quotes (lists, multiple blocks) render their markup through `html` too.
        const attrib = extractAttribution(bq);
        elements.push(attrib
          ? { type: 'blockquote', text: attrib.children.map((c) => toString(c)).join(''), attribution: attrib.attribution, html: `<p>${inlineToHtml(attrib.children)}</p>` }
          : { type: 'blockquote', text: toString(bq), html: blockquoteInnerHtml(bq) });
        break;
      }

      case 'table': {
        const t = node as Table;
        const [headerRow, ...bodyRows] = t.children;
        const headers = (headerRow?.children ?? []).map((cell) => tableCellHtml(rawText(src, cell), cell.children as Node[]));
        let rows = bodyRows.map((row) => row.children.map((cell) => tableCellHtml(rawText(src, cell), cell.children as Node[])));

        if (pendingSheet) {
          // Raw source, not mdast: remark reads `=a*b*c` as `a<em>b</em>c`.
          const rawCells = t.children.map((row) => row.children.map((cell) => rawText(src, cell)));
          const computed = evaluateSheet(rawCells, pendingSheet, constants);
          rows = bodyRows.map((row, r) =>
            row.children.map((cell, c) => {
              const value = computed[r + 1]?.[c];
              if (value != null) return tableCellHtml(value, []);
              // A literal cell keeps the HTML remark already built for it, so
              // `| !**Total** |` stays bold — minus the footer marker.
              const html = tableCellHtml(rawText(src, cell), cell.children as Node[]);
              return c === 0 && isFooterRow(rawCells[r + 1] ?? []) ? html.replace(/^!\s*/, '') : html;
            }),
          );
          pendingSheet = undefined;
        }

        elements.push({ type: 'table', headers, rows, align: t.align ?? undefined });
        break;
      }

      case 'html': {
        const htmlNode = node as { type: 'html'; value: string };
        const v = htmlNode.value.trim();
        if (v === '<!-- column-break -->') {
          elements.push({ type: 'column-break' });
        } else {
          const sheetMatch = v.match(/^<!-- kova-sheet:(\d+) -->$/);
          if (sheetMatch) {
            pendingSheet = sheets.get(Number(sheetMatch[1]));
            break;
          }
          const m = v.match(/^<!-- kova-el:(\d+) -->$/);
          if (m) {
            const el = placeholders.get(Number(m[1]));
            if (el?.type === 'caption') {
              const prev = elements[elements.length - 1];
              if (prev && (prev.type === 'image' || prev.type === 'mermaid' || prev.type === 'math' || prev.type === 'table')) {
                elements[elements.length - 1] = { ...prev, caption: el.text };
              } else {
                elements.push({ type: 'paragraph', text: '', html: "#ERR !caption must directly follow an image, diagram, formula, or table" });
              }
            } else if (el) {
              elements.push(el);
            }
          } else if (v === '<hr>' || v === '<hr/>' || v === '<hr />') {
            elements.push({ type: 'paragraph', text: '', html: '<hr>' });
          } else {
            const stepVal = matchStepMarker(v);
            if (stepVal !== undefined) mergeStepMarker(elements, stepVal, assignStep);
          }
        }
        break;
      }

      case 'thematicBreak':
        // --- is intercepted as a slide separator before parsing; thematicBreak here means *** or ___
        elements.push({ type: 'paragraph', text: '', html: '<hr>' });
        break;

      case 'yaml':
        break;

      default:
        break;
    }
  }

  // A !sheet as the last block on the slide has no following node to trip the
  // check above, so report it here instead of dropping it silently.
  if (pendingSheet) {
    elements.push({ type: 'paragraph', text: '', html: '#ERR !sheet must sit directly above a table' });
  }

  return { title, titleLevel, elements };
}

function convertParagraph(p: Paragraph, assignStep: StepAssigner): SlideElement[] {
  const { children, step } = extractTrailingStep(p.children as Node[], assignStep);
  const pp: Paragraph = { ...p, children: children as Paragraph['children'] };

  // Single standalone image (most common case)
  if (pp.children.length === 1 && pp.children[0].type === 'image') {
    const img = pp.children[0];
    return [{ type: 'image', src: img.url, alt: img.alt ?? '', title: img.title ?? undefined, step }];
  }

  // Mixed paragraph: text + image(s) with no blank line between them.
  // Split on image boundaries so the layout engine can detect images correctly.
  if (pp.children.some((c) => c.type === 'image')) {
    const results: SlideElement[] = [];
    let buf: typeof pp.children = [];

    const flushBuf = () => {
      if (!buf.length) return;
      const text = buf.map((n) => toString(n)).join('').trim();
      if (text) results.push({ type: 'paragraph', text, html: inlineToHtml(buf as Node[]) });
      buf = [];
    };

    for (const child of pp.children) {
      if (child.type === 'image') {
        flushBuf();
        results.push({ type: 'image', src: child.url, alt: child.alt ?? '', title: child.title ?? undefined });
      } else {
        buf.push(child);
      }
    }
    flushBuf();
    // A mixed paragraph's trailing marker applies to the line as a whole —
    // attach it to whichever element ends up last (image or trailing text).
    if (step !== undefined && results.length > 0) {
      results[results.length - 1] = { ...results[results.length - 1], step } as SlideElement;
    }
    return results;
  }

  // Plain paragraph — discard whitespace-only nodes (trailing blank lines etc.)
  const text = toString(pp);
  if (!text.trim()) return [];
  return [{ type: 'paragraph', text, html: inlineToHtml(pp.children as Node[]), step }];
}

function convertListItem(item: MdastListItem, assignStep: StepAssigner): ListItem {
  const subList = item.children.find((c): c is List => c.type === 'list');
  const paragraphs = item.children.filter((c) => c.type === 'paragraph') as Paragraph[];
  let step: number | undefined;
  const processed = paragraphs.map((p, i) => {
    if (i !== paragraphs.length - 1) return p;
    const extracted = extractTrailingStep(p.children as Node[], assignStep);
    step = extracted.step;
    return { ...p, children: extracted.children as Paragraph['children'] };
  });
  const text = processed.map((p) => toString(p)).join(' ');
  const html = processed.map((p) => inlineToHtml(p.children)).join(' ');
  return {
    text,
    html,
    step,
    children: subList ? subList.children.map((c) => convertListItem(c, assignStep)) : [],
  };
}

// ── Step-marker attachment ───────────────────────────────────────────────────

// Types that a `<!-- step -->` marker can never attach to: a plain paragraph
// already has the simpler trailing-inline form (below), and a column-break is
// a layout marker with no visible content of its own. A type predicate (not a
// plain boolean) so the caller's `prev` narrows away 'column-break' — the one
// variant with no `step` field — before accessing `.step` below.
function isStepEligible(el: SlideElement): el is Exclude<SlideElement, { type: 'paragraph' } | { type: 'column-break' }> {
  return el.type !== 'paragraph' && el.type !== 'column-break';
}

// A trailing `<!-- step -->` / `<!-- step: N -->` on the same source line as a
// paragraph or list item arrives from remark as an ordinary inline `html` node
// — the last child of the paragraph's own children, the same mechanism
// inlineToHtml's `case 'html'` already special-cases for bare <u>/</u>. Strips
// it (and any whitespace it leaves trailing on the preceding text node) before
// the caller computes `text`/`html`, so it never leaks into either.
function extractTrailingStep(children: Node[], assignStep: StepAssigner): { children: Node[]; step?: number } {
  const last = children[children.length - 1] as { type?: string; value?: string } | undefined;
  if (!last || last.type !== 'html' || typeof last.value !== 'string') return { children };
  const explicit = matchStepMarker(last.value);
  if (explicit === undefined) return { children };

  const rest = children.slice(0, -1);
  const newLast = rest[rest.length - 1] as { type?: string; value?: string } | undefined;
  if (newLast && newLast.type === 'text' && typeof newLast.value === 'string') {
    rest[rest.length - 1] = { ...newLast, value: newLast.value.replace(/\s+$/, '') } as Node;
  }
  return { children: rest, step: assignStep(explicit) };
}

// A `<!-- step -->` on its own line, immediately after a block element with
// no trailing-inline-text option (image, code, table, math, mermaid,
// blockquote, a whole list, or a bang-directive embed) — mirrors `!caption`'s
// "must directly follow" convention exactly, including the #ERR fallback for
// a misplaced marker.
function mergeStepMarker(elements: SlideElement[], explicit: number | null, assignStep: StepAssigner): void {
  const prev = elements[elements.length - 1];
  if (!prev || !isStepEligible(prev)) {
    elements.push({
      type: 'paragraph', text: '',
      html: '#ERR <!-- step --> must directly follow a list, image, diagram, formula, table, blockquote, code block, YouTube embed, video, poll, progress bar, or table of contents',
    });
    return;
  }
  if (prev.step !== undefined) {
    elements.push({ type: 'paragraph', text: '', html: '#ERR duplicate <!-- step --> marker' });
    return;
  }
  const step = assignStep(explicit);
  elements[elements.length - 1] = prev.type === 'list'
    ? { ...prev, step, items: clearListItemSteps(prev.items) }
    : { ...prev, step };
}

// A whole-list step marker gates every item together on one click — any
// per-item markers written inside that same list would be redundant/
// conflicting with the whole-list gate, so clear them rather than leaving two
// competing sources of truth for the same items.
function clearListItemSteps(items: ListItem[]): ListItem[] {
  return items.map((item) => ({
    ...item,
    step: undefined,
    children: item.children.length ? clearListItemSteps(item.children) : item.children,
  }));
}

// Obsidian/GitHub-style callout marker: the first line of a blockquote reading
// `[!type]` (optionally `[!type] Custom Title`) turns it into an admonition box
// instead of a plain quote. `type` is folded to one of five canonical styles via
// CALLOUT_ALIASES so common synonyms (caution, error, hint, ...) still render
// sensibly instead of falling back to a generic look.
const CALLOUT_STYLES = new Set(['note', 'tip', 'warning', 'danger', 'info']);
const CALLOUT_ALIASES: Record<string, string> = {
  hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip',
  caution: 'warning', attention: 'warning',
  error: 'danger', failure: 'danger', fail: 'danger', bug: 'danger', missing: 'danger',
  question: 'info', help: 'info', faq: 'info',
  abstract: 'note', summary: 'note', tldr: 'note', quote: 'note', cite: 'note', example: 'note',
};
const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)\s*(.*)$/;

function resolveCalloutStyle(rawType: string): string {
  const key = rawType.toLowerCase();
  return CALLOUT_STYLES.has(key) ? key : (CALLOUT_ALIASES[key] ?? 'note');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Detects a `[!type]` marker on the blockquote's first line and splits it off,
// returning the resolved style, display title, and the remaining body nodes.
// Returns null for a plain (non-callout) blockquote.
function extractCallout(bq: Blockquote): { calloutType: string; title: string; children: Node[] } | null {
  const first = bq.children[0];
  if (!first || first.type !== 'paragraph') return null;
  const kids = [...(first as Paragraph).children] as any[];
  const firstKid = kids[0];
  if (!firstKid || firstKid.type !== 'text') return null;

  const value = firstKid.value as string;
  const nl = value.indexOf('\n');
  const firstLine = nl < 0 ? value : value.slice(0, nl);
  const m = firstLine.match(CALLOUT_RE);
  if (!m) return null;

  const calloutType = resolveCalloutStyle(m[1]);
  const title = m[3].trim() || capitalize(m[1]);
  const rest = nl < 0 ? '' : value.slice(nl + 1);

  let children: Node[];
  if (rest === '' && kids.length === 1) {
    // Marker line was the entire first paragraph — body is whatever follows it.
    children = bq.children.slice(1);
  } else {
    const newFirstKid = { ...firstKid, value: rest };
    const newPara: Paragraph = { ...(first as Paragraph), children: [newFirstKid, ...kids.slice(1)] };
    children = [newPara, ...bq.children.slice(1)];
  }

  return { calloutType, title, children };
}

// Blockquote children → HTML, preserving paragraphs and (nested) lists.
// Code/tables inside a quote are rare — fall back to their flattened text.
function blockquoteInnerHtml(bq: Blockquote): string {
  return bq.children.map((child) => {
    if (child.type === 'paragraph') return `<p>${inlineToHtml((child as Paragraph).children)}</p>`;
    if (child.type === 'list') return listToHtml(child as List);
    return `<p>${escHtml(toString(child))}</p>`;
  }).join('');
}

// A single-paragraph quote ending in a "— Author" line: split the attribution
// off the last text node, keeping the body's inline nodes intact for formatting.
function extractAttribution(bq: Blockquote): { children: Node[]; attribution: string } | null {
  if (bq.children.length !== 1 || bq.children[0].type !== 'paragraph') return null;
  const kids = [...(bq.children[0] as Paragraph).children] as any[];
  const last = kids[kids.length - 1];
  if (!last || last.type !== 'text') return null;
  const nl = (last.value as string).lastIndexOf('\n');
  if (nl < 0) return null;
  const tail = (last.value as string).slice(nl + 1);
  if (!/^\s*[—–\-]/.test(tail)) return null;
  const children = [...kids.slice(0, -1), { ...last, value: (last.value as string).slice(0, nl) }] as Node[];
  return { children, attribution: tail.replace(/^\s*[—–\-]\s*/, '') };
}

function listToHtml(l: List): string {
  const tag = l.ordered ? 'ol' : 'ul';
  const items = l.children.map((item) => {
    const mi = item as MdastListItem;
    const sub = mi.children.find((c): c is List => c.type === 'list');
    const inner = (mi.children.filter((c) => c.type === 'paragraph') as Paragraph[])
      .map((p) => inlineToHtml(p.children)).join(' ');
    return `<li>${inner}${sub ? listToHtml(sub) : ''}</li>`;
  }).join('');
  return `<${tag}>${items}</${tag}>`;
}

// ── Raw-source slicing ───────────────────────────────────────────────────────

// A sheet cell's formula must come from the source text, not from the parsed
// mdast: `=a*b*c` parses as `a<em>b</em>c` and would be silently corrupted.
// A tableCell's position spans its delimiting `|` characters too, so strip them
// (an unescaped `|` cannot occur inside a GFM cell).
function rawText(src: string, node: Node): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return '';
  return src.slice(start, end).replace(/^\s*\|/, '').replace(/(?<!\\)\|\s*$/, '').replace(/\\\|/g, '|').trim();
}

// ── Inline node → HTML ───────────────────────────────────────────────────────

// remark-gfm's autolink-literal extension (bare URLs, `www.` domains, email
// addresses) produces the exact same mdast `link` node shape as explicit
// `[text](url)` syntax, so the two can't be told apart by node.type. What
// does differ: an autolink's single text child is always the literal matched
// string, which equals the url itself (modulo the scheme/mailto: prefix that
// remark adds). Explicit links almost never have link text identical to
// their href, so this heuristic distinguishes them without needing the raw
// source text.
function isAutolink(node: { url: string; children: unknown[] }): boolean {
  if (node.children.length !== 1) return false;
  const child = node.children[0] as { type: string; value?: string };
  if (child.type !== 'text' || !child.value) return false;
  const text = child.value;
  const url = node.url;
  return url === text || url === `mailto:${text}` || url === `http://${text}` || url === `https://${text}`;
}

function inlineToHtml(children: Node[]): string {
  return (children as any[]).map((node) => {
    switch (node.type) {
      case 'text':        return escHtml(node.value as string).replace(/\n/g, '<br>');
      case 'strong':      return `<strong>${inlineToHtml(node.children)}</strong>`;
      case 'emphasis':    return `<em>${inlineToHtml(node.children)}</em>`;
      case 'delete':      return `<del>${inlineToHtml(node.children)}</del>`;
      case 'inlineCode':  return `<code>${escHtml(node.value as string)}</code>`;
      case 'link': {
        const cls = isAutolink(node) ? 'sl-link--auto' : 'sl-link';
        return `<a href="${escLinkUrl(node.url as string)}" class="${cls}">${inlineToHtml(node.children)}</a>`;
      }
      case 'image':       return `<img src="${escUrl(node.url as string)}" alt="${escHtml(node.alt ?? '')}" />`;
      case 'break':       return '<br>';
      case 'inlineMath': {
        try {
          return katex.renderToString(node.value as string, { displayMode: false, throwOnError: false });
        } catch {
          return `<code>${escHtml(node.value as string)}</code>`;
        }
      }
      // Raw HTML inlines from the editor (e.g. Mod-U → <u>…</u>). remark emits
      // bare `html` nodes with no children, so the default branch would drop them.
      case 'html': {
        const v = String(node.value ?? '').trim().toLowerCase();
        if (v === '<u>' || v === '</u>') return String(node.value).trim();
        return '';
      }
      default:            return node.children ? inlineToHtml(node.children) : '';
    }
  }).join('');
}

function tableCellHtml(raw: string, children: Node[]): string {
  const progress = raw.trim().match(PROGRESS_RE);
  if (!progress) return children.length ? inlineToHtml(children) : escHtml(raw);
  return `<div class="sl-progress sl-progress--table">${progressBarInnerHtml(progress[1], parseFloat(progress[2]))}</div>`;
}

// Escapes '"' too, not just <>&: this is also used to build attribute values
// (e.g. an inline image's alt="…", always double-quoted in this file), where
// an unescaped '"' would let crafted markdown break out of the attribute and
// inject arbitrary HTML/attributes.
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// !ref[...] is a bracket-captured raw string that never goes through remark,
// so citations (which routinely italicise a journal name) got no emphasis at
// all. Only asterisks are parsed here, not underscores — citations commonly
// contain DOIs/URLs like 10.1000/journal_name where `_` is literal.
function referenceInlineToHtml(raw: string): string {
  let html = escHtml(raw);
  html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, (_m, b) => `<strong>${b}</strong>`);
  html = html.replace(/\*([^*]+)\*/g, (_m, i) => `<em>${i}</em>`);
  return html;
}

function escUrl(url: string): string {
  const lower = url.trim().toLowerCase();
  // Images stay on the network/local schemes; links also allow mailto:/tel:
  // via escLinkUrl (issue #176).
  const ALLOWED = ['https:', 'http:', 'asset:', 'tauri:'];
  if (!ALLOWED.some(s => lower.startsWith(s))) return '#';
  return url.replace(/"/g, '%22');
}

// A bare host with no path (`google.de`) or a filename (`notes.md`) look
// identical structurally, so this is inherently a guess — but links (unlike
// image srcs) are never resolved against the document directory, so a
// schemeless link target is assumed to be a web address rather than a local
// file. Matches "word.tld" optionally followed by a path/query/fragment.
const BARE_HOST_RE = /^[^\s/?#]+\.[a-z]{2,}(?:[/?#]|$)/i;

// Links commonly omit a scheme (`google.de`, `//google.de`) and authors
// expect them to just work (issue #142), unlike images which are normally
// local files. Treat protocol-relative and bare-host links as https; anything
// else unrecognised still falls through to escUrl's allow-list/strip.
// Contact schemes (mailto:/tel:) are allowed for links only (issue #176).
function escLinkUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return escUrl('https:' + trimmed);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && BARE_HOST_RE.test(trimmed)) {
    return escUrl('https://' + trimmed);
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) {
    return trimmed.replace(/"/g, '%22');
  }
  return escUrl(trimmed);
}

export type { Frontmatter };
