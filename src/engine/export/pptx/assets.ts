// Asset resolution for the PPTX export: images, videos, Mermaid diagrams and
// display math are all turned into data: URLs before any slide is built, so
// pptxgenjs never has to make a network request. Local and remote files are
// read through the AssetLoader port, never Tauri directly.
import type { AssetLoader } from '../../ports';
import { mermaidSvgCache } from '../mermaidSvgCache';
import { svgToPngDataUrl } from '../svgToPng';
import { queuedMermaidRender } from '../mermaidRenderQueue';
import { buildMermaidRenderSource } from '../mermaidSource';
import { imageMime } from '../imageMime';
import { videoMime } from '../videoMime';
import { buildExportMermaidInit } from '../mermaidExportTheme';
import mermaid from 'mermaid';
import katex from 'katex';
import html2canvas from 'html2canvas';
import 'katex/dist/katex.min.css';
import type { Slide, SlideElement } from '../../types';
import type { Theme } from '../../theme';

mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'antiscript' });

export async function mermaidToDataUrl(value: string, t: Theme): Promise<{ dataUrl: string; aspectRatio: number } | null> {
  // Prefer the SVG already rendered by the live preview — calling mermaid.render()
  // concurrently hangs when the same diagram is already present in the live-preview DOM.
  const cached = mermaidSvgCache.get(value);
  if (cached) {
    try {
      return await svgToPngDataUrl(cached, t.colors.background);
    } catch {
      return null;
    }
  }

  // Cache miss (slide not yet visible in preview): fall back to direct render,
  // serialized via queuedMermaidRender against every other render() call in
  // the app (not just other calls within this export) — see mermaidRenderQueue.ts.
  const init = buildExportMermaidInit(t);
  const id = `pptx-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const src = buildMermaidRenderSource(value, init);
    const { svg } = await queuedMermaidRender(id, src);
    return await svgToPngDataUrl(svg, t.colors.background);
  } catch {
    return null;
  }
}

/** Render display math (`$$…$$`) to a PNG data URL for PPTX (issue #196). */
export async function mathToDataUrl(
  value: string,
  bgColor: string,
): Promise<{ dataUrl: string; aspectRatio: number } | null> {
  let html: string;
  try {
    html = katex.renderToString(value, { displayMode: true, throwOnError: false });
  } catch {
    return null;
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed',
    'left:-99999px',
    'top:0',
    'padding:24px',
    `background:${bgColor}`,
    'display:inline-block',
    'font-size:28px',
    'line-height:1.4',
    'color:#111',
  ].join(';');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  try {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    // html2canvas, not html-to-image — the latter serialises the node into an
    // SVG <foreignObject>, loads *that* via `Image.src = data:...`, then
    // `ctx.drawImage`-s it onto a canvas, and WebKitGTK has more than one
    // documented problem with that specific path: exportPdf.ts's captureSlide
    // already works around it not painting plain <img> elements at all, and
    // this formula rendering hit a blank capture too (no exception anywhere
    // in the chain — a validly-sized PNG that's simply empty) despite KaTeX's
    // output containing no <img> tags, so it isn't the same known case,
    // just the same underlying technique. svgToPngDataUrl sidesteps its own
    // version of this for Mermaid by replacing foreignObject text with native
    // SVG <text>/<tspan> — not viable for KaTeX's fractions/roots/nested
    // positioning. html2canvas instead walks the DOM and redraws each element
    // with plain Canvas 2D primitives (foreignObjectRendering stays off — the
    // default — since enabling it opts back into the same foreignObject
    // path), avoiding the whole class of issue rather than chasing each
    // symptom. isCanvasBlank stays as a safety net regardless — if rendering
    // fails for some other reason, callers already fall back to the LaTeX
    // source as plain text, which beats an empty shape that still animates
    // as if something were there.
    const canvas = await html2canvas(wrap, { backgroundColor: bgColor, scale: 2 });
    if (isCanvasBlank(canvas, bgColor)) return null;
    return { dataUrl: canvas.toDataURL(), aspectRatio: canvas.width / canvas.height };
  } catch {
    return null;
  } finally {
    wrap.remove();
  }
}

// Renders `bgColor` into a throwaway 1x1 canvas and compares every pixel of
// `canvas` against those exact bytes (not a parsed CSS colour) — samples the
// canvas the same way a browser's own 2D context would resolve `bgColor`,
// so this can't disagree with what "background, nothing drawn" actually
// looks like in this environment's colour handling.
function isCanvasBlank(canvas: HTMLCanvasElement, bgColor: string): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const pctx = probe.getContext('2d');
  if (!pctx) return true;
  pctx.fillStyle = bgColor;
  pctx.fillRect(0, 0, 1, 1);
  const [bgR, bgG, bgB] = pctx.getImageData(0, 0, 1, 1).data;

  const TOLERANCE = 6;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // fully transparent pixel
    if (
      Math.abs(data[i] - bgR) > TOLERANCE
      || Math.abs(data[i + 1] - bgG) > TOLERANCE
      || Math.abs(data[i + 2] - bgB) > TOLERANCE
    ) return false;
  }
  return true;
}

export async function assetUrlToDataUrl(src: string, assets: AssetLoader): Promise<string> {
  try {
    // asset:// URLs are user files served via Tauri's asset protocol.
    // fetch() on macOS WKWebView cannot reach asset:// because connect-src
    // does not include asset:. Read the file natively instead.
    if (src.startsWith('asset://')) {
      const path = decodeURIComponent(src.replace(/^asset:\/\/[^/]*/, ''));
      const ext  = path.split('.').pop()?.toLowerCase() ?? 'png';
      const b64  = await assets.readFileB64(path);
      return `data:${imageMime(ext)};base64,${b64}`;
    }
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

export function getImageAspectRatio(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : null,
    );
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Remote https:// images can't be fetched by PptxGenJS in WKWebView because
// connect-src only allows specific domains. Fetch them natively via Tauri so
// pres.write() always receives data: URLs and never needs to make network calls.
export async function fetchUrlToDataUrl(url: string, assets: AssetLoader): Promise<string> {
  try {
    const [b64, mime] = await assets.fetchUrlB64(url);
    return `data:${mime};base64,${b64}`;
  } catch {
    return url;
  }
}

export async function resolveImageSrcForExport(src: string, assets: AssetLoader): Promise<string> {
  if (src.startsWith('asset://') || src.startsWith('tauri://')) return assetUrlToDataUrl(src, assets);
  if (src.startsWith('http://') || src.startsWith('https://')) return fetchUrlToDataUrl(src, assets);
  return src;
}

/** Resolve a video src to a data: URL for PPTX `addMedia` (mirrors image path). */
export async function videoUrlToDataUrl(src: string, assets: AssetLoader): Promise<string> {
  try {
    if (src.startsWith('data:')) return src;
    if (src.startsWith('asset://')) {
      const path = decodeURIComponent(src.replace(/^asset:\/\/[^/]*/, ''));
      const b64 = await assets.readFileB64(path);
      return `data:${videoMime(path)};base64,${b64}`;
    }
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return fetchUrlToDataUrl(src, assets);
    }
    if (src.startsWith('tauri://') || src.startsWith('/')) {
      const fetchUrl = src.startsWith('/') ? `tauri://localhost${src}` : src;
      const res = await fetch(fetchUrl);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    return src;
  } catch {
    return src;
  }
}

