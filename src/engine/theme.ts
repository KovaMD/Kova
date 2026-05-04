import yaml from 'js-yaml';

export interface ThemeColors {
  primary: string;       // title slide background, strong accents
  accent: string;        // links, highlights, decorative elements
  background: string;    // default slide background
  text: string;          // body text
  code_bg: string;       // code block background
  title_text: string;    // text on title/section slides (usually white)
  section_bg: string;    // section divider background
}

export interface ThemeFonts {
  title: string;
  body: string;
  code: string;
}

export interface ThemeHeader {
  show: boolean;
  text: string;
}

export interface ThemeFooter {
  show: boolean;
  text: string;              // supports {title}, {date}, {slide_number}
  show_slide_number: boolean;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  logo?: string;
  logo_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  header: ThemeHeader;
  footer: ThemeFooter;
}

// ── Built-in themes ───────────────────────────────────────────────────────────

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'light',
    name: 'Light',
    colors: {
      primary: '#1B3A5C',
      accent: '#2563EB',
      background: '#FFFFFF',
      text: '#1a1a1a',
      code_bg: '#F5F7FA',
      title_text: '#FFFFFF',
      section_bg: '#E8F0FE',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
    },
    logo_position: 'top-right',
    header: { show: false, text: '' },
    footer: { show: false, text: '{title}', show_slide_number: true },
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
    logo_position: 'top-right',
    header: { show: false, text: '' },
    footer: { show: false, text: '{title}', show_slide_number: true },
  },
  {
    id: 'institutional',
    name: 'Institutional',
    colors: {
      primary: '#003366',
      accent: '#CC0000',
      background: '#FFFFFF',
      text: '#111111',
      code_bg: '#F0F0F0',
      title_text: '#FFFFFF',
      section_bg: '#003366',
    },
    fonts: {
      title: 'Georgia, Times New Roman, serif',
      body: 'Arial, Helvetica, sans-serif',
      code: 'Courier New, Courier, monospace',
    },
    logo_position: 'top-right',
    header: { show: true, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    colors: {
      primary: '#222222',
      accent: '#444444',
      background: '#FAFAFA',
      text: '#222222',
      code_bg: '#EFEFEF',
      title_text: '#FAFAFA',
      section_bg: '#DDDDDD',
    },
    fonts: {
      title: 'Georgia, Times New Roman, serif',
      body: 'Georgia, Times New Roman, serif',
      code: 'Menlo, Monaco, Consolas, monospace',
    },
    logo_position: 'bottom-right',
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
  },
  {
    id: 'ia',
    name: 'iA',
    colors: {
      primary: '#1A1A2E',
      accent: '#E94560',
      background: '#F7F3EE',
      text: '#1A1A2E',
      code_bg: '#EDE9E3',
      title_text: '#F7F3EE',
      section_bg: '#E94560',
    },
    fonts: {
      title: 'Georgia, Times New Roman, serif',
      body: 'Georgia, Charter, serif',
      code: 'Menlo, Monaco, monospace',
    },
    logo_position: 'top-right',
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
  },
];

export const DEFAULT_THEME = BUILT_IN_THEMES[0]; // light

// ── CSS variable mapping ──────────────────────────────────────────────────────

/** Returns an inline-style object that sets all --sl-* CSS custom properties. */
export function themeToVars(theme: Theme): React.CSSProperties {
  return {
    '--sl-bg':          theme.colors.background,
    '--sl-text':        theme.colors.text,
    '--sl-primary':     theme.colors.primary,
    '--sl-accent':      theme.colors.accent,
    '--sl-code-bg':     theme.colors.code_bg,
    '--sl-title-text':  theme.colors.title_text,
    '--sl-section-bg':  theme.colors.section_bg,
    '--sl-font-title':  theme.fonts.title,
    '--sl-font-body':   theme.fonts.body,
    '--sl-font-code':   theme.fonts.code,
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

/** Parse a custom theme from YAML content (uses the same js-yaml already installed). */
export function parseThemeYaml(id: string, content: string): Theme | null {
  try {
    const raw = yaml.load(content) as Record<string, unknown>;
    return normaliseTheme(id, raw);
  } catch {
    return null;
  }
}

function normaliseTheme(id: string, raw: Record<string, unknown>): Theme {
  const base = DEFAULT_THEME;
  const colors = (raw.colors as Partial<ThemeColors>) ?? {};
  const fonts = (raw.fonts as Partial<ThemeFonts>) ?? {};
  const header = (raw.header as Partial<ThemeHeader>) ?? {};
  const footer = (raw.footer as Partial<ThemeFooter>) ?? {};
  return {
    id,
    name: (raw.name as string) ?? id,
    colors: { ...base.colors, ...colors },
    fonts: { ...base.fonts, ...fonts },
    logo: (raw.logo as string | undefined),
    logo_position: ((raw.logo_position as Theme['logo_position']) ?? base.logo_position),
    header: { ...base.header, ...header },
    footer: { ...base.footer, ...footer },
  };
}
