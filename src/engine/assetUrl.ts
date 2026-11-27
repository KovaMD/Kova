// Tauri asset-protocol URLs (what convertFileSrc returns for a local file).
//
// The scheme differs by platform: asset://localhost/<encoded path> on macOS
// and Linux, but http://asset.localhost/<encoded path> on Windows, where
// WebView2 cannot load custom schemes. Code that sniffs only `asset://`
// silently misses Windows and treats the file as a remote http URL, so every
// check goes through here.

const ASSET_PREFIX_RE = /^(?:asset:\/\/[^/]*|https?:\/\/asset\.localhost)(?=\/)/i;
const HTML_ASSET_SRC_RE = /src="(?:asset:\/\/|https?:\/\/asset\.localhost\/)/i;

/** True for an asset-protocol URL in either platform form. */
export function isAssetUrl(src: string): boolean {
  return ASSET_PREFIX_RE.test(src);
}

/** True for a data: URL (`data:mime;...`; there is no `//`). */
export function isDataUrl(src: string): boolean {
  return /^data:/i.test(src);
}

/** True when an HTML fragment has a src attribute pointing at an asset URL. */
export function htmlHasAssetSrc(html: string): boolean {
  return HTML_ASSET_SRC_RE.test(html);
}

/**
 * The local file path behind an asset URL. Windows paths lose the slash left
 * in front of the drive letter (/C:/... becomes C:/...).
 */
export function assetUrlToPath(src: string): string {
  return decodeURIComponent(src.replace(ASSET_PREFIX_RE, '')).replace(/^\/(?=[A-Za-z]:)/, '');
}