export function videoExtnFromDataUrl(dataUrl: string): string {
  const mime = (dataUrl.match(/^data:([^;,]+)/i)?.[1] ?? 'video/mp4').toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime') || mime.endsWith('/mov')) return 'mov';
  if (mime.includes('ogg')) return 'ogv';
  if (mime.includes('matroska') || mime.includes('x-m4v')) return mime.includes('m4v') ? 'm4v' : 'mkv';
  return 'mp4';
}

// Mermaid uses global DOM state and cannot handle concurrent render() calls —
// running slides in parallel causes the second Mermaid render to hang forever.
// Process everything sequentially so Mermaid renders one at a time.
export async function resolveSlideImages(slides: Slide[], theme: Theme, warnings: string[], assets: AssetLoader): Promise<Slide[]> {
  const resolved: Slide[] = [];
  for (const slide of slides) {
    const elements: SlideElement[] = [];
    for (const el of slide.elements) {
      if (el.type === 'image') {
        const src = (el.src.startsWith('asset://') || el.src.startsWith('tauri://'))
          ? await assetUrlToDataUrl(el.src, assets)
          : (el.src.startsWith('http://') || el.src.startsWith('https://'))
          ? await fetchUrlToDataUrl(el.src, assets)
          : el.src;
        const ar = src.startsWith('data:') ? await getImageAspectRatio(src) : null;
        elements.push({ ...el, src, title: ar != null ? String(ar) : el.title });
      } else if (el.type === 'mermaid') {
        const result = await mermaidToDataUrl(el.value, theme);
        if (result) {
          // step must carry over — this is a rendering substitution, not a
          // new element; dropping it would silently un-gate a stepped diagram.
          elements.push({ type: 'image' as const, src: result.dataUrl, alt: 'Diagram', title: String(result.aspectRatio), caption: el.caption, step: el.step });
        } else {
          warnings.push(`Mermaid diagram could not be rendered and was skipped (slide: "${slide.title ?? 'untitled'}")`);
          elements.push(el);
        }
      } else if (el.type === 'math' && el.display) {
        const result = await mathToDataUrl(el.value, theme.colors.background);
        if (result) {
          elements.push({
            type: 'image' as const,
            src: result.dataUrl,
            alt: 'Formula',
            title: String(result.aspectRatio),
            caption: el.caption,
            step: el.step, // see the mermaid case above
          });
        } else {
          warnings.push(`Display math could not be rendered and was skipped (slide: "${slide.title ?? 'untitled'}")`);
          elements.push(el);
        }
      } else if (el.type === 'video') {
        const src = await videoUrlToDataUrl(el.src, assets);
        elements.push({ ...el, src });
      } else {
        elements.push(el);
      }
    }
    let backgroundImage = slide.backgroundImage;
    if (backgroundImage) {
      const src = await resolveImageSrcForExport(backgroundImage.src, assets);
      let aspectRatio: number | undefined;
      if (backgroundImage.size === 'contain' && src.startsWith('data:')) {
        const ar = await getImageAspectRatio(src);
        if (ar != null && isFinite(ar)) aspectRatio = ar;
      }
      backgroundImage = { ...backgroundImage, src, aspectRatio };
    }
    resolved.push({ ...slide, elements, backgroundImage });
  }
  return resolved;
}

// Pre-resolve theme logo once (fetch → data URL, measure AR) so it can be
// stamped on every slide without repeated network requests.
export async function resolveThemeLogo(
  theme: Theme,
  assets: AssetLoader,
): Promise<{ logoDataUrl: string | null; logoAr: number | null }> {
  let logoDataUrl: string | null = null;
  let logoAr: number | null = null;
  if (theme.logo) {
    try {
      const resolved = await assetUrlToDataUrl(theme.logo, assets);
      if (resolved.startsWith('data:')) {
        logoDataUrl = resolved;
        logoAr = await getImageAspectRatio(resolved);
      }
    } catch { /* logo unavailable — skip silently */ }
  }
  return { logoDataUrl, logoAr };
}
