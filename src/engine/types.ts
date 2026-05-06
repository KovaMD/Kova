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
  | { type: 'youtube'; label: string; url: string }
  | { type: 'poll'; label: string; url: string }
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

export function parseAspectRatio(ar?: string): AspectRatio {
  if (ar === '4:3') return { w: 4, h: 3 };
  return { w: 16, h: 9 }; // 16:9 default
}

export interface Frontmatter {
  title?: string;
  author?: string;
  theme?: string;
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
