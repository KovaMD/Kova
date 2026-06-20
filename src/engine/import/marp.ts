// ponytail: Tier 1 Marp import — maps the common-deck constructs onto Kova's
// existing layout/theme primitives via text passes. Per-slide colors, real
// image sizing, theme fidelity, and multi-bg tiling are deliberately dropped
// (Tier 2). Add those only when a real deck needs them.

import yaml from 'js-yaml';

export interface MarpImportResult {
  markdown: string;
  /** Human labels of simplified features, for the post-import count banner. */
  dropped: string[];
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// A background-image line, e.g. `![bg left:40%](path.jpg)`. Captures the
// modifier string and the URL (first whitespace-delimited token inside `()`).
const BG_LINE = /^!\[bg([^\]]*)\]\(\s*([^)\s]+)[^)]*\)\s*$/;
const SIZE_KW = /\b[wh]:\d+%?/g;
const COMMENT = /<!--([\s\S]*?)-->/g;

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
    let obj: Record<string, unknown> = {};
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
          if (typeof rawVal === 'string') { if (!rawVal.includes('\n')) passFm.push(`${key}: ${rawVal}`); }
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
  const slides = body.split(/^---$/m).map((s) => transformSlide(s, dropTag));
  const prefix = fmDropComments.length ? fmDropComments.join('\n') + '\n\n' : '';

  return {
    markdown: kovaFm + prefix + slides.join('\n---\n').replace(/^\n+/, ''),
    dropped,
  };
}

function transformSlide(slide: string, dropTag: (l: string) => string): string {
  const notes: string[] = [];
  const out: string[] = [];
  let bgUsed = false;

  // Pass 1: background-image lines → layout directive + plain image.
  for (const line of slide.split(/\r?\n/)) {
    const bg = line.match(BG_LINE);
    if (bg) {
      const mods = bg[1];
      // logged only — image is kept, just unsized
      if (/(fit|cover|\d+%|:\s*\d)/.test(mods)) dropTag('bg-sizing');
      if (bgUsed) { out.push(dropTag('bg-extra')); continue; }
      bgUsed = true;
      const layout = /\b(left|right)\b/.test(mods) ? 'split' : 'full-bleed';
      out.push(`<!-- layout:${layout} -->`, `![](${bg[2]})`);
      continue;
    }
    out.push(line);
  }
  let text = out.join('\n');

  // Pass 2: inline image sizing `![w:200 h:100](url)` → strip keywords.
  text = text.replace(/!\[([^\]]*)\]/g, (m, alt: string) => {
    if (!/\b[wh]:\d+%?/.test(alt)) return m;
    dropTag('image-size');
    return `![${alt.replace(SIZE_KW, '').replace(/\s+/g, ' ').trim()}]`;
  });

  // Pass 3: comments. _class:lead → layout:title; other Marp directives
  // dropped; our own/Kova directives kept; anything else = a Marp speaker note.
  text = text.replace(COMMENT, (full, inner: string) => {
    const c = inner.trim();
    const cls = c.match(/^_class\s*:\s*(.+)$/);
    if (cls) {
      if (cls[1].trim() === 'lead') return '<!-- layout:title -->';
      dropTag(`_class:${cls[1].trim()}`);
      return '';
    }
    if (/^_/.test(c) || /^(paginate|theme|header|backgroundColor|color|backgroundImage)\b/.test(c)) {
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
