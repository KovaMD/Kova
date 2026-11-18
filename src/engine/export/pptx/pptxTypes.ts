// Narrow local types for the slice of the pptxgenjs slide API the PPTX
// exporter actually uses. pptxgenjs' own typings are far wider than we need
// and model the option bags we build dynamically (inline runs) awkwardly, so
// the exporter talks to this surface instead. Adding a new pptxgenjs call
// means adding it here first.

/** Position and size of a shape, in inches. */
export interface PptxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PptxFill {
  color: string;
  transparency?: number;
}

export interface PptxLine {
  type?: 'none';
  color?: string;
  width?: number;
  transparency?: number;
}

export type PptxHAlign = 'left' | 'center' | 'right' | 'justify';
export type PptxVAlign = 'top' | 'middle' | 'bottom';

/** One formatted run of a multi-run text box. Run options are built
 *  dynamically (inline HTML walking, syntax highlighting), so they stay an
 *  open bag rather than a closed type. */
export interface PptxTextRun {
  text: string;
  options?: Record<string, unknown>;
}

export interface PptxTextOptions extends PptxBox {
  fontSize?: number;
  fontFace?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: PptxHAlign;
  valign?: PptxVAlign;
  wrap?: boolean;
  shrinkText?: boolean;
  charSpacing?: number;
  fill?: PptxFill;
  objectName?: string;
}

export interface PptxShapeOptions extends PptxBox {
  fill?: PptxFill;
  line?: PptxLine;
  objectName?: string;
}

export interface PptxImageOptions extends PptxBox {
  data: string;
  transparency?: number;
  objectName?: string;
}

export type PptxMediaOptions = PptxBox & (
  | { type: 'online'; link: string }
  | { type: 'video'; data: string; extn: string }
);

export interface PptxTableCell {
  text: string;
  options?: Record<string, unknown>;
}

export interface PptxTableOptions extends PptxBox {
  colW?: number[];
  rowH?: number[];
  fontSize?: number;
  fontFace?: string;
  valign?: PptxVAlign;
  margin?: [number, number, number, number];
  border?: { color: string; pt: number };
  objectName?: string;
}

/** The pptxgenjs slide methods and properties the exporter uses. */
export interface PptxSlide {
  // Optional fill mirrors pptxgenjs BackgroundProps, keeping its Slide
  // structurally assignable to this interface without a cast.
  background?: { fill?: string };
  addText(text: string | PptxTextRun[], options: PptxTextOptions): unknown;
  addShape(shape: 'rect', options: PptxShapeOptions): unknown;
  addImage(options: PptxImageOptions): unknown;
  addMedia(options: PptxMediaOptions): unknown;
  addTable(rows: PptxTableCell[][], options: PptxTableOptions): unknown;
  addNotes(notes: string): unknown;
}
