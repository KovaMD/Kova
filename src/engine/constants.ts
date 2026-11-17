// Shared render constants for the virtual slide canvas.
//
// Every slide is laid out at a fixed virtual width and then scaled to fit its
// destination (preview, thumbnails, presenter/audience windows, PDF/Print and
// HTML export, the off-screen Mermaid render host). Height follows from the
// deck's aspect ratio: Math.round(SLIDE_W * ar.h / ar.w).

/** Virtual slide width in CSS pixels. */
export const SLIDE_W = 960;

/** Slide height at the default 16:9 aspect ratio (SLIDE_W x 9/16 = 540). */
export const SLIDE_H_16_9 = SLIDE_W * 9 / 16;
