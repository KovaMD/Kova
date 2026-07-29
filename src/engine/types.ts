export type LayoutType =
  | 'title'
  | 'section'
  | 'title-content'
  | 'title-image'
  | 'split'
  | 'full-bleed'
  | 'quote'
  | 'two-column'
  | 'three-column'
  | 'bsp'
  | 'grid'
  | 'media'
  | 'code'
  | 'math'
  | 'blank';

export interface ListItem {
  text: string;
  html: string;
  children: ListItem[];
  /** Build-reveal order set via a trailing `<!-- step -->` marker; undefined
   *  means the item is always visible from the start of the slide. See
   *  `!-- step --` handling in markdownToSlides.ts and getSlideStepValues in
   *  engine/layout/steps.ts. */
  step?: number;
}

export type SlideElement =
  | { type: 'paragraph'; text: string; html: string; step?: number }
  | { type: 'list'; ordered: boolean; items: ListItem[]; step?: number }
  | { type: 'image'; src: string; alt: string; title?: string; caption?: string; step?: number }
  | { type: 'code'; lang: string; value: string; step?: number }
  | { type: 'mermaid'; value: string; caption?: string; step?: number }
  | { type: 'math'; value: string; display: boolean; caption?: string; step?: number }
  | { type: 'blockquote'; text: string; attribution?: string; html?: string; calloutType?: string; title?: string; step?: number }
  | { type: 'table'; headers: string[]; rows: string[][]; align?: ('left' | 'right' | 'center' | null)[]; caption?: string; step?: number }
  | { type: 'youtube';  label: string; url: string; step?: number }
  | { type: 'video';    label: string; src: string; step?: number }
  | { type: 'poll';     label: string; url: string; step?: number }
  | { type: 'progress'; label: string; value: number; step?: number }
  | { type: 'column-break' }
  | { type: 'toc'; entries: Array<{ title: string; index: number }>; numberStart?: number; step?: number };

export interface Slide {
  index: number;
  raw: string;
  title: string;
  titleLevel: number;   // 1 = H1, 2 = H2, etc. (0 = no title)
  elements: SlideElement[];
  speakerNotes: string;
  references: string[];   // academic citations set via !ref[...], rendered at bottom-right (HTML: bold/italic/code)
  layout: LayoutType;
  layoutOverride?: LayoutType;
  hidden: boolean;        // skipped in presentation + export; set via <!-- hidden --> marker
  /** Marp-style `![bg](…)` — full-slide background behind content (not split-column). */
  backgroundImage?: {
    src: string;
    size?: 'cover' | 'contain';
    /** Resolved locally for PPTX export when size is `contain`. */
    aspectRatio?: number;
  };
  /** Per-slide text colour override (e.g. `<!-- color: #ffffff -->` or Marp
   *  `<!-- _color: white -->`). Applied to the slide's content unconditionally
   *  (not only over a background image); falls back to `invert`'s light
   *  "text on dark" colour, then the theme's `text` colour, when absent. */
  textColor?: string;
  /** Marp `<!-- _class: invert -->` — swap to the deck's inverted palette for
   *  this slide (theme-defined or a sensible default). Implies a light-on-dark
   *  text colour when `textColor` is not also set. */
  invert?: boolean;
}

export interface AspectRatio { w: number; h: number }

export function parseAspectRatio(ar?: string): AspectRatio {
  if (ar === '4:3')   return { w: 4,  h: 3 };
  if (ar === '16:10') return { w: 16, h: 10 };
  return { w: 16, h: 9 };
}

export interface ThemeOverrides {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  logo?: string;
  logo_position?: string;
  logo_opacity?: number;
  header?: { show?: boolean; text?: string };
  footer?: { show?: boolean; text?: string; show_slide_number?: boolean };
  toc?: { numbered?: boolean };
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
