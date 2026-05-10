import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import type { Root, Node, Paragraph, List, ListItem as MdastListItem, Code, Blockquote, Table, Heading } from 'mdast';

import type { Slide, SlideElement, ListItem, LayoutType, Frontmatter, ParsedDocument } from '../types';
import { detectLayout } from '../layout/autoLayout';
import { extractFrontmatter } from './frontmatter';
import { extractSpeakerNotes } from './speakerNotes';

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseDocument(rawContent: string): ParsedDocument {
  const normalised = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { frontmatter, body } = extractFrontmatter(normalised);
  const rawSlides = body.split(/^---$/m).map((s) => s.trim()).filter(Boolean);
  const slides = rawSlides.map((raw, index) => parseSlide(raw, index));
  return { slides, frontmatter };
}

// ── Per-slide parser ─────────────────────────────────────────────────────────

function parseSlide(raw: string, index: number): Slide {
  // Extract layout override from HTML comment before anything else
  const layoutOverrideMatch = raw.match(/<!--\s*layout:\s*(\S+)\s*-->/);
  const layoutOverride = layoutOverrideMatch
    ? (layoutOverrideMatch[1] as LayoutType)
    : undefined;

  // Preprocess before speaker-notes extraction so ??? inside custom URLs is not
  // misinterpreted as speaker-note markers. Custom elements become inline HTML
  // comment placeholders so remark preserves their position in the element list.
  const { cleanContent, placeholders } = preprocess(raw);
  const { content, notes } = extractSpeakerNotes(cleanContent);

  const tree = processor.parse(content) as Root;
  const { title, titleLevel, elements } = convertRoot(tree, placeholders);

  const layout = layoutOverride ?? detectLayout(elements, titleLevel, !!title);

  return { index, raw, title, titleLevel, elements, speakerNotes: notes, layout, layoutOverride };
}

// ── Custom syntax pre-processor ──────────────────────────────────────────────

interface PreprocessResult {
  cleanContent: string;
  placeholders: Map<number, SlideElement>;
}

const YOUTUBE_RE  = /^!youtube\[([^\]]*)\]\(([^)]*)\)$/;
const POLL_RE     = /^!poll\[([^\]]*)\]\(([^)]*)\)$/;
const PROGRESS_RE = /^!progress\[([^\]]*)\]\((\d+(?:\.\d+)?)\)$/;

