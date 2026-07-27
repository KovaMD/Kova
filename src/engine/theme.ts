import yaml from 'js-yaml';

export interface ThemeColors {
  primary: string;       // title slide background, strong accents
  accent: string;        // links, highlights, decorative elements
  background: string;    // default slide background
  text: string;          // body text
  code_bg: string;       // code block background
  title_text: string;    // text on title/section slides (usually white)
  section_bg: string;    // section divider background
  chart_colors?: string[]; // optional palette override for diagrams (pie, xychart, timeline…)
  heading?: string;       // content-slide heading colour (falls back to `text` when unset)
  bold?: string;          // inline **bold**/<strong> colour (falls back to `text` when unset)
}

export interface ThemeFonts {
  title: string;
  body: string;
  code: string;
}

export interface RemoteFont {
  family: string;
  url: string;
  sha256: string;
  weight: string;    // e.g. "100 900" for variable, "400" or "700" for static
  style: 'normal' | 'italic';
}

export interface ThemeHeader {
  show: boolean;
  text: string;
}

export interface ThemeFooter {
  show: boolean;
  text: string;              // supports {title}, {date}
  show_slide_number: boolean;
}

export interface ThemeToc {
  /** Ordered (numbered, `<ol>`) vs. unordered (plain hyperlinked, `<ul>`) list. */
  numbered: boolean;
}

export interface ThemeLayout {
  /** Alignment of title/hero slide content */
  title_align: 'center' | 'left' | 'bottom-left';
  /** Text alignment for content slide headings */
  heading_align: 'left' | 'center';
  /** Geometric decoration layered onto title/section backgrounds */
  decoration: 'none' | 'dots' | 'grid' | 'diagonal' | 'bar-left';
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  layout: ThemeLayout;
  logo?: string;
  logo_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logo_opacity: number;
  header: ThemeHeader;
  footer: ThemeFooter;
  toc: ThemeToc;
  /** Font families to load from the app's bundled font assets (OFL fonts). */
  bundledFonts?: string[];
  /** Remote fonts to download-once, verify, and cache locally. */
  remoteFonts?: RemoteFont[];
}

// ── Built-in themes ───────────────────────────────────────────────────────────

