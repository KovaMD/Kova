import { normalizePath } from './resolvePath';
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS, extensionRegex } from './mediaTypes';

function decodePathComponent(src: string): string {
  try { return decodeURIComponent(src); } catch { return src; }
}

export const MEDIA_EXT_RE = extensionRegex(MEDIA_EXTENSIONS, true);
export const VIDEO_EXT_RE = extensionRegex(VIDEO_EXTENSIONS, true);

// Returns the resolved absolute local path for a src that points to a local
// image or video file, or null if the src is a web URL, data URL, or unsupported type.
export function localPathFromMediaSrc(src: string, docDir: string): string | null {
  if (/^(https?|data|asset|tauri):\/\//i.test(src)) return null;
  const p = decodePathComponent(src);
  if (!MEDIA_EXT_RE.test(p)) return null;
  if (p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p)) return p.replace(/[?#].*$/, '');
  if (!docDir) return null;
  return normalizePath(docDir, p).replace(/[?#].*$/, '');
}

/** Turns an absolute local path into a URL the webview can load (Tauri's convertFileSrc). */
export type ToAssetUrl = (path: string) => string;

// localImageUrls maps absolute local paths → data: URLs loaded via read_file_b64.
// Falls back to toAssetUrl (asset://) while the async load is in flight.
export function resolveImageSrc(
  src: string, docDir: string, localImageUrls: Map<string, string>, toAssetUrl: ToAssetUrl,
): string {
  const localPath = localPathFromMediaSrc(src, docDir);
  if (localPath) return localImageUrls.get(localPath) ?? toAssetUrl(localPath.replace(/\\/g, '/'));
  if (/^(https?|data|asset|tauri):\/\//i.test(src)) return src;
  const p = decodePathComponent(src);
  if (p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p)) return toAssetUrl(p.replace(/\\/g, '/'));
  if (!docDir) return p;
  return toAssetUrl(normalizePath(docDir, p).replace(/\\/g, '/'));
}

export function resolveHtmlSrcs(
  html: string, docDir: string, localImageUrls: Map<string, string>, toAssetUrl: ToAssetUrl,
): string {
  return html.replace(/src="([^"]*)"/g, (_, src) => `src="${resolveImageSrc(src, docDir, localImageUrls, toAssetUrl)}"`);
}
