import { toJpeg } from 'html-to-image';
import { invoke } from '@tauri-apps/api/core';
import { mermaidSvgCache } from './mermaidSvgCache';
import { svgToPngDataUrl } from './svgToPng';
import { queuedMermaidRender } from './mermaidRenderQueue';
import { buildMermaidRenderSource } from './mermaidSource';
import { imageMime } from './imageMime';
import { buildExportMermaidInit } from './mermaidExportTheme';
import type { AspectRatio } from '../types';
import type { Theme } from '../theme';

export interface PdfExportResult {
  base64: string;
  warnings: string[];
}

const PDF_W_MM     = 254;
const JPEG_QUALITY = 0.95;
const PIXEL_RATIO  = 2;

// 1x1 transparent PNG — stands in for images html-to-image cannot fetch.
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// On macOS WKWebView, canvas.toDataURL() throws a SecurityError when the canvas
// contains images loaded from cross-origin sources (asset:// or remote https://)
// because the webview's CSP connect-src blocks fetch() to those URLs. Pre-resolve
// all such <img> src attributes to data: URLs via native Tauri commands so the
// canvas stays untainted during html-to-image capture.
async function preResolveExternalImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.src;
    let dataUrl: string | null = null;
    try {
      if (src.startsWith('asset://')) {
        const path = decodeURIComponent(src.replace(/^asset:\/\/[^/]*/, ''));
        const ext  = path.split('.').pop()?.toLowerCase() ?? 'png';
        const b64  = await invoke<string>('read_file_b64', { path });
        dataUrl = `data:${imageMime(ext)};base64,${b64}`;
      } else if (src.startsWith('http://') || src.startsWith('https://')) {
        const [b64, mime] = await invoke<[string, string]>('fetch_url_b64', { url: src });
        dataUrl = `data:${mime};base64,${b64}`;
      }
    } catch { /* leave original src */ }
    if (!dataUrl) return;
    await new Promise<void>((resolve) => {
      img.onload  = () => resolve();
      img.onerror = () => resolve();
      img.src = dataUrl!;
    });
  }));
}

// html-to-image rejects with a DOM Event for image failures, which stringifies
// to a useless "[object Event]".
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err instanceof Event) {
    const target = err.target as HTMLImageElement | null;
    return target?.src ? `failed to load ${target.src}` : `${err.type} error`;
  }
  return String(err);
}

