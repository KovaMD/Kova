import yaml from 'js-yaml';
import { parseDocument } from './markdownToSlides';
import { COLOR_COMMENT_RE, parseColorValue } from './colorValue';
import { localPathFromMediaSrc } from '../resolveMediaPath';
import type { LayoutType, ListItem, Slide } from '../types';

// Validation pass behind `kova --check` (docs/plans/kova-cli.md, Phase F).
// Deliberately not a general linter: every diagnostic here maps to something
// that visibly breaks a presentation or silently changes it. The parser
// itself stays lenient — this is a separate, opt-in pass over the same input.

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  /** 1-based line in the source document; 0 when no single line applies. */
  line: number;
  severity: DiagnosticSeverity;
  message: string;
}

export interface CheckContext {
  /** Directory of the document, for resolving relative media paths. */
  docDir: string;
  /** Known theme ids (built-in + installed community themes). */
  themeIds: string[];
  /** Existence probe for local media paths (IPC-backed in the app, mocked in tests). */
  fileExists: (path: string) => Promise<boolean>;
  /** Optional reachability probe for remote HTTP(S) media URLs. */
  urlReachable?: (url: string) => Promise<string | null>;
}

const KNOWN_FRONTMATTER_KEYS = new Set([
  'title', 'author', 'theme', 'theme_overrides', 'aspect_ratio', 'date', 'logo', 'footer',
]);

// Record keyed by LayoutType so the compiler forces this to stay exhaustive
// when a layout is added to ../types.ts.
const LAYOUT_SET: Record<LayoutType, true> = {
  'title': true, 'section': true, 'title-content': true, 'title-image': true,
  'split': true, 'full-bleed': true, 'quote': true, 'two-column': true,
  'three-column': true, 'bsp': true, 'grid': true, 'media': true,
  'code': true, 'math': true, 'blank': true,
};
const KNOWN_LAYOUTS = new Set(Object.keys(LAYOUT_SET));

// Keep in sync with the !directive regexes in markdownToSlides.ts (including
// its RESERVED_RE words) and LET_RE in ../sheet/constants.ts.
const KNOWN_DIRECTIVES = new Set([
  'youtube', 'video', 'poll', 'progress', 'caption', 'ref', 'toc', 'sheet', 'let',
  'include', 'fmt', 'code',
]);

// Must match extractFrontmatter's block detection (frontmatter.ts).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

