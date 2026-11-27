import { dirnameOn, pathSeparator } from './paths';
import { isDataUrl } from './assetUrl';

const IMG_RE = /!\[[^\]]*\]\(([^\s)]+)/g;

/**
 * How many Markdown image references in `content` point outside the folder of
 * `filePath`: absolute paths elsewhere, or relative paths that climb out with
 * `..`. Web, data and asset URLs are not files and are never counted.
 */
export function countExternalImages(content: string, filePath: string): number {
  const docDir = dirnameOn(filePath, pathSeparator(filePath));
  let count = 0;
  for (const m of content.matchAll(IMG_RE)) {
    const src = m[1];
    if (isDataUrl(src) || /^(https?|asset|tauri):\/\//i.test(src)) continue;
    if (/^[A-Za-z]:[/\\]/.test(src) || src.startsWith('/')) {
      if (!src.startsWith(docDir)) count++;
    } else if (src.startsWith('..')) {
      count++;
    }
  }
  return count;
}