// Capture a slide as JPEG then composite each Mermaid diagram on top.
// This avoids modifying the DOM before capture and avoids relying on
// the off-screen SlideRenderer's Mermaid renders completing in time.
async function captureSlide(slideEl: HTMLElement, theme: Theme): Promise<string> {
  // Pre-resolve asset:// and remote https:// images to data: URLs so the canvas stays untainted on macOS.
  await preResolveExternalImages(slideEl);

  // WebKitGTK's foreignObject renderer (used by html-to-image) does not paint
  // <img> elements even when src is already a data: URL — the image area comes
  // out blank while text and backgrounds render correctly. Work around this by
  // hiding every <img> before the base capture, then compositing each one
  // manually onto the canvas afterwards, exactly as mermaid diagrams are handled.
  const imgs = Array.from(slideEl.querySelectorAll<HTMLImageElement>('img'));
  imgs.forEach((img) => { img.style.visibility = 'hidden'; });

  // Step 1: base screenshot — image areas are blank placeholders; Mermaid
  // containers may also be placeholders. Everything else (backgrounds, text,
  // shapes, layout) is captured here.
  // A broken or unreachable image URL makes html-to-image reject the whole
  // capture (it assigns an empty src to the clone and rejects on its error
  // event). The placeholder plus the no-op error handler keep the rest of the
  // slide renderable; real images are composited from the live DOM in step 3.
  const baseJpeg = await toJpeg(slideEl, {
    quality: JPEG_QUALITY,
    pixelRatio: PIXEL_RATIO,
    width: slideEl.offsetWidth,
    height: slideEl.offsetHeight,
    imagePlaceholder: TRANSPARENT_PIXEL,
    onImageErrorHandler: () => {},
  });

  // Step 2: build a canvas from the base JPEG.
  const W = slideEl.offsetWidth  * PIXEL_RATIO;
  const H = slideEl.offsetHeight * PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, W, H);
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load base JPEG'));
    img.src = baseJpeg;
  });

  // Step 3: restore image visibility and composite each <img> onto the canvas.
  // getBoundingClientRect is valid even while visibility:hidden (layout is unchanged).
  const slideRect = slideEl.getBoundingClientRect();
  imgs.forEach((img) => { img.style.visibility = ''; });
  await Promise.all(imgs.map((img) => new Promise<void>((resolve) => {
    const paint = () => {
      if (img.naturalWidth === 0 || img.naturalHeight === 0) { resolve(); return; }
      const r   = img.getBoundingClientRect();
      const cx  = (r.left   - slideRect.left) * PIXEL_RATIO;
      const cy  = (r.top    - slideRect.top)  * PIXEL_RATIO;
      const cw  = r.width   * PIXEL_RATIO;
      const ch  = r.height  * PIXEL_RATIO;
      // object-fit: contain — scale to fit while preserving aspect ratio, centred.
      const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      const fitW  = img.naturalWidth  * scale;
      const fitH  = img.naturalHeight * scale;
      try { ctx.drawImage(img, cx + (cw - fitW) / 2, cy + (ch - fitH) / 2, fitW, fitH); } catch { /* skip undrawable image */ }
      resolve();
    };
    if (img.complete) { paint(); } else { img.onload = paint; img.onerror = () => resolve(); }
  })));

  // Step 4: composite each Mermaid diagram on top.
  // [data-mermaid-src] is present on both the loading and rendered states.
  const containers = Array.from(slideEl.querySelectorAll<HTMLElement>('[data-mermaid-src]'));

  for (const container of containers) {
    const source = container.getAttribute('data-mermaid-src')!;

    let cached = mermaidSvgCache.get(source);
    if (!cached) {
      // Cache miss: queuedMermaidRender serializes this against every other
      // render() call in the app (including the off-screen SlideRenderer trees
      // that mount simultaneously for this very export), not just other
      // diagrams within this loop — see mermaidRenderQueue.ts.
      try {
        const init = buildExportMermaidInit(theme);
        const src  = buildMermaidRenderSource(source, init);
        const id = `pdf-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await queuedMermaidRender(id, src);
        mermaidSvgCache.set(source, result.svg);
        cached = result.svg;
      } catch {
        continue; // skip diagrams that fail or time out
      }
    }

    try {
      const { dataUrl, aspectRatio: diagramAR } = await svgToPngDataUrl(cached, theme.colors.background);
      const containerRect = container.getBoundingClientRect();
      const cx = (containerRect.left - slideRect.left) * PIXEL_RATIO;
      const cy = (containerRect.top  - slideRect.top)  * PIXEL_RATIO;
      const cw = containerRect.width  * PIXEL_RATIO;
      const ch = containerRect.height * PIXEL_RATIO;

      // Fit the diagram within the container preserving its natural aspect ratio
      // (object-fit: contain, centred) so tall sequence/pie charts aren't stretched.
      let drawW = cw;
      let drawH = cw / diagramAR;
      if (drawH > ch) { drawH = ch; drawW = ch * diagramAR; }
      const drawX = cx + (cw - drawW) / 2;
      const drawY = cy + (ch - drawH) / 2;

      await new Promise<void>((resolve) => {
        const diagramImg = new Image();
        diagramImg.onload  = () => { ctx.drawImage(diagramImg, drawX, drawY, drawW, drawH); resolve(); };
        diagramImg.onerror = () => resolve();
        diagramImg.src = dataUrl;
      });
    } catch { /* leave whatever the base capture produced */ }
  }

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

export async function printPresentation(
  slideElements: HTMLElement[],
  theme: Theme,
  aspectRatio: AspectRatio,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const images: string[] = [];

  for (let i = 0; i < slideElements.length; i++) {
    try {
      images.push(await captureSlide(slideElements[i], theme));
    } catch (err) {
      warnings.push(`Slide ${i + 1}: capture failed — ${describeError(err)}`);
      console.error(`Slide ${i + 1} capture error:`, err);
    }
  }

  if (images.length === 0) return { warnings };

  const orientation = aspectRatio.w >= aspectRatio.h ? 'landscape' : 'portrait';
  const html = [
    '<!DOCTYPE html><html><head><style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    `@page{size:${orientation};margin:0}`,
    'html,body{width:100%;height:100%;background:#000}',
    '.page{page-break-after:always;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}',
    '.page:last-child{page-break-after:avoid}',
    'img{max-width:100%;max-height:100%;object-fit:contain;display:block}',
    '</style></head><body>',
    images.map((url) => `<div class="page"><img src="${url}"/></div>`).join(''),
    '</body></html>',
  ].join('');

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-99999px;left:-99999px;width:1280px;height:720px;border:none;visibility:hidden';
  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    const cleanup = () => { iframe.remove(); resolve(); };
    const iwin = iframe.contentWindow!;
    let printCalled = false;
    let cleanupScheduled = false;

    const triggerCleanup = () => {
      if (cleanupScheduled) return;
      cleanupScheduled = true;
      cleanup();
    };

    const triggerPrint = () => {
      if (printCalled) return;
      printCalled = true;
      iwin.print();
    };

    iwin.addEventListener('afterprint', triggerCleanup, { once: true });
    // Use a shorter timeout (5 seconds) because the afterprint event may not fire when user cancels
    const fallback = setTimeout(triggerCleanup, 5000);
    iwin.addEventListener('afterprint', () => clearTimeout(fallback), { once: true });
    const idoc = iframe.contentDocument!;
    idoc.open();
    idoc.write(html);
    idoc.close();
    
    // Wait for all images to load before printing
    const onLoad = () => {
      const imgs = Array.from(idoc.querySelectorAll<HTMLImageElement>('img'));
      if (imgs.length === 0) {
        triggerPrint();
        return;
      }
      
      let loadedCount = 0;
      const checkAllLoaded = () => {
        loadedCount++;
        if (loadedCount === imgs.length) {
          triggerPrint();
        }
      };
      
      imgs.forEach((img) => {
        if (img.complete) {
          checkAllLoaded();
        } else {
          img.onload = checkAllLoaded;
          img.onerror = checkAllLoaded;
        }
      });
    };
    
    // Always set up listener for DOMContentLoaded (might have already fired)
    const onDomReady = () => onLoad();
    idoc.addEventListener('DOMContentLoaded', onDomReady, { once: true });
    
    // Also check current state in case DOMContentLoaded already fired
    if (idoc.readyState !== 'loading') {
      onLoad();
    }
  });

  return { warnings };
}

export async function exportToPdf(
  slideElements: HTMLElement[],
  theme: Theme,
  aspectRatio: AspectRatio,
): Promise<PdfExportResult> {
  const warnings: string[] = [];
  const W = PDF_W_MM;
  const H = Math.round((W * (aspectRatio.h / aspectRatio.w)) * 100) / 100;

  // Lazy-loaded: jsPDF is only needed once a PDF export is actually
  // triggered, and shouldn't add weight to the app's initial bundle.
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: [W, H], compress: true });

  for (let i = 0; i < slideElements.length; i++) {
    if (i > 0) pdf.addPage([W, H], 'l');
    try {
      const dataUrl = await captureSlide(slideElements[i], theme);
      pdf.addImage(dataUrl, 'JPEG', 0, 0, W, H, undefined, 'FAST');
    } catch (err) {
      warnings.push(`Slide ${i + 1}: capture failed — ${describeError(err)}`);
      console.error(`Slide ${i + 1} capture error:`, err);
    }
  }

  const raw = pdf.output('datauristring');
  const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
  return { base64, warnings };
}
