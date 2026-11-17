// The single list of media file extensions Kova accepts. Every file picker
// filter and extension regex is derived from these lists, so all image
// pickers accept exactly the set the renderer supports.
//
// The Rust side keeps its own copy in src-tauri/src/commands/assets.rs
// (read_file_b64). A test in src/engine/__tests__/mediaTypes.test.ts reads that
// file and fails if the two drift apart.

export const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif', 'tif', 'tiff', 'ico',
] as const;

export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'] as const;

export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] as const;

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export const IMAGE_DIALOG_FILTER: DialogFilter = { name: 'Images', extensions: [...IMAGE_EXTENSIONS] };
export const MEDIA_DIALOG_FILTER: DialogFilter = { name: 'Media', extensions: [...MEDIA_EXTENSIONS] };

/**
 * Builds a case-insensitive regex matching a path that ends in one of `exts`.
 * With `allowQuerySuffix`, a trailing `?query` or `#hash` is also accepted.
 */
export function extensionRegex(exts: readonly string[], allowQuerySuffix = false): RegExp {
  const tail = allowQuerySuffix ? '(?:[?#].*)?$' : '$';
  return new RegExp(`\\.(${exts.join('|')})${tail}`, 'i');
}
