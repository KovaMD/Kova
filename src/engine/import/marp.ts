// ponytail: Tier 1 Marp import — maps the common-deck constructs onto Kova's
// existing layout/theme primitives via text passes. Real image sizing, theme
// fidelity, and multi-bg tiling are deliberately dropped (Tier 2). Per-slide
// text colour (`_color` / `_class: invert`) is now mapped onto Kova's native
// `<!-- color -->` / `<!-- _class: invert -->` directives.
//
// `![bg]` lines are preserved as native `![bg…](…)` so the parser can choose
// full-bleed (image-only) vs text-over-background (issue #169) — previously
// every bare `![bg]` was forced to `layout:full-bleed` + a plain image, which
// dropped overlay title/body.

import yaml from 'js-yaml';
import { formatBgLine, parseBgLine } from '../parser/bgImage';

export interface MarpImportResult {
  markdown: string;
  /** Human labels of simplified features, for the post-import count banner. */
  dropped: string[];
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SIZE_KW = /\b[wh]:\d+%?/g;
const COMMENT = /<!--([\s\S]*?)-->/g;
const FENCE_MARKER_RE = /^(`{3,}|~{3,})/;

export function isMarp(src: string): boolean {
  const m = src.match(FM_RE);
  return !!m && /^\s*marp\s*:\s*true\s*$/m.test(m[1]);
}

export function importMarp(src: string): MarpImportResult {
  const dropped: string[] = [];
  const dropTag = (label: string): string => {
    dropped.push(label);
    return `<!-- marp: dropped ${label} -->`;
  };

  // ── Frontmatter ────────────────────────────────────────────────────
  let body = src;
  const passFm: string[] = [];        // frontmatter lines copied verbatim
  const fmDropComments: string[] = []; // inline drop markers for dropped fm keys
  let aspect: string | null = null;
  const footer: { show_slide_number?: boolean; text?: string } = {};

  const fm = src.match(FM_RE);
  if (fm) {
    body = src.slice(fm[0].length);
    // Parse with the real YAML loader, not a line regex — Marp frontmatter can
    // carry block scalars (`style: |` with embedded CSS), nested maps, etc., and
    // a naive line-by-line parse would spray that CSS back out as bogus keys.
    let obj: Record<string, unknown>;
    try { obj = (yaml.load(fm[1], { schema: yaml.CORE_SCHEMA }) as Record<string, unknown>) ?? {}; }
    catch { obj = {}; }
    for (const [key, rawVal] of Object.entries(obj)) {
      const val = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal);
      switch (key) {
        case 'marp': break; // detect flag only
        case 'size':
          if (val === '4:3' || val === '16:9') aspect = val;
          else fmDropComments.push(dropTag(`size:${val}`));
          break;
        case 'paginate': if (rawVal === true || val === 'true') footer.show_slide_number = true; break;
        case 'footer': footer.text = val; break;
        case 'style': fmDropComments.push(dropTag('style')); break; // raw CSS — no value echoed
        case 'theme': case 'header':
        case 'backgroundColor': case 'color': case 'backgroundImage':
          fmDropComments.push(dropTag(`${key}:${val}`)); break;
        default:
          // Pass through simple scalar metadata (title/author/date). Skip nested
          // maps and multiline strings — unknown structured Marp config we can't map.
          // Use JSON.stringify for strings so YAML-special chars (: # [ etc.) are safe.
          if (typeof rawVal === 'string') { if (!rawVal.includes('\n')) passFm.push(`${key}: ${JSON.stringify(rawVal)}`); }
          else if (typeof rawVal === 'number' || typeof rawVal === 'boolean') passFm.push(`${key}: ${rawVal}`);
      }
    }
  }

  const fmLines = [...passFm];
  if (aspect) fmLines.push(`aspect_ratio: "${aspect}"`);
  if (Object.keys(footer).length) {
    fmLines.push('theme_overrides:', '  footer:', '    show: true');
    if (footer.text != null) fmLines.push(`    text: ${JSON.stringify(footer.text)}`);
    if (footer.show_slide_number) fmLines.push('    show_slide_number: true');
  }
  const kovaFm = fmLines.length ? `---\n${fmLines.join('\n')}\n---\n\n` : '';

  // ── Body / slides ──────────────────────────────────────────────────
  const slides = splitSlides(body).map((s) => transformSlide(s, dropTag));
  const prefix = fmDropComments.length ? fmDropComments.join('\n') + '\n\n' : '';

  return {
    markdown: kovaFm + prefix + slides.join('\n---\n').replace(/^\n+/, ''),
    dropped,
  };
}

function splitSlides(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const slides: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE_MARKER_RE.test(line)) inFence = !inFence;
    if (!inFence && line === '---') {
      slides.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  slides.push(current.join('\n'));
  return slides;
}

// Half-open char-offset ranges of every line that lies strictly inside a
// fenced code block, using the same ```/~~~ toggle splitSlides above and
// extractBgImage (../parser/bgImage.ts) already use. Passes 2 and 3 in
// transformSlide operate on the whole reassembled slide via a single
// whole-string regex .replace() rather than a line loop, so they can't reuse
// that toggle directly the way splitSlides/Pass 1 do — this gives them an
// offset-based equivalent instead, so a slide *documenting* Marp/Kova syntax
// inside a fenced code sample doesn't get its example content mistaken for a
// live directive.
function computeFencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const parts = text.split(/(\r\n|\r|\n)/); // alternating: line, delimiter, line, ...
  let inFence = false;
  let offset = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    if (FENCE_MARKER_RE.test(line)) inFence = !inFence;
    else if (inFence) ranges.push([offset, offset + line.length]);
    offset += line.length + (parts[i + 1]?.length ?? 0);
  }
  return ranges;
}

