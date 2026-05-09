export type LayoutType =
  | 'title'
  | 'section'
  | 'title-content'
  | 'title-image'
  | 'split'
  | 'full-bleed'
  | 'quote'
  | 'two-column'
  | 'bsp'
  | 'grid'
  | 'media'
  | 'code';

export interface ListItem {
  text: string;
  html: string;
  children: ListItem[];
}

export type SlideElement =
  | { type: 'paragraph'; text: string; html: string }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'image'; src: string; alt: string; title?: string }
  | { type: 'code'; lang: string; value: string }
  | { type: 'mermaid'; value: string }
  | { type: 'blockquote'; text: string; attribution?: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'youtube';  label: string; url: string }
  | { type: 'poll';     label: string; url: string }
  | { type: 'progress'; label: string; value: number }
  | { type: 'column-break' };

export interface Slide {
  index: number;
  raw: string;
  title: string;
  titleLevel: number;   // 1 = H1, 2 = H2, etc. (0 = no title)
  elements: SlideElement[];
  speakerNotes: string;
  layout: LayoutType;
  layoutOverride?: LayoutType;
}

export interface AspectRatio { w: number; h: number }

export function parseAspectRatio(ar?: string, fallback?: string): AspectRatio {
  const value = ar ?? fallback;
  if (value === '4:3')   return { w: 4,  h: 3 };
  if (value === '16:10') return { w: 16, h: 10 };
  return { w: 16, h: 9 };
}

export interface ThemeOverrides {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
}

export interface Frontmatter {
  title?: string;
  author?: string;
  theme?: string;
  theme_overrides?: ThemeOverrides;
  aspect_ratio?: string;
  date?: string;
  logo?: string;
  footer?: string;
  [key: string]: unknown;
}

export interface ParsedDocument {
  slides: Slide[];
  frontmatter: Frontmatter;
}
