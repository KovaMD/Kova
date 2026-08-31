import {invoke} from '@tauri-apps/api/core';

import {getSlideStepValues} from '../layout/steps';
import type {AspectRatio, Slide} from '../types';

import {imageMime} from './imageMime';
import {mermaidSvgCache} from './mermaidSvgCache';
import {type PdfExportOpts, planPage, SLIDE_PX_W} from './pdfLayout';
import {videoMime} from './videoMime';

export type {PdfExportOpts};

// ── Public entry point ───────────────────────────────────────────────────────

export async function exportPdfNative(
    slideElements: HTMLElement[],
    aspectRatio: AspectRatio,
    savePath: string,
    opts: PdfExportOpts = {},
    ): Promise<void> {
  const html = await buildPrintDocument(slideElements, aspectRatio, opts);
  const plan = planPage(aspectRatio, opts);
  const perPage = opts.perPage ?? 1;
  const pageCount = perPage > 1 ? Math.ceil(slideElements.length / perPage) :
                                  slideElements.length;
  await invoke('export_pdf_native', {
    htmlContent: html,
    outputPath: savePath,
    widthMm: plan.pageWmm,
    heightMm: plan.pageHmm,
    // Per-page capture rects for the macOS path (one createPDF per page, then
    // merge).
    pageCount,
    pageWidthPx: plan.pageWpx,
    pageHeightPx: plan.pageHpx,
  });
}

// ── HTML serialiser ──────────────────────────────────────────────────────────