const LAYOUT_COMMENT_RE = /<!--\s*layout:\s*(\S+)\s*-->/;
// A bang-directive word; deliberately does not match image syntax `![alt](…)`.
const DIRECTIVE_RE = /^!([a-zA-Z][a-zA-Z0-9]*)/;
const FENCE_RE = /^\s*(```|~~~)/;

/** 1-based line of the first occurrence of `needle`; 0 if not found. */
function lineOf(content: string, needle: string): number {
  const idx = content.indexOf(needle);
  return idx < 0 ? 0 : content.slice(0, idx).split('\n').length;
}

function collectHtmlSrcs(html: string, out: string[]): void {
  for (const match of html.matchAll(/src="([^"]*)"/g)) out.push(match[1]);
}

function collectItemSrcs(item: ListItem, out: string[]): void {
  collectHtmlSrcs(item.html, out);
  item.children.forEach((c) => collectItemSrcs(c, out));
}

function remoteHttpMediaUrl(src: string): string | null {
  const trimmed = src.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/** All raw media srcs referenced by a slide, in source order. */
function collectSlideSrcs(slide: Slide): string[] {
  const out: string[] = [];
  if (slide.backgroundImage) out.push(slide.backgroundImage.src);
  for (const el of slide.elements) {
    if (el.type === 'image' || el.type === 'video') out.push(el.src);
    else if (el.type === 'paragraph') collectHtmlSrcs(el.html, out);
    else if (el.type === 'list') el.items.forEach((i) => collectItemSrcs(i, out));
  }
  return out;
}

export async function collectDiagnostics(content: string, ctx: CheckContext): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];

  // Frontmatter YAML errors — extractFrontmatter swallows these (parse failure
  // falls back to an empty frontmatter), so re-parse here to surface them.
  const fmMatch = content.match(FRONTMATTER_RE);
  let fm: Record<string, unknown> = {};
  if (fmMatch) {
    try {
      const parsed = yaml.load(fmMatch[1], { schema: yaml.CORE_SCHEMA });
      if (parsed && typeof parsed === 'object') fm = parsed as Record<string, unknown>;
    } catch (e) {
      const mark = (e as { mark?: { line?: number } }).mark;
      // mark.line is 0-based within the YAML block; document line 1 is `---`.
      const line = mark?.line != null ? mark.line + 2 : 0;
      const firstLine = e instanceof Error ? e.message.split('\n')[0] : String(e);
      diags.push({ line, severity: 'error', message: `frontmatter YAML: ${firstLine}` });
    }

    const fmLines = fmMatch[1].split(/\r?\n/);
    for (const key of Object.keys(fm)) {
      if (KNOWN_FRONTMATTER_KEYS.has(key)) continue;
      const i = fmLines.findIndex((l) => l.startsWith(`${key}:`));
      diags.push({
        line: i >= 0 ? i + 2 : 0,
        severity: 'warning',
        message: `unknown frontmatter key '${key}'`,
      });
    }

    if (typeof fm.theme === 'string' && !ctx.themeIds.includes(fm.theme)) {
      const i = fmLines.findIndex((l) => l.startsWith('theme:'));
      diags.push({
        line: i >= 0 ? i + 2 : 0,
        severity: 'warning',
        message: `unknown theme '${fm.theme}' (Kova will fall back to the default theme)`,
      });
    }
  }

  // Line scan: unknown layout names and unknown bang-directives, skipping
  // fenced code blocks (a code sample containing `!something` is not a
  // directive; mirrors the fence handling in sheet/constants.ts).
  let inFence = false;
  content.split('\n').forEach((rawLine, i) => {
    const line = rawLine.trimEnd();
    if (FENCE_RE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;

    const layout = line.match(LAYOUT_COMMENT_RE);
    if (layout && !KNOWN_LAYOUTS.has(layout[1])) {
      diags.push({ line: i + 1, severity: 'error', message: `unknown layout '${layout[1]}'` });
    }

    const color = line.match(COLOR_COMMENT_RE);
    if (color && parseColorValue(color[1]) === undefined) {
      diags.push({
        line: i + 1,
        severity: 'warning',
        message: `invalid color '${color[1].trim()}'`,
      });
    }

    const directive = line.trimStart().match(DIRECTIVE_RE);
    if (directive && !KNOWN_DIRECTIVES.has(directive[1])) {
      diags.push({ line: i + 1, severity: 'error', message: `unknown directive '!${directive[1]}'` });
    }
  });

  // Parse the document. The parser is lenient by design; an outright throw is
  // itself a diagnostic rather than a crash of the check.
  let slides: Slide[] = [];
  try {
    slides = parseDocument(content).slides;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diags.push({ line: 0, severity: 'error', message: `failed to parse document: ${msg}` });
    return diags;
  }

  const visible = slides.filter((s) => !s.hidden);
  if (visible.length === 0) {
    diags.push({ line: 0, severity: 'error', message: 'document contains no visible slides' });
  }

  // Local media existence and optional remote URL reachability checks.
  // Hidden slides are skipped (they don't render). Dedupe by resolved path /
  // URL so one missing reference used on five slides reports once.
  const seenLocal = new Set<string>();
  const seenRemote = new Set<string>();
  const remoteUrls: string[] = [];
  for (const slide of visible) {
    for (const src of collectSlideSrcs(slide)) {
      const local = localPathFromMediaSrc(src, ctx.docDir);
      if (local) {
        if (seenLocal.has(local)) continue;
        seenLocal.add(local);
        if (!(await ctx.fileExists(local))) {
          diags.push({
            line: lineOf(content, src),
            severity: 'error',
            message: `media file not found: '${src}'`,
          });
        }
        continue;
      }
      const remote = remoteHttpMediaUrl(src);
      if (!remote || seenRemote.has(remote)) continue;
      seenRemote.add(remote);
      remoteUrls.push(remote);
    }
  }

  if (ctx.urlReachable) {
    for (const url of remoteUrls) {
      let reason: string | null;
      try {
        reason = await ctx.urlReachable(url);
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }
      if (!reason) continue;
      diags.push({
        line: lineOf(content, url),
        severity: 'warning',
        message: `remote media URL not reachable: '${url}' (${reason})`,
      });
    }
  }

  return diags;
}

/** Terminal report: one `FILE:LINE: severity: message` per line, sorted by
 *  line, with the `N error(s), M warning(s)` summary last. */
export function formatCheckReport(
  file: string,
  diags: Diagnostic[],
): { report: string; errors: number; warnings: number } {
  const sorted = [...diags].sort((a, b) => a.line - b.line);
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.length - errors;
  const lines = sorted.map((d) => `${file}:${d.line}: ${d.severity}: ${d.message}`);
  lines.push(`${errors} error(s), ${warnings} warning(s)`);
  return { report: lines.join('\n'), errors, warnings };
}
