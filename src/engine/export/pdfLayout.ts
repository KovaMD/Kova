// Layout math for PDF export. Slides render at SLIDE_W px wide off-screen; here we
// scale/centre them onto a standard paper page (A4/Letter, landscape). Pure (no
// DOM) so it's unit-tested.
import type { AspectRatio } from '../types';
import { SLIDE_W } from '../constants';

export type PaperSize = 'a4' | 'letter' | 'slide';

export interface PdfExportOpts {
  perPage?: number;                 // slides per page: 1 (default), 2, 4, 6
  notes?: (string | undefined)[];   // speaker notes per slide; enables handout at 1-up
  paper?: PaperSize;                // default 'a4'
  fullBleed?: boolean;              // page = slide size, no margins (HTML export)
}

export const SLIDE_PX_W = SLIDE_W;
const PX_PER_MM  = 96 / 25.4;       // 96 CSS DPI
const MARGIN_MM  = 10;
const GAP_MM     = 6;               // gap between N-up cells / slide↔notes
const NOTES_FRAC = 0.32;            // share of content height for the notes band

// Portrait dimensions (mm); pages are laid out landscape.
const PAPER: Record<Exclude<PaperSize, 'slide'>, { w: number; h: number }> = {
  a4:     { w: 210, h: 297 },
  letter: { w: 216, h: 279 },
};

function slideHeightPx(ar: AspectRatio): number {
  return Math.round(SLIDE_PX_W * ar.h / ar.w);
}

// Grid columns for an N-up sheet: 2→2×1, 4→2×2, 6→3×2.
export function nupCols(perPage: number): number {
  if (perPage <= 1) return 1;
  if (perPage <= 2) return 2;
  return perPage <= 4 ? 2 : 3;
}

// Notes handout only applies at 1-per-page with at least one non-empty note.
export function notesEnabled(opts: PdfExportOpts): boolean {
  return (opts.perPage ?? 1) <= 1 && !!opts.notes?.some((n) => n && n.trim());
}

export interface PagePlan {
  mode: 'single' | 'nup' | 'notes';
  pageWpx: number; pageHpx: number;   // physical page in px (landscape)
  pageWmm: number; pageHmm: number;   // physical page in mm (landscape)
  marginPx: number; gapPx: number;
  cols: number; rows: number;
  cellWpx: number; cellHpx: number;   // area a slide is scaled into
  slideNativeHpx: number;
  slideScale: number;                 // scale to fit SLIDE_W×slideH into a cell
  notesTopPx: number;                 // notes mode: y of the divider; else 0
}

export function planPage(ar: AspectRatio, opts: PdfExportOpts): PagePlan {
  // Full-bleed: page = slide, no margins (HTML export keeps the old behaviour).
  if (opts.fullBleed) {
    const sh = slideHeightPx(ar);
    return {
      mode: 'single',
      pageWpx: SLIDE_PX_W, pageHpx: sh,
      pageWmm: 254, pageHmm: Math.round(sh * 254 / SLIDE_PX_W * 100) / 100,
      marginPx: 0, gapPx: 0, cols: 1, rows: 1,
      cellWpx: SLIDE_PX_W, cellHpx: sh, slideNativeHpx: sh, slideScale: 1, notesTopPx: 0,
    };
  }
  // 'slide' paper ("match slide size") is only meaningful for a plain 1-up
  // page — it degenerates to a single slide's own bounding box, which is too
  // small to hold an N-up grid or a notes band. Reuse the fullBleed layout
  // when compatible; otherwise fall back to A4 so nup/notes still work.
  if (opts.paper === 'slide' && (opts.perPage ?? 1) <= 1 && !notesEnabled(opts)) {
    return planPage(ar, { ...opts, fullBleed: true });
  }

  const paper = PAPER[opts.paper === 'slide' ? 'a4' : (opts.paper ?? 'a4')];
  // Landscape: slides are wide, so swap paper w/h.
  const pageWmm = paper.h, pageHmm = paper.w;
  const pageWpx = Math.round(pageWmm * PX_PER_MM);
  const pageHpx = Math.round(pageHmm * PX_PER_MM);
  const marginPx = Math.round(MARGIN_MM * PX_PER_MM);
  const gapPx = Math.round(GAP_MM * PX_PER_MM);
  const slideNativeHpx = slideHeightPx(ar);

  const contentW = pageWpx - 2 * marginPx;
  const contentH = pageHpx - 2 * marginPx;

  const perPage = opts.perPage ?? 1;

  let mode: PagePlan['mode'] = 'single';
  let cols = 1, rows = 1;
  let cellWpx = contentW, cellHpx = contentH;
  let notesTopPx = 0;

  if (perPage > 1) {
    mode = 'nup';
    cols = nupCols(perPage);
    rows = Math.ceil(perPage / cols);
    cellWpx = (contentW - gapPx * (cols - 1)) / cols;
    cellHpx = (contentH - gapPx * (rows - 1)) / rows;
  } else if (notesEnabled(opts)) {
    mode = 'notes';
    const notesH = Math.round(contentH * NOTES_FRAC);
    cellHpx = contentH - notesH - gapPx;   // slide area above the divider
    notesTopPx = marginPx + cellHpx + gapPx;
  }

  const slideScale = Math.min(cellWpx / SLIDE_PX_W, cellHpx / slideNativeHpx);

  return {
    mode, pageWpx, pageHpx, pageWmm, pageHmm, marginPx, gapPx,
    cols, rows, cellWpx, cellHpx, slideNativeHpx, slideScale, notesTopPx,
  };
}