export async function buildPrintDocument(
    slideElements: HTMLElement[],
    aspectRatio: AspectRatio,
    opts: PdfExportOpts = {},
    ): Promise<string> {
  const plan = planPage(aspectRatio, opts);
  const perPage = opts.perPage ?? 1;

  // Read slide background color from the live DOM before cloning.
  const slideFrame = slideElements[0]?.querySelector('.slide-frame');
  const slideBg = slideFrame ?
      getComputedStyle(slideFrame).getPropertyValue('--sl-bg').trim() :
      '';

  // 1. Clone elements and resolve all image/video URLs to data URIs in place.
  const clones = slideElements.map((el) => el.cloneNode(true) as HTMLElement);
  await Promise.all(
      clones.map((el) => Promise.all([resolveImages(el), resolveVideos(el)])));
  // Belt-and-suspenders: if a Mermaid container is still a placeholder (SVG
  // not yet committed to the DOM when we cloned), inject from the render cache.
  clones.forEach(injectMermaidFallbacks);
  clones.forEach(inlinePrintColorAdjust);

  // 2. Extract all document CSS with font URLs resolved to data URIs.
  const css = await extractAllCss();

  // Each slide is a 960×native box scaled into a frame sized to the slide's own
  // proportions (so the N-up border hugs the slide), centred in its slot.
  const slot = (el: HTMLElement) =>
      `<div class="kova-slot"><div class="kova-frame"><div class="kova-scale">${
          el.outerHTML}</div></div></div>`;

  // 3. Assemble pages — slides scaled/centred onto a standard paper page.
  let pages: string;
  if (plan.mode === 'nup') {
    const sheets: HTMLElement[][] = [];
    for (let i = 0; i < clones.length; i += perPage)
      sheets.push(clones.slice(i, i + perPage));
    pages =
        sheets
            .map(
                (sheet) =>
                    `<div class="kova-page"><div class="kova-content kova-grid">${
                        sheet.map(slot).join('')}</div></div>`,
                )
            .join('\n');
  } else if (plan.mode === 'notes') {
    pages =
        clones
            .map((el, i) => {
              const note = escapeHtml((opts.notes?.[i] ?? '').trim());
              return `<div class="kova-page"><div class="kova-content kova-col">${
                  slot(el)}<div class="kova-notes">${note}</div></div></div>`;
            })
            .join('\n');
  } else {
    pages =
        clones
            .map(
                (el) =>
                    `<div class="kova-page"><div class="kova-content kova-center">${
                        slot(el)}</div></div>`,
                )
            .join('\n');
  }

  const bgCss = slideBg ? `background: ${slideBg} !important;` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${css}
@page {
  size: ${plan.pageWmm}mm ${plan.pageHmm}mm;
  margin: 0;
}
*, *::before, *::after {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  color-adjust: exact !important;
}
@media print {
  *, *::before, *::after {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
}
/* Override app-level constraints (e.g. html/body { height:100%; overflow:hidden })
   that would collapse the print document to a single page. These must come after
   the extracted CSS and use !important to win specificity. */
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
  zoom: 1 !important;
}
.kova-page {
  display: block !important;
  width: ${plan.pageWpx}px !important;
  height: ${plan.pageHpx}px !important;
  overflow: hidden !important;
  break-after: page;
  page-break-after: always;
  position: relative !important;
  margin: 0 !important;
  background: ${slideBg || '#fff'} !important;
}
.kova-page:last-child {
  break-after: avoid;
  page-break-after: avoid;
}
.kova-content {
  position: absolute !important;
  inset: ${plan.marginPx}px !important;
  box-sizing: border-box !important;
}
.kova-center { display: flex !important; align-items: center !important; justify-content: center !important; }
.kova-col    { display: flex !important; flex-direction: column !important; }
.kova-grid {
  display: grid !important;
  grid-template-columns: repeat(${plan.cols}, ${plan.cellWpx}px) !important;
  grid-auto-rows: ${plan.cellHpx}px !important;
  gap: ${plan.gapPx}px !important;
  align-content: center !important;
  justify-content: center !important;
}
.kova-slot {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  overflow: hidden !important;
}
.kova-grid .kova-slot { width: ${plan.cellWpx}px !important; height: ${
      plan.cellHpx}px !important; }
.kova-col  .kova-slot { width: 100% !important; height: ${
      plan.cellHpx}px !important; flex: 0 0 auto !important; }
.kova-center .kova-slot { width: 100% !important; height: 100% !important; }
.kova-frame {
  position: relative !important;
  box-sizing: border-box !important;
  width: ${SLIDE_PX_W * plan.slideScale}px !important;
  height: ${plan.slideNativeHpx * plan.slideScale}px !important;
  overflow: hidden !important;
  flex: 0 0 auto !important;
  ${bgCss}
}
.kova-grid .kova-frame { border: 1px solid #c8c8c8 !important; }
.kova-scale {
  width: ${SLIDE_PX_W}px !important;
  height: ${plan.slideNativeHpx}px !important;
  transform: scale(${plan.slideScale}) !important;
  transform-origin: top left !important;
}
.kova-notes {
  flex: 1 1 auto !important;
  box-sizing: border-box !important;
  margin-top: ${plan.gapPx}px !important;
  padding: 20px 24px !important;
  font: 18px/1.55 -apple-system, system-ui, sans-serif !important;
  color: #111 !important;
  background: #fff !important;
  white-space: pre-wrap !important;
  overflow: hidden !important;
  border-top: 2px solid #999 !important;
}
</style>
</head>
<body>
${pages}
</body>
</html>`;
}

// ── Interactive standalone HTML (Export → HTML) ──────────────────────────────

/**
 * Self-contained presentable HTML deck: one slide at a time, keyboard/click
 * navigation, fullscreen. Reuses the same asset-inlining pipeline as the print
 * document so the file works offline from disk. PDF keeps using
 * `buildPrintDocument`.
 */
export async function buildInteractiveDocument(
    slideElements: HTMLElement[],
    aspectRatio: AspectRatio,
    slides: Slide[],
    ): Promise<string> {
  const plan = planPage(aspectRatio, {fullBleed: true});

  const slideFrame = slideElements[0]?.querySelector('.slide-frame');
  const slideBg = slideFrame ?
      getComputedStyle(slideFrame).getPropertyValue('--sl-bg').trim() :
      '';

  const clones = slideElements.map((el) => el.cloneNode(true) as HTMLElement);
  await Promise.all(
      clones.map((el) => Promise.all([resolveImages(el), resolveVideos(el)])));
  clones.forEach(injectMermaidFallbacks);
  clones.forEach(inlinePrintColorAdjust);

  const css = await extractAllCss();
  return assembleInteractiveDocument({
    css,
    slideHtml: clones.map((el) => el.outerHTML),
    slideW: SLIDE_PX_W,
    slideH: plan.slideNativeHpx,
    background: slideBg || '#111',
    slideSteps: slides.map(getSlideStepValues),
  });
}

/** Pure HTML assembler — unit-tested without Tauri/DOM asset fetches. */
export function assembleInteractiveDocument(opts: {
  css: string; slideHtml: string[]; slideW: number; slideH: number;
  background?: string;
  /**
   * One entry per slide (parallel to `slideHtml`): that slide's distinct
   * `<!-- step -->` values, ascending (see getSlideStepValues). An empty
   * array means the slide has no build-reveal markers at all. The cloned
   * slide HTML is always captured fully revealed — the exported deck's own
   * script re-derives per-step visibility from each element's `data-step`
   * attribute (stamped by StepGate/ListItemNode regardless of render mode),
   * reusing the exact same `sl-step-item--pending` class the live app already
   * defines (inherited for free via the caller's `css`).
   */
  slideSteps?: number[][];
}): string {
  const {css, slideHtml, slideW, slideH} = opts;
  const slideSteps = opts.slideSteps ?? slideHtml.map(() => []);
  const background = opts.background || '#111';
  const slides =
      slideHtml
          .map(
              (html, i) =>
                  `<div class="kova-deck-slide${
                      i === 0 ? ' is-active' : ''}" data-index="${
                      i}" aria-hidden="${i === 0 ? 'false' : 'true'}">` +
                  `<div class="kova-deck-frame"><div class="kova-deck-scale">${
                      html}</div></div></div>`,
              )
          .join('\n');
  const total = slideHtml.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Kova">
