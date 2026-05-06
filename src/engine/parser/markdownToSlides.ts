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
  const { frontmatter, body } = extractFrontmatter(rawContent);
  const rawSlides = body.split(/^---$/m).map((s) => s.trim()).filter(Boolean);
  const slides = rawSlides.map((raw, index) => parseSlide(raw, index));
  return { slides, frontmatter };
}

// ── Per-slide parser ─────────────────────────────────────────────────────────

function parseSlide(raw: string, index: number): Slide {
  const { content, notes } = extractSpeakerNotes(raw);

  // Extract layout override from HTML comment before remark sees it
  const layoutOverrideMatch = content.match(/<!--\s*layout:\s*(\S+)\s*-->/);
  const layoutOverride = layoutOverrideMatch
    ? (layoutOverrideMatch[1] as LayoutType)
    : undefined;

  // Pre-process: extract custom syntax lines before feeding to remark.
  // remark can't parse !youtube[...]() or !poll[...]() as special nodes.
  const { cleanContent, preExtracted } = preprocess(content);

  const tree = processor.parse(cleanContent) as Root;
  const { title, titleLevel, elements: mdElements } = convertRoot(tree);

  // Merge pre-extracted specials at the end (order within layout rules is by type, not position)
  const elements: SlideElement[] = [...mdElements, ...preExtracted];

  const layout = layoutOverride ?? detectLayout(elements, titleLevel, !!title);

  return { index, raw, title, titleLevel, elements, speakerNotes: notes, layout, layoutOverride };
}

// ── Custom syntax pre-processor ──────────────────────────────────────────────

interface Preprocessed {
  cleanContent: string;
  preExtracted: SlideElement[];
}

const YOUTUBE_RE  = /^!youtube\[([^\]]*)\]\(([^)]*)\)$/;
const POLL_RE     = /^!poll\[([^\]]*)\]\(([^)]*)\)$/;
const PROGRESS_RE = /^!progress\[([^\]]*)\]\((\d+(?:\.\d+)?)\)$/;

function preprocess(content: string): Preprocessed {
  const preExtracted: SlideElement[] = [];
  const cleanLines: string[] = [];

  for (const line of content.split('\n')) {
    const t = line.trim();

    if (t === '|||') {
      // Use an HTML comment so remark preserves position in the node tree.
      // If we pushed to preExtracted instead, the break would always end up
      // at the tail of elements and leave the right column empty.
      cleanLines.push('<!-- column-break -->');
      continue;
    }

    const yt = t.match(YOUTUBE_RE);
    if (yt) {
      preExtracted.push({ type: 'youtube', label: yt[1], url: yt[2] });
      continue;
    }

    const poll = t.match(POLL_RE);
    if (poll) {
      preExtracted.push({ type: 'poll', label: poll[1], url: poll[2] });
      continue;
    }

    const progress = t.match(PROGRESS_RE);
    if (progress) {
      preExtracted.push({ type: 'progress', label: progress[1], value: parseFloat(progress[2]) });
      continue;
    }

    // Strip layout override comments (already captured above)
    if (/^<!--\s*layout:/.test(t)) continue;

    cleanLines.push(line);
  }

  return { cleanContent: cleanLines.join('\n').trim(), preExtracted };
}

// ── mdast → SlideElement converter ───────────────────────────────────────────

interface ConvertResult {
  title: string;
  titleLevel: number;
  elements: SlideElement[];
}

function convertRoot(tree: Root): ConvertResult {
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
          // Subsequent headings become subheading paragraphs
          elements.push({
            type: 'paragraph',
            text: toString(h),
            html: `<strong>${inlineToHtml(h.children)}</strong>`,
          });
        }
        break;
      }

      case 'paragraph': {
        const p = node as Paragraph;
        const el = convertParagraph(p);
        if (el) elements.push(el);
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
        if (htmlNode.value.trim() === '<!-- column-break -->') {
          elements.push({ type: 'column-break' });
        }
        break;
      }
      case 'yaml':
      case 'thematicBreak':
        break;

      default:
        break;
    }
  }

  return { title, titleLevel, elements };
}

function convertParagraph(p: Paragraph): SlideElement | null {
  // Standalone image
  if (p.children.length === 1 && p.children[0].type === 'image') {
    const img = p.children[0];
    return { type: 'image', src: img.url, alt: img.alt ?? '', title: img.title ?? undefined };
  }

  const text = toString(p);
  const html = inlineToHtml(p.children);
  return { type: 'paragraph', text, html };
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
      case 'text':        return escHtml(node.value as string);
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
  return url.replace(/"/g, '%22');
}

export type { Frontmatter };
