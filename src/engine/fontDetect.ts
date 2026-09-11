/**
 * Font availability detection for the inspector's "font isn't installed" warning
 * and the editor-font picker.
 *
 * `isFontAvailable` reports whether the *primary* family of a CSS font stack is
 * actually installed. It asks the Font Loading API first (authoritative for
 * locally installed fonts where supported) and falls back to a canvas metric
 * comparison against all three generic families — comparing against monospace,
 * serif *and* sans-serif rather than just one makes a coincidental width match
 * (a false "missing") far less likely.
 */

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'math', 'emoji', 'fangsong',
  'inherit', 'initial', 'revert', 'revert-layer', 'unset',
]);

const BASE_FAMILIES = ['monospace', 'serif', 'sans-serif'] as const;
const SAMPLE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const cache = new Map<string, boolean>();
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

/** Split a CSS font-family value into individual, unquoted family names. */
export function parseFontStack(value: string): string[] {
  return value
    .split(',')
    .map((f) => f.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim())
    .filter(Boolean);
}

/** True if `family` names a CSS generic family rather than an installed font. */
export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.toLowerCase());
}

/** True if a single, unquoted, non-generic family name is installed. */
function singleFontInstalled(font: string): boolean {
  const cached = cache.get(font);
  if (cached !== undefined) return cached;

  let installed = false;

  // Font Loading API — synchronous and authoritative for installed fonts.
  try {
    const fonts = typeof document !== 'undefined'
      ? (document as Document & { fonts?: FontFaceSet }).fonts
      : undefined;
    if (fonts && typeof fonts.check === 'function' && fonts.check(`14px "${font}"`)) {
      installed = true;
    }
  } catch {
    // Unsupported or rejected input — fall through to the canvas measurement.
  }

  if (!installed) {
    if (!sharedCanvas && typeof document !== 'undefined') {
      sharedCanvas = document.createElement('canvas');
      sharedCtx = sharedCanvas.getContext('2d');
    }
    const ctx = sharedCtx;
    if (ctx) {
      installed = BASE_FAMILIES.some((base) => {
        ctx.font = `14px ${base}`;
        const baseWidth = ctx.measureText(SAMPLE).width;
        ctx.font = `14px "${font}", ${base}`;
        return ctx.measureText(SAMPLE).width !== baseWidth;
      });
    }
  }

  cache.set(font, installed);
  return installed;
}

/**
 * True if the *primary* family of a CSS font stack is installed. A bare generic
 * ("monospace") counts as available; an empty value does not.
 */
export function isFontAvailable(family: string): boolean {
  const [primary] = parseFontStack(family);
  if (!primary) return false;
  if (isGenericFamily(primary)) return true;
  return singleFontInstalled(primary);
}

/**
 * True if a CSS font stack renders as authored on this machine: at least one
 * named family in it is installed, or it names no non-generic families at all.
 * `extraInstalled` (e.g. the OS font list from the `list_system_fonts` command)
 * is treated as authoritative alongside the canvas/Font-Loading probe. Only a
 * stack whose every named family is missing is worth warning about.
 */
export function isFontStackSatisfied(family: string, extraInstalled: readonly string[] = []): boolean {
  const named = parseFontStack(family).filter((f) => !isGenericFamily(f));
  if (named.length === 0) return true;
  const extra = new Set(extraInstalled.map((f) => f.toLowerCase()));
  return named.some((f) => extra.has(f.toLowerCase()) || singleFontInstalled(f));
}