<title>Presentation</title>
<style>
${css}
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  height: 100% !important;
  overflow: hidden !important;
  background: ${background} !important;
}
.kova-deck {
  position: fixed !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: ${background} !important;
  cursor: default;
}
.kova-deck-slide {
  display: none !important;
}
.kova-deck-slide.is-active {
  display: block !important;
}
.kova-deck-frame {
  width: ${slideW}px !important;
  height: ${slideH}px !important;
  overflow: hidden !important;
  position: relative !important;
  transform-origin: center center !important;
}
.kova-deck-scale {
  width: ${slideW}px !important;
  height: ${slideH}px !important;
}
.kova-chrome {
  position: fixed !important;
  right: 16px !important;
  bottom: 12px !important;
  z-index: 10 !important;
  color: #fff !important;
  font: 13px/1.2 -apple-system, system-ui, sans-serif !important;
  opacity: 0.75 !important;
  pointer-events: none !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  user-select: none !important;
}
.kova-chrome kbd {
  font: inherit !important;
  opacity: 0.85 !important;
}
@media print {
  html, body {
    overflow: visible !important;
    height: auto !important;
    background: #fff !important;
  }
  .kova-chrome { display: none !important; }
  .kova-deck {
    position: static !important;
    display: block !important;
    background: #fff !important;
  }
  .kova-deck-slide {
    display: block !important;
    break-after: page;
    page-break-after: always;
    margin: 0 auto !important;
  }
  .kova-deck-slide:last-child {
    break-after: avoid;
    page-break-after: avoid;
  }
  .kova-deck-frame {
    transform: none !important;
  }
}
</style>
</head>
<body>
<div class="kova-deck" id="kova-deck" role="application" aria-label="Presentation">
${slides}
</div>
<div class="kova-chrome" aria-live="polite">
  <span id="kova-counter">1 / ${total}</span>
  · <kbd>←</kbd>/<kbd>→</kbd> <kbd>Space</kbd> · <kbd>F</kbd> fullscreen