function preprocess(content: string): PreprocessResult {
  const placeholders = new Map<number, SlideElement>();
  let nextIdx = 0;
  const cleanLines: string[] = [];

  for (const line of content.split('\n')) {
    const t = line.trim();

    if (t === '|||') {
      cleanLines.push('<!-- column-break -->');
      continue;
    }

    const yt = t.match(YOUTUBE_RE);
    if (yt) {
      const idx = nextIdx++;
      placeholders.set(idx, { type: 'youtube', label: yt[1], url: yt[2] });
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

    // Strip layout override comments (already captured above)
    if (/^<!--\s*layout:/.test(t)) continue;

    cleanLines.push(line);
  }

  return { cleanContent: cleanLines.join('\n').trim(), placeholders };
}

// ── mdast → SlideElement converter ───────────────────────────────────────────

interface ConvertResult {
  title: string;
  titleLevel: number;
  elements: SlideElement[];
}

function convertRoot(tree: Root, placeholders: Map<number, SlideElement>): ConvertResult {
  let title = '';
  let titleLevel = 0;
  const elements: SlideElement[] = [];

  for (const node of tree.children) {
    switch (node.type) {
      case 'heading': {
        const h = node as Heading;
        if (!title) {
          title = toString(h);
          titleLevel = h.depth;
        } else {
          elements.push({
            type: 'paragraph',
            text: toString(h),
            html: `<h${h.depth}>${inlineToHtml(h.children)}</h${h.depth}>`,
          });
        }
        break;
      }

      case 'paragraph': {
        const p = node as Paragraph;
        for (const el of convertParagraph(p)) elements.push(el);
        break;
      }

      case 'list': {
        const l = node as List;
        elements.push({
          type: 'list',
          ordered: l.ordered ?? false,
          items: l.children.map(convertListItem),
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

      case 'blockquote': {
        const bq = node as Blockquote;
        const text = toString(bq);
        const lines = text.split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1] ?? '';
        const hasAttrib = lines.length > 1 && /^[—–\-]/.test(lastLine);
        elements.push({
          type: 'blockquote',
          text: hasAttrib ? lines.slice(0, -1).join('\n') : text,
          attribution: hasAttrib ? lastLine.replace(/^[—–\-]\s*/, '') : undefined,
        });
        break;
      }

      case 'table': {
        const t = node as Table;
        const [headerRow, ...bodyRows] = t.children;
        const headers = (headerRow?.children ?? []).map((cell) => toString(cell));
        const rows = bodyRows.map((row) => row.children.map((cell) => toString(cell)));
        elements.push({ type: 'table', headers, rows });
        break;
      }

      case 'html': {
        const htmlNode = node as { type: 'html'; value: string };
        const v = htmlNode.value.trim();
        if (v === '<!-- column-break -->') {
          elements.push({ type: 'column-break' });
        } else {
          const m = v.match(/^<!-- kova-el:(\d+) -->$/);
          if (m) {
            const el = placeholders.get(Number(m[1]));
            if (el) elements.push(el);
          } else if (v === '<hr>' || v === '<hr/>' || v === '<hr />') {
            elements.push({ type: 'paragraph', text: '', html: '<hr>' });
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

  return { title, titleLevel, elements };
}

function convertParagraph(p: Paragraph): SlideElement[] {
  // Single standalone image (most common case)
  if (p.children.length === 1 && p.children[0].type === 'image') {
    const img = p.children[0];
    return [{ type: 'image', src: img.url, alt: img.alt ?? '', title: img.title ?? undefined }];
  }

  // Mixed paragraph: text + image(s) with no blank line between them.
  // Split on image boundaries so the layout engine can detect images correctly.
  if (p.children.some((c) => c.type === 'image')) {
    const results: SlideElement[] = [];
    let buf: typeof p.children = [];

    const flushBuf = () => {
      if (!buf.length) return;
      const text = buf.map((n) => toString(n)).join('').trim();
      if (text) results.push({ type: 'paragraph', text, html: inlineToHtml(buf as Node[]) });
      buf = [];
    };

    for (const child of p.children) {
      if (child.type === 'image') {
        flushBuf();
        results.push({ type: 'image', src: child.url, alt: child.alt ?? '', title: child.title ?? undefined });
      } else {
        buf.push(child);
      }
    }
    flushBuf();
    return results;
  }

  // Plain paragraph — discard whitespace-only nodes (trailing blank lines etc.)
  const text = toString(p);
  if (!text.trim()) return [];
  return [{ type: 'paragraph', text, html: inlineToHtml(p.children as Node[]) }];
}

function convertListItem(item: MdastListItem): ListItem {
  const subList = item.children.find((c): c is List => c.type === 'list');
  const paragraphs = item.children.filter((c) => c.type === 'paragraph') as Paragraph[];
  const text = paragraphs.map((p) => toString(p)).join(' ');
  const html = paragraphs.map((p) => inlineToHtml(p.children)).join(' ');
  return {
    text,
    html,
    children: subList ? subList.children.map(convertListItem) : [],
  };
}

// ── Inline node → HTML ───────────────────────────────────────────────────────

function inlineToHtml(children: Node[]): string {
  return (children as any[]).map((node) => {
    switch (node.type) {
      case 'text':        return escHtml(node.value as string).replace(/\n/g, '<br>');
      case 'strong':      return `<strong>${inlineToHtml(node.children)}</strong>`;
      case 'emphasis':    return `<em>${inlineToHtml(node.children)}</em>`;
      case 'delete':      return `<del>${inlineToHtml(node.children)}</del>`;
      case 'inlineCode':  return `<code>${escHtml(node.value as string)}</code>`;
      case 'link':        return `<a href="${escUrl(node.url as string)}">${inlineToHtml(node.children)}</a>`;
      case 'image':       return `<img src="${escUrl(node.url as string)}" alt="${escHtml(node.alt ?? '')}" />`;
      case 'break':       return '<br>';
      default:            return node.children ? inlineToHtml(node.children) : '';
    }
  }).join('');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escUrl(url: string): string {
  const lower = url.trim().toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '#';
  return url.replace(/"/g, '%22');
}

export type { Frontmatter };