function transformSlide(slide: string, dropTag: (l: string) => string): string {
  const notes: string[] = [];
  const out: string[] = [];
  let bgUsed = false;

  // Pass 1: preserve Marp `![bg…](…)` as native bg lines so overlay text is
  // kept (native parser sets backgroundImage when the slide has title/body).
  // Fence-aware (same toggle as splitSlides/computeFencedRanges above) so a
  // slide *documenting* `![bg]` syntax inside a fenced code sample isn't
  // mistaken for a live background directive.
  let inFence = false;
  for (const line of slide.split(/\r?\n/)) {
    if (FENCE_MARKER_RE.test(line)) { inFence = !inFence; out.push(line); continue; }
    if (!inFence) {
      const parsed = parseBgLine(line);
      if (parsed) {
        // Percentage / explicit Marp size tokens we don't map — log and drop.
        // `fit`/`contain` are kept via formatBgLine; bare `cover` is the default.
        const mods = (line.match(/^!\[bg([^\]]*)\]/)?.[1] ?? '');
        if (/(\d+%|:\s*\d)/.test(mods)) dropTag('bg-sizing');
        if (bgUsed) { out.push(dropTag('bg-extra')); continue; }
        bgUsed = true;
        out.push(formatBgLine(parsed));
        continue;
      }
    }
    out.push(line);
  }
  let text = out.join('\n');

  // Passes 2-3 operate on the whole reassembled string via a single
  // whole-string regex .replace() rather than a line loop, so fence-awareness
  // works by offset instead: compute the fence-protected ranges of `text`
  // once (re-derived here since Pass 1 rebuilt the string above, so any
  // range computed against the original `slide` no longer lines up), and
  // skip any match whose start offset falls inside one.
  const fencedRanges = computeFencedRanges(text);
  const isFenced = (offset: number) => fencedRanges.some(([s, e]) => offset >= s && offset < e);

  // Pass 2: inline image sizing `![w:200 h:100](url)` → strip keywords.
  text = text.replace(/!\[([^\]]*)\]/g, (m, alt: string, offset: number) => {
    if (isFenced(offset) || !/\b[wh]:\d+%?/.test(alt)) return m;
    dropTag('image-size');
    return `![${alt.replace(SIZE_KW, '').replace(/\s+/g, ' ').trim()}]`;
  });

  // Pass 3: comments. _class:lead → layout:title; _class:invert → color invert;
  // _color → per-slide text colour. Other Marp directives dropped; our own/Kova
  // directives kept; anything else = a Marp speaker note.
  text = text.replace(COMMENT, (full, inner: string, offset: number) => {
    if (isFenced(offset)) return full;
    const c = inner.trim();
    const cls = c.match(/^_class\s*:\s*(.+)$/);
    if (cls) {
      // `lead` and `invert` are independent Kova directives (layout override,
      // per-slide colour invert) and markdownToSlides.ts matches each on its
      // own regex, so both can be emitted together — `_class: lead invert`
      // (a common Marp dark-title-slide pattern) used to only keep whichever
      // of the two an early `if...return` hit first, silently dropping the
      // other with no dropTag record of the loss.
      const classes = cls[1].trim().split(/\s+/);
      const known = new Set(['lead', 'invert']);
      const parts: string[] = [];
      if (classes.includes('lead')) parts.push('<!-- layout:title -->');
      if (classes.includes('invert')) parts.push('<!-- _class: invert -->');
      const unknown = classes.filter((cl) => !known.has(cl));
      if (unknown.length) dropTag(`_class:${unknown.join(' ')}`);
      return parts.join('\n');
    }
    const color = c.match(/^_?color\s*:\s*(.+)$/);
    if (color) {
      return `<!-- color: ${color[1].trim()} -->`;
    }
    if (/^_/.test(c) || /^(paginate|theme|header|backgroundColor|backgroundImage)\b/.test(c)) {
      dropTag(c.split(/[\s:]/)[0]);
      return '';
    }
    if (/^layout\s*:/.test(c) || c === 'hidden' || /^marp: dropped/.test(c)) return full;
    notes.push(c); // leftover comment = presenter note
    return '';
  });

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (notes.length) text += `\n\n???\n${notes.join('\n')}`;
  return text + '\n';
}