</div>
<script>
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.kova-deck-slide'));
  var frame = document.querySelector('.kova-deck-frame');
  var counter = document.getElementById('kova-counter');
  var deck = document.getElementById('kova-deck');
  var slideW = ${slideW};
  var slideH = ${slideH};
  var slideSteps = ${JSON.stringify(slideSteps)};
  var i = 0;
  var step = 0;
  function fit() {
    if (!frame) return;
    var pad = 24;
    var sx = (window.innerWidth - pad) / slideW;
    var sy = (window.innerHeight - pad) / slideH;
    var s = Math.max(0.05, Math.min(sx, sy));
    var frames = document.querySelectorAll('.kova-deck-frame');
    for (var f = 0; f < frames.length; f++) {
      frames[f].style.transform = 'scale(' + s + ')';
    }
  }
  // Mirrors usePresentationNav's step-before-slide logic exactly. Slide HTML
  // is always cloned fully revealed (see slideSteps' doc comment above) — this
  // just toggles the same sl-step-item--pending class the live app uses,
  // driven by each element's own data-step attribute.
  function applyStep() {
    var values = slideSteps[i] || [];
    var threshold = step > 0 ? values[step - 1] : -Infinity;
    var current = slides[i];
    if (!current) return;
    var stepped = current.querySelectorAll('[data-step]');
    for (var k = 0; k < stepped.length; k++) {
      var v = Number(stepped[k].getAttribute('data-step'));
      stepped[k].classList.toggle('sl-step-item--pending', v > threshold);
    }
  }
  function show(n, s) {
    if (!slides.length) return;
    i = Math.max(0, Math.min(slides.length - 1, n));
    step = s || 0;
    for (var j = 0; j < slides.length; j++) {
      var on = j === i;
      slides[j].classList.toggle('is-active', on);
      slides[j].setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    if (counter) counter.textContent = (i + 1) + ' / ' + slides.length;
    applyStep();
  }
  function next() {
    var count = (slideSteps[i] || []).length;
    if (step < count) { step++; applyStep(); return; }
    show(i + 1, 0);
  }
  function prev() {
    if (step > 0) { step--; applyStep(); return; }
    show(i - 1, (slideSteps[i - 1] || []).length);
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault(); next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
      e.preventDefault(); prev();
    } else if (e.key === 'Home') {
      e.preventDefault(); show(0, 0);
    } else if (e.key === 'End') {
      e.preventDefault(); show(slides.length - 1, 0);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (!document.fullscreenElement) {
        (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen || function () {}).call(document.documentElement);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
      }
    }
  });
  if (deck) {
    deck.addEventListener('click', function (e) {
      if (e.target.closest('a, button, video, audio, input, textarea, select, label')) return;
      if (e.clientX >= window.innerWidth / 2) next();
      else prev();
    });
  }
  window.addEventListener('resize', fit);
  fit();
  show(0);
})();
</script>
</body>
</html>`;
}

// ── Mermaid cache fallback ───────────────────────────────────────────────────

// If a Mermaid container was cloned before React committed the SVG to the DOM
// (race between setSvg() and signalReady()), the clone will be a placeholder
// div with no SVG child. Inject the cached SVG string so the diagram appears.
function injectMermaidFallbacks(root: HTMLElement): void {
  const containers =
      Array.from(root.querySelectorAll<HTMLElement>('[data-mermaid-src]'));
  for (const container of containers) {
    if (container.querySelector('svg')) continue;
    const src = container.getAttribute('data-mermaid-src') ?? '';
    const cached = mermaidSvgCache.get(src);
    if (!cached) continue;
    const scaled = cached.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
      let a = attrs.replace(/\bwidth="[^"]*"/, 'width="100%"')
                  .replace(/\bheight="[^"]*"/, 'height="100%"')
                  .replace(/\bstyle="[^"]*max-width[^"]*"/, '');
      if (!/preserveAspectRatio/.test(a))
        a += ' preserveAspectRatio="xMidYMid meet"';
      return `<svg${a}>`;
    });
    container.innerHTML = scaled;
    container.className = 'sl-mermaid';
  }
}

// ── Print-color-adjust inlining ──────────────────────────────────────────────

// Walk every element in the clone and set print-color-adjust:exact as an
// inline style.  This is more reliable than a CSS rule because headless
// Chromium has been observed to ignore the stylesheet-level declaration.
function inlinePrintColorAdjust(root: HTMLElement): void {
  const walk = (el: HTMLElement) => {
    el.style.setProperty('-webkit-print-color-adjust', 'exact', 'important');
    el.style.setProperty('print-color-adjust', 'exact', 'important');
    for (const child of Array.from(el.children)) {
      if (child instanceof HTMLElement) walk(child);
    }
  };
  walk(root);
}

// ── Image resolution ─────────────────────────────────────────────────────────

async function resolveImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src') ?? '';
    let dataUrl: string|null = null;
    try {
      if (src.startsWith('asset://')) {
        const path = decodeURIComponent(src.replace(/^asset:\/\/[^/]*/, ''));
        const b64 = await invoke<string>('read_file_b64', {path});
        dataUrl = `data:${imageMime(path)};base64,${b64}`;
      } else if (src.startsWith('https://') || src.startsWith('http://')) {
        const [b64, mime] =
            await invoke<[string, string]>('fetch_url_b64', {url: src});
        dataUrl = `data:${mime};base64,${b64}`;
      } else if (src.startsWith('tauri://') || src.startsWith('/')) {
        const fetchUrl = src.startsWith('/') ? `tauri://localhost${src}` : src;
        const res = await fetch(fetchUrl);
        if (res.ok) dataUrl = await blobToDataUrl(await res.blob());
      }
    } catch { /* leave original src */
    }
    if (dataUrl) img.src = dataUrl;
  }));
}

