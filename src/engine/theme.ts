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
  header: ThemeHeader;
  footer: ThemeFooter;
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
      code_bg: '#F5F7FA',
      title_text: '#FFFFFF',
      section_bg: '#E8F0FE',
    },
    fonts: {
      title: 'Inter, Helvetica Neue, Arial, sans-serif',
      body: 'Inter, Helvetica Neue, Arial, sans-serif',
      code: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
    },
    layout: CENTER_LAYOUT,
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
    layout: CENTER_LAYOUT,
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
    layout: CENTER_LAYOUT,
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
    layout: CENTER_LAYOUT,
    logo_position: 'bottom-right',
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
  },
  {
    id: 'editorial',
    name: 'Editorial',
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
    layout: CENTER_LAYOUT,
    logo_position: 'top-right',
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
  },
  {
    id: 'slate',
    name: 'Slate',
    colors: {
      primary: '#1E293B',
      accent: '#38BDF8',
      background: '#F8FAFC',
      text: '#1E293B',
      code_bg: '#F1F5F9',
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
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
  },
  {
    id: 'pitch',
    name: 'Pitch',
    colors: {
      primary: '#0A0A0A',
      accent: '#FF4500',
      background: '#FFFFFF',
      text: '#0A0A0A',
      code_bg: '#F5F5F5',
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
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
  },
  {
    id: 'cosmos',
    name: 'Cosmos',
    colors: {
      primary: '#0D0D2B',
      accent: '#8B5CF6',
      background: '#F9FAFB',
      text: '#111827',
      code_bg: '#F3F4F6',
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
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
  },
  {
    id: 'forge',
    name: 'Forge',
    colors: {
      primary: '#1C1917',
      accent: '#F97316',
      background: '#FAFAF9',
      text: '#1C1917',
      code_bg: '#F5F5F4',
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
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
  },
  {
    id: 'grove',
    name: 'Grove',
    colors: {
      primary: '#14532D',
      accent: '#10B981',
      background: '#F0FDF4',
      text: '#14532D',
      code_bg: '#DCFCE7',
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
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
  },
  {
    id: 'horizon',
    name: 'Horizon',
    colors: {
      primary: '#164E63',
      accent: '#06B6D4',
      background: '#F0FDFA',
      text: '#164E63',
      code_bg: '#CCFBF1',
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
    header: { show: false, text: '' },
    footer: { show: true, text: '{title}', show_slide_number: true },
  },
];

export const DEFAULT_THEME = BUILT_IN_THEMES[0]; // light

// ── CSS variable mapping ──────────────────────────────────────────────────────

function decorationVars(d: ThemeLayout['decoration']): Record<string, string> {
  switch (d) {
    case 'dots':
      return {
        '--sl-deco-img':  'radial-gradient(circle, rgba(255,255,255,0.18) 1.5px, transparent 1.5px)',
        '--sl-deco-size': '28px 28px',
      };
    case 'grid':
      return {
        '--sl-deco-img':  'repeating-linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
        '--sl-deco-size': '48px 48px',
      };
    case 'diagonal':
      return {
        '--sl-deco-img':  'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 1px, transparent 0, transparent 50%)',
        '--sl-deco-size': '24px 24px',
      };
    case 'bar-left':
      return {
        '--sl-deco-img':  'linear-gradient(90deg, var(--sl-accent) 6px, transparent 6px)',
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

/** Returns an inline-style object that sets all --sl-* CSS custom properties. */
export function themeToVars(theme: Theme): React.CSSProperties {
  return {
    '--sl-bg':           theme.colors.background,
    '--sl-text':         theme.colors.text,
    '--sl-primary':      theme.colors.primary,
    '--sl-accent':       theme.colors.accent,
    '--sl-code-bg':      theme.colors.code_bg,
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

/** Parse a custom theme from YAML content (uses the same js-yaml already installed). */
export function parseThemeYaml(id: string, content: string): Theme | null {
  try {
    const raw = yaml.load(content, { schema: yaml.CORE_SCHEMA }) as Record<string, unknown>;
    return normaliseTheme(id, raw);
  } catch {
    return null;
  }
}

function normaliseTheme(id: string, raw: Record<string, unknown>): Theme {
  const base = DEFAULT_THEME;
  const colors = (raw.colors as Partial<ThemeColors>) ?? {};
  const fonts = (raw.fonts as Partial<ThemeFonts>) ?? {};
  const layout = (raw.layout as Partial<ThemeLayout>) ?? {};
  const header = (raw.header as Partial<ThemeHeader>) ?? {};
  const footer = (raw.footer as Partial<ThemeFooter>) ?? {};
  return {
    id,
    name: (raw.name as string) ?? id,
    colors: { ...base.colors, ...colors },
    fonts: { ...base.fonts, ...fonts },
    layout: { ...base.layout, ...layout },
    logo: (raw.logo as string | undefined),
    logo_position: ((raw.logo_position as Theme['logo_position']) ?? base.logo_position),
    header: { ...base.header, ...header },
    footer: { ...base.footer, ...footer },
  };
}