const CENTER_LAYOUT: ThemeLayout = { title_align: 'center', heading_align: 'left', decoration: 'none' };

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'light',
    name: 'Light',
    colors: {
      primary: '#1B3A5C',
      accent: '#2563EB',
      background: '#FFFFFF',
      text: '#1a1a1a',
      code_bg: '#1B3A5C',
      title_text: '#FFFFFF',
      section_bg: '#1B3A5C',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
    },
    layout: CENTER_LAYOUT,
    logo_position: 'top-right',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: false, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
  {
    id: 'dark',
    name: 'Dark',
    colors: {
      primary: '#111827',
      accent: '#C07A30',
      background: '#1F2937',
      text: '#F3F4F6',
      code_bg: '#111827',
      title_text: '#F3F4F6',
      section_bg: '#374151',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
    },
    layout: CENTER_LAYOUT,
    logo_position: 'top-right',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: false, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
  {
    id: 'institutional',
    name: 'Institutional',
    colors: {
      primary: '#003366',
      accent: '#CC0000',
      background: '#FFFFFF',
      text: '#111111',
      code_bg: '#003366',
      title_text: '#FFFFFF',
      section_bg: '#003366',
    },
    fonts: {
      title: 'Georgia, Times New Roman, serif',
      body: 'Arial, Helvetica, sans-serif',
      code: 'Courier New, Courier, monospace',
    },
    layout: CENTER_LAYOUT,
    logo_position: 'top-right',
    logo_opacity: 0.85,
    header: { show: true, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    colors: {
      primary: '#222222',
      accent: '#444444',
      background: '#FAFAFA',
      text: '#222222',
      code_bg: '#1a1a1a',
      title_text: '#FAFAFA',
      section_bg: '#222222',
    },
    fonts: {
      title: 'Georgia, Times New Roman, serif',
      body: 'Georgia, Times New Roman, serif',
      code: 'Menlo, Monaco, Consolas, monospace',
    },
    layout: CENTER_LAYOUT,
    logo_position: 'bottom-right',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
    toc: { numbered: true },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    colors: {
      primary: '#1A1A2E',
      accent: '#E94560',
      background: '#F7F3EE',
      text: '#1A1A2E',
      code_bg: '#1A1A2E',
      title_text: '#F7F3EE',
      section_bg: '#E94560',
    },
    fonts: {
      title: 'Georgia, Times New Roman, serif',
      body: 'Georgia, Charter, serif',
      code: 'Menlo, Monaco, monospace',
    },
    layout: CENTER_LAYOUT,
    logo_position: 'top-right',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
  {
    id: 'slate',
    name: 'Slate',
    colors: {
      primary: '#1E293B',
      accent: '#38BDF8',
      background: '#F8FAFC',
      text: '#1E293B',
      code_bg: '#0f172a',
      title_text: '#F8FAFC',
      section_bg: '#334155',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, monospace',
    },
    layout: { title_align: 'left', heading_align: 'left', decoration: 'none' },
    logo_position: 'top-left',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
  {
    id: 'pitch',
    name: 'Pitch',
    colors: {
      primary: '#0A0A0A',
      accent: '#FF4500',
      background: '#FFFFFF',
      text: '#0A0A0A',
      code_bg: '#111111',
      title_text: '#FFFFFF',
      section_bg: '#111111',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, monospace',
    },
    layout: { title_align: 'bottom-left', heading_align: 'left', decoration: 'none' },
    logo_position: 'top-left',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
    toc: { numbered: true },
  },
  {
    id: 'cosmos',
    name: 'Cosmos',
    colors: {
      primary: '#0D0D2B',
      accent: '#8B5CF6',
      background: '#F9FAFB',
      text: '#111827',
      code_bg: '#0D0D2B',
      title_text: '#F9FAFB',
      section_bg: '#1E1B4B',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, monospace',
    },
    layout: { title_align: 'center', heading_align: 'left', decoration: 'dots' },
    logo_position: 'top-right',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
  {
    id: 'forge',
    name: 'Forge',
    colors: {
      primary: '#1C1917',
      accent: '#F97316',
      background: '#FAFAF9',
      text: '#1C1917',
      code_bg: '#1C1917',
      title_text: '#FAFAF9',
      section_bg: '#292524',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, monospace',
    },
    layout: { title_align: 'bottom-left', heading_align: 'left', decoration: 'grid' },
    logo_position: 'top-left',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
    toc: { numbered: true },
  },
  {
    id: 'grove',
    name: 'Grove',
    colors: {
      primary: '#14532D',
      accent: '#10B981',
      background: '#F0FDF4',
      text: '#14532D',
      code_bg: '#14532D',
      title_text: '#F0FDF4',
      section_bg: '#166534',
    },
    fonts: {
      title: 'Georgia, Times New Roman, serif',
      body: 'Georgia, Times New Roman, serif',
      code: 'JetBrains Mono, Fira Code, monospace',
    },
    layout: { title_align: 'left', heading_align: 'left', decoration: 'diagonal' },
    logo_position: 'top-left',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
  {
    id: 'horizon',
    name: 'Horizon',
    colors: {
      primary: '#164E63',
      accent: '#06B6D4',
      background: '#F0FDFA',
      text: '#164E63',
      code_bg: '#164E63',
      title_text: '#F0FDFA',
      section_bg: '#155E75',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, monospace',
    },
    layout: { title_align: 'left', heading_align: 'left', decoration: 'bar-left' },
    logo_position: 'top-left',
    logo_opacity: 0.85,
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
    toc: { numbered: true },
  },
];

export const DEFAULT_THEME = BUILT_IN_THEMES[0]; // light

// ── Colour utilities (shared with renderer and inspector) ─────────────────────

export function hexToHsl(hex: string): [number, number, number] {
  if (!hex.startsWith('#') || hex.length < 7) return [0, 0, 0];
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Derives `count` perceptually distinct colours anchored to `accentHex`, 45° apart. */
export function defaultChartPalette(accentHex: string, count = 8): string[] {
  const [h, rawS, rawL] = hexToHsl(accentHex);
  const s = Math.min(Math.max(rawS, 0.60), 0.88);
  const l = Math.min(Math.max(rawL, 0.38), 0.58);
  return Array.from({ length: count }, (_, i) => hslToHex(h + i * (360 / count), s, l));
}

/** Mermaid cScale0..11 spun from an accent hue, clamped to a legible S/L band. */
export function buildCScalePalette(accent: string): Record<string, string> {
  const [h, rawS, rawL] = hexToHsl(accent);
  const s = Math.min(Math.max(rawS, 0.50), 0.80);
  const l = Math.min(Math.max(rawL, 0.38), 0.58);
  const out: Record<string, string> = {};
  for (let i = 0; i < 12; i++) out[`cScale${i}`] = hslToHex(h + i * 30, s, l);
  return out;
}

/** Mermaid pie1..12 spun from an accent hue, clamped to a legible S/L band. */
export function piePaletteFromAccent(accent: string): Record<string, string> {
  const [h, rawS, rawL] = hexToHsl(accent);
  const s = Math.min(Math.max(rawS, 0.55), 0.85);
  const l = Math.min(Math.max(rawL, 0.28), 0.48);
  const out: Record<string, string> = {};
  for (let i = 0; i < 12; i++) out[`pie${i + 1}`] = hslToHex(h + i * 30, s, l);
  return out;
}

// ── CSS variable mapping ──────────────────────────────────────────────────────

function decorationVars(d: ThemeLayout['decoration']): Record<string, string> {
  switch (d) {
    // Gradient stops are fully opaque (blended against --sl-primary via color-mix)
    // rather than using `transparent`, because WKWebView's native PDF snapshot
    // path (createPDFWithConfiguration, used on macOS PDF export) does not
    // alpha-composite a `transparent` gradient stop against the background-color
    // layer beneath it — it rasterizes it as opaque black instead (issue #152).
    case 'dots':
      return {
        '--sl-deco-img':  'radial-gradient(circle, color-mix(in srgb, white 18%, var(--sl-primary)) 1.5px, var(--sl-primary) 1.5px)',
        '--sl-deco-size': '28px 28px',
      };
    case 'grid':
      return {
        '--sl-deco-img':  'repeating-linear-gradient(color-mix(in srgb, white 6%, var(--sl-primary)) 1px, var(--sl-primary) 1px), repeating-linear-gradient(90deg, color-mix(in srgb, white 6%, var(--sl-primary)) 1px, var(--sl-primary) 1px)',
        '--sl-deco-size': '48px 48px',
      };
    case 'diagonal':
      return {
        '--sl-deco-img':  'repeating-linear-gradient(45deg, color-mix(in srgb, white 5%, var(--sl-primary)) 0, color-mix(in srgb, white 5%, var(--sl-primary)) 1px, var(--sl-primary) 0, var(--sl-primary) 50%)',
        '--sl-deco-size': '24px 24px',
      };
    case 'bar-left':
      return {
        '--sl-deco-img':  'linear-gradient(90deg, var(--sl-accent) 6px, var(--sl-primary) 6px)',
        '--sl-deco-size': 'auto',
      };
    default:
      return { '--sl-deco-img': 'none', '--sl-deco-size': 'auto' };
  }
}

function titleAlignVars(align: ThemeLayout['title_align']): Record<string, string> {
  switch (align) {
    case 'left':        return { '--sl-title-ax': 'flex-start', '--sl-title-ay': 'center',   '--sl-title-ta': 'left',   '--sl-title-pb': '8%'  };
    case 'bottom-left': return { '--sl-title-ax': 'flex-start', '--sl-title-ay': 'flex-end', '--sl-title-ta': 'left',   '--sl-title-pb': '12%' };
    default:            return { '--sl-title-ax': 'center',     '--sl-title-ay': 'center',   '--sl-title-ta': 'center', '--sl-title-pb': '8%'  };
  }
}

/** Returns true when the hex color has a lightness above 0.55 (perceptually light). */
export function isLightHex(hex: string): boolean {
  return hexToHsl(hex)[2] > 0.55; // hexToHsl returns [0,0,0] on malformed input
}

/** Returns an inline-style object that sets all --sl-* CSS custom properties.
 *  @param textOverride  Per-slide text colour (e.g. `<!-- color -->` / Marp
 *                       `_class: invert`). When set, it replaces `--sl-text`
 *                       and the code foreground is re-derived from `codeBgOverride`.
 *  @param codeBgOverride  Per-slide code background (inverted decks); when set,
 *                       the code foreground is chosen for that background. */
export function themeToVars(
  theme: Theme,
  textOverride?: string,
  codeBgOverride?: string,
): React.CSSProperties {
  // Pick a legible foreground for code blocks based on code_bg luminance.
  // All built-in themes have dark code_bg; custom themes may not.
  const codeBg  = codeBgOverride ?? theme.colors.code_bg;
  const codeText = isLightHex(codeBg) ? '#1a1a1a' : '#F0F0F0';

  return {
    '--sl-bg':           theme.colors.background,
    '--sl-text':         textOverride ?? theme.colors.text,
    // A per-slide override (explicit colour or invert) wins for heading/bold
    // too, so a slide's text stays legible together; otherwise each falls
    // back to its own theme colour, then the deck's plain text colour.
    '--sl-heading-text': textOverride ?? theme.colors.heading ?? theme.colors.text,
    '--sl-bold-text':    textOverride ?? theme.colors.bold ?? theme.colors.text,
    '--sl-primary':      theme.colors.primary,
    '--sl-accent':       theme.colors.accent,
    '--sl-code-bg':      codeBg,
    '--sl-code-text':    codeText,
    '--sl-title-text':   theme.colors.title_text,
    '--sl-section-bg':   theme.colors.section_bg,
    '--sl-font-title':   theme.fonts.title,
    '--sl-font-body':    theme.fonts.body,
    '--sl-font-code':    theme.fonts.code,
    '--sl-heading-ta':   theme.layout.heading_align,
    ...titleAlignVars(theme.layout.title_align),
    ...decorationVars(theme.layout.decoration),
  } as React.CSSProperties;
}

/** Resolves template variables in header/footer text. */
export function resolveTemplate(
  template: string,
  vars: { title?: string; date?: string; slideNumber?: number; totalSlides?: number },
): string {
  return template
    .replace(/{title}/g, vars.title ?? '')
    .replace(/{date}/g, vars.date ?? '')
    .replace(/{slide_number}/g, String(vars.slideNumber ?? ''))
    .replace(/{total}/g, String(vars.totalSlides ?? ''));
}

/**
 * Sanitises a raw `theme_overrides` object from frontmatter YAML before it is
 * applied to component state. Runs the same CSS-injection checks used by
 * `normaliseTheme` for installed theme files, preventing a crafted .md file
 * from injecting raw CSS property values into slide styles.
 */
export function sanitiseThemeOverrides(raw: Record<string, unknown>): Partial<Theme> {
  const result: Partial<Theme> = {};

  // Colors: iterate only the keys actually present in the override so we never
  // flood-fill DEFAULT_THEME values for missing keys. sanitiseColors/sanitiseFonts
  // always return complete objects (designed for normaliseTheme), so we can't use
  // them here — we validate each present key individually instead.
  if (raw.colors && typeof raw.colors === 'object') {
    const rawColors = raw.colors as Record<string, unknown>;
    const sanitised: Partial<ThemeColors> = {};
    for (const key of Object.keys(rawColors) as (keyof ThemeColors)[]) {
      const v = rawColors[key as string];
      if (key === 'chart_colors' && Array.isArray(v)) {
        sanitised.chart_colors = (v as unknown[]).filter(
          (x): x is string => typeof x === 'string' && !/[;{}]/.test(x),
        );
      } else if (typeof v === 'string' && !/[;{}]/.test(v.trim())) {
        (sanitised as Record<string, string>)[key as string] = v.trim();
      }
      // Invalid values are dropped; the activeTheme memo falls back to the
      // active theme's own value for any key absent from the partial.
    }
    if (Object.keys(sanitised).length > 0) result.colors = sanitised as ThemeColors;
  }

  // Fonts: same key-by-key approach — only pass through keys that are present.
  if (raw.fonts && typeof raw.fonts === 'object') {
    const rawFonts = raw.fonts as Record<string, unknown>;
    const sanitised: Partial<ThemeFonts> = {};
    for (const key of ['title', 'body', 'code'] as (keyof ThemeFonts)[]) {
      const v = rawFonts[key as string];
      if (typeof v === 'string' && !/[;{}]/.test(v.trim())) {
        sanitised[key] = v.trim();
      }
    }
    if (Object.keys(sanitised).length > 0) result.fonts = sanitised as ThemeFonts;
  }

  // Logo: allow remote URLs, data URIs, and absolute local filesystem paths.
  // normaliseTheme (for installed community themes) restricts to https/data only;
  // here we also accept local paths because users set their logo via the file
  // dialog and the path is resolved to a data URL via IPC before rendering.
  if (typeof raw.logo === 'string' && /^(https?:|data:image\/|\/|[A-Za-z]:[/\\])/.test(raw.logo)) {
    result.logo = raw.logo;
  }
  const VALID_LOGO_POSITIONS: Set<string> = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  if (typeof raw.logo_position === 'string' && VALID_LOGO_POSITIONS.has(raw.logo_position)) {
    result.logo_position = raw.logo_position as Theme['logo_position'];
  }
  if (typeof raw.logo_opacity === 'number') {
    result.logo_opacity = Math.min(1, Math.max(0, raw.logo_opacity));
  }

  // Header/footer: validate individual fields rather than blindly passing through.
  if (raw.header && typeof raw.header === 'object') {
    const h = raw.header as Record<string, unknown>;
    const header: Record<string, unknown> = {};
    if (typeof h.show === 'boolean') header.show = h.show;
    if (typeof h.text === 'string' && !h.text.includes(';')) header.text = h.text;
    if (Object.keys(header).length > 0) result.header = header as unknown as ThemeHeader;
  }
  if (raw.footer && typeof raw.footer === 'object') {
    const f = raw.footer as Record<string, unknown>;
    const footer: Record<string, unknown> = {};
    if (typeof f.show === 'boolean') footer.show = f.show;
    if (typeof f.text === 'string' && !f.text.includes(';')) footer.text = f.text;
    if (typeof f.show_slide_number === 'boolean') footer.show_slide_number = f.show_slide_number;
    if (Object.keys(footer).length > 0) result.footer = footer as unknown as ThemeFooter;
  }
  if (raw.toc && typeof raw.toc === 'object') {
    const rawToc = raw.toc as Record<string, unknown>;
    if (typeof rawToc.numbered === 'boolean') result.toc = { numbered: rawToc.numbered };
  }
  return result;
}

export type ThemeParseResult = { ok: true; theme: Theme } | { ok: false; error: string };

/** Parse a custom theme from YAML content (uses the same js-yaml already installed). */
export function parseThemeYaml(id: string, content: string): ThemeParseResult {
  try {
    const raw = yaml.load(content, { schema: yaml.CORE_SCHEMA, json: true }) as Record<string, unknown>;
    return { ok: true, theme: normaliseTheme(id, raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Rejects any string that contains characters capable of escaping a CSS property
// declaration (semicolon, braces).  These should never appear in a legitimate
// colour or font-family value and are the primary CSS-injection vectors.
function sanitiseCssString(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return /[;{}]/.test(s) ? fallback : s;
}

function sanitiseColors(c: Partial<ThemeColors>, base: ThemeColors): ThemeColors {
  const s = (v: unknown, fb: string) => sanitiseCssString(v, fb);
  const result: ThemeColors = {
    primary:    s(c.primary,    base.primary),
    accent:     s(c.accent,     base.accent),
    background: s(c.background, base.background),
    text:       s(c.text,       base.text),
    code_bg:    s(c.code_bg,    base.code_bg),
    title_text: s(c.title_text, base.title_text),
    section_bg: s(c.section_bg, base.section_bg),
  };
  if (Array.isArray(c.chart_colors)) {
    result.chart_colors = c.chart_colors.filter(
      (x): x is string => typeof x === 'string' && !/[;{}]/.test(x),
    );
  }
  if (typeof c.heading === 'string' && !/[;{}]/.test(c.heading.trim())) result.heading = c.heading.trim();
  if (typeof c.bold === 'string' && !/[;{}]/.test(c.bold.trim())) result.bold = c.bold.trim();
  return result;
}

function sanitiseFonts(f: Partial<ThemeFonts>, base: ThemeFonts): ThemeFonts {
  const s = (v: unknown, fb: string) => sanitiseCssString(v, fb);
  return {
    title: s(f.title, base.title),
    body:  s(f.body,  base.body),
    code:  s(f.code,  base.code),
  };
}

function normaliseTheme(id: string, raw: Record<string, unknown>): Theme {
  const base = DEFAULT_THEME;
  const colors = (raw.colors as Partial<ThemeColors>) ?? {};
  const fonts = (raw.fonts as Partial<ThemeFonts>) ?? {};
  const layout = (raw.layout as Partial<ThemeLayout>) ?? {};
  const header = (raw.header as Partial<ThemeHeader>) ?? {};
  const footer = (raw.footer as Partial<ThemeFooter>) ?? {};
  const toc = (raw.toc as Partial<ThemeToc>) ?? {};
  const rawLogo = raw.logo as string | undefined;
  const logo = rawLogo && /^(https?:|data:image\/|\/|[A-Za-z]:[/\\])/.test(rawLogo) ? rawLogo : undefined;
  const bundledFonts = Array.isArray(raw.bundledFonts)
    ? (raw.bundledFonts as unknown[]).filter((f): f is string => typeof f === 'string')
    : undefined;

  const remoteFonts = Array.isArray(raw.remoteFonts)
    ? (raw.remoteFonts as unknown[]).flatMap((f) => {
        if (typeof f !== 'object' || f === null) return [];
        const r = f as Record<string, unknown>;
        const family = typeof r.family === 'string' ? r.family.trim() : '';
        const url    = typeof r.url    === 'string' ? r.url.trim()    : '';
        const sha256 = typeof r.sha256 === 'string' ? r.sha256.trim() : '';
        if (!family || !url.startsWith('https://') || sha256.length !== 64) return [];
        if (!/^[0-9a-f]{64}$/.test(sha256)) return [];
        if (/[;{}]/.test(family)) return [];
        return [{
          family,
          url,
          sha256,
          weight: typeof r.weight === 'string' ? r.weight : '100 900',
          style:  r.style === 'italic' ? 'italic' : 'normal',
        } as RemoteFont];
      })
    : undefined;

  return {
    id,
    name: (raw.name as string) ?? id,
    colors: sanitiseColors(colors, base.colors),
    fonts:  sanitiseFonts(fonts, base.fonts),
    layout: { ...base.layout, ...layout },
    logo,
    logo_position: ((raw.logo_position as Theme['logo_position']) ?? base.logo_position),
    logo_opacity: typeof raw.logo_opacity === 'number' ? Math.min(1, Math.max(0, raw.logo_opacity)) : 0.85,
    header: { ...base.header, ...header },
    footer: { ...base.footer, ...footer },
    toc: { ...base.toc, ...toc },
    ...(bundledFonts && bundledFonts.length > 0 ? { bundledFonts } : {}),
    ...(remoteFonts  && remoteFonts.length  > 0 ? { remoteFonts  } : {}),
  };
}