async function resolveVideos(el: HTMLElement): Promise<void> {
  const vids = Array.from(el.querySelectorAll<HTMLVideoElement>('video'));
  await Promise.all(vids.map(async (vid) => {
    const src = vid.getAttribute('src') ?? '';
    let dataUrl: string|null = null;
    try {
      if (src.startsWith('asset://')) {
        const path = decodeURIComponent(src.replace(/^asset:\/\/[^/]*/, ''));
        const b64 = await invoke<string>('read_file_b64', {path});
        dataUrl = `data:${videoMime(path)};base64,${b64}`;
      } else if (src.startsWith('https://') || src.startsWith('http://')) {
        const [b64, mime] =
            await invoke<[string, string]>('fetch_url_b64', {url: src});
        dataUrl = `data:${mime};base64,${b64}`;
      } else if (src.startsWith('tauri://') || src.startsWith('/')) {
        const fetchUrl = src.startsWith('/') ? `tauri://localhost${src}` : src;
        const res = await fetch(fetchUrl);
        if (res.ok) dataUrl = await blobToDataUrl(await res.blob());
      }
    } catch { /* leave original src */
    }
    if (dataUrl) vid.src = dataUrl;
  }));
}

// ── CSS extraction ───────────────────────────────────────────────────────────

async function extractAllCss(): Promise<string> {
  const parts: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules ?? []);
      parts.push(rules.map((r) => r.cssText).join('\n'));
    } catch {
      // Cross-origin sheet — fetch and inline as text.
      if (sheet.href) {
        try {
          const res = await fetch(sheet.href);
          if (res.ok) parts.push(await res.text());
        } catch { /* skip */
        }
      }
    }
  }

  return resolveFontUrls(parts.join('\n'));
}

// ── Font URL resolution ──────────────────────────────────────────────────────

// Browsers resolve relative CSS URLs against the document origin when returning
// cssText, so /fonts/... becomes tauri://localhost/fonts/... in rule text.
// We fetch those via the browser (no IPC) and embed them as data: URIs so the
// self-contained HTML works when loaded from a temp file:// path.
async function resolveFontUrls(css: string): Promise<string> {
  const FONT_URL_RE = /url\((['"]?)([^'")\s]+\.(?:woff2?|ttf|otf|eot))\1\)/gi;

  // Collect unique font URLs first.
  const urls = new Set<string>();
  for (const m of css.matchAll(FONT_URL_RE)) urls.add(m[2]);

  // Resolve each to a data URI.
  const resolved = new Map<string, string>();
  await Promise.all(Array.from(urls).map(async (url) => {
    try {
      let dataUrl: string;
      if (url.startsWith('asset://')) {
        const path = decodeURIComponent(url.replace(/^asset:\/\/[^/]*/, ''));
        const b64 = await invoke<string>('read_file_b64', {path});
        dataUrl = `data:${extToFontMime(path)};base64,${b64}`;
      } else if (url.startsWith('tauri://') || url.startsWith('/')) {
        const fetchUrl = url.startsWith('/') ? `tauri://localhost${url}` : url;
        const res = await fetch(fetchUrl);
        if (!res.ok) return;
        dataUrl = await blobToDataUrl(await res.blob());
      } else {
        return;  // leave http/https font URLs as-is
      }
      resolved.set(url, dataUrl);
    } catch { /* leave URL as-is */
    }
  }));

  // Replace all matched URLs in the CSS.
  return css.replace(FONT_URL_RE, (match, q, url) => {
    const r = resolved.get(url);
    return r ? `url(${q}${r}${q})` : match;
  });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(
      /[&<>]/g,
      (c) =>
          (c === '&'     ? '&amp;' :
               c === '<' ? '&lt;' :
                           '&gt;'));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function extToFontMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'woff2') return 'font/woff2';
  if (ext === 'woff') return 'font/woff';
  if (ext === 'ttf') return 'font/ttf';
  if (ext === 'otf') return 'font/otf';
  return 'font/woff2';
}
