import { copyImageToAssets } from '../../platform/ipc';
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS, extensionRegex } from '../../engine/mediaTypes';
import { dirname, segments, stem, toForwardSlashes } from '../../engine/paths';

// Returns a path to `target` relative to the directory of `docPath`.
function makeRelativePath(docPath: string, target: string): string {
  const docParts = segments(docPath).slice(0, -1);
  const tgtParts = segments(target);
  let common = 0;
  while (common < docParts.length && common < tgtParts.length && docParts[common] === tgtParts[common]) common++;
  const up = docParts.length - common;
  const rel = [...Array(up).fill('..'), ...tgtParts.slice(common)].join('/');
  return rel || target;
}

// Encode characters that break CommonMark URL parsing (spaces, unbalanced parens).
export function encodeMarkdownPath(p: string): string {
  return p.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

const VIDEO_EXT = extensionRegex(VIDEO_EXTENSIONS);
export const MEDIA_EXT = extensionRegex(MEDIA_EXTENSIONS);

export async function resolveImagePathForMarkdown(
  abs: string,
  docPath: string,
  warn: (m: string) => void,
): Promise<string | null> {
  const docDir = dirname(docPath);
  const normAbs = toForwardSlashes(abs);
  const normDir = toForwardSlashes(docDir);

  let rel: string;
  if (normAbs.startsWith(normDir + '/')) {
    rel = makeRelativePath(docPath, abs);
  } else {
    try {
      rel = `assets/${await copyImageToAssets(abs, docDir)}`;
    } catch (e) {
      console.error('[Kova] copy media to assets failed:', e);
      warn('Could not copy media — on macOS, grant Kova access under System Settings → Privacy & Security → Files and Folders.');
      return null;
    }
  }
  return encodeMarkdownPath(rel);
}

export async function buildMediaSnippet(abs: string, docPath: string, warn: (m: string) => void): Promise<string | null> {
  const enc = await resolveImagePathForMarkdown(abs, docPath, warn);
  if (!enc) return null;
  const label = stem(abs);
  return VIDEO_EXT.test(abs) ? `!video[${label}](${enc})` : `![${label}](${enc})`;
}
