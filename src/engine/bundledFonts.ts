// Font registration for both bundled (app-embedded) and remote (download-once,
// verify, cache) fonts. Themes declare their font needs via `bundledFonts` and
// `remoteFonts` fields; the app calls these helpers to inject @font-face rules.

interface BundledFace {
  path: string;
  weight: string;  // e.g. "100 900" for variable, "400" for static
  style: 'normal' | 'italic';
  unicodeRange?: string;
}

interface BundledFontDef {
  faces: BundledFace[];
}

const REGISTRY: Record<string, BundledFontDef> = {
  Montserrat: {
    faces: [
      {
        path: '/fonts/Montserrat-variable-normal.woff2',
        weight: '100 900',
        style: 'normal',
        unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        path: '/fonts/Montserrat-variable-italic.woff2',
        weight: '100 900',
        style: 'italic',
        unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
    ],
  },
  'Kova Icons': {
    // Nerd Fonts "Symbols Only" (proportional build) — icon glyphs used by
    // the `:name:` shortcode (see engine/icons.ts).
    faces: [
      {
        path: '/fonts/kova-icons.woff2',
        weight: '400',
        style: 'normal',
      },
    ],
  },
};

/** Font families available for use in theme `bundledFonts` declarations. */
export const BUNDLED_FONT_NAMES = Object.keys(REGISTRY);

// ── Remote font registration ──────────────────────────────────────────────────

// Keyed by sha256 (the cached filename on disk) so re-activating a theme
// that was already loaded in this session doesn't re-inject the same rule.
const registeredRemote = new Set<string>();

/**
 * Injects a @font-face rule for a remote font that has been downloaded and
 * cached locally by the `download_and_cache_font` Rust command.
 * `cachedPath` is the local filesystem path returned by that command;
 * `convertFileSrc` turns it into an asset:// URL the webview can load.
 */
export function registerCachedFont(
  family: string,
  cachedPath: string,
  weight: string,
  style: 'normal' | 'italic',
  sha256: string,
  convertFileSrc: (path: string) => string,
): void {
  if (registeredRemote.has(sha256)) return;

  const url = convertFileSrc(cachedPath);
  const safeWeight = /[;{}'"]/.test(String(weight)) ? 'normal' : String(weight);
  const css = `@font-face {\n  font-family: "${family}";\n  src: url("${url}") format("woff2");\n  font-weight: ${safeWeight};\n  font-style: ${style};\n  font-display: swap;\n}`;
  const el = document.createElement('style');
  el.dataset.remoteFont = family;
  el.textContent = css;
  document.head.appendChild(el);
  registeredRemote.add(sha256);
}

const registered = new Set<string>();

/** Injects @font-face rules for the given family names. Idempotent. */
export function registerBundledFonts(families: string[]): void {
  for (const family of families) {
    if (registered.has(family)) continue;
    const def = REGISTRY[family];
    if (!def) continue;

    const css = def.faces.map((face) => {
      const unicodeRange = face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : '';
      return `@font-face {\n  font-family: "${family}";\n  src: url("${face.path}") format("woff2");\n  font-weight: ${face.weight};\n  font-style: ${face.style};\n  font-display: swap;${unicodeRange}\n}`;
    }).join('\n');

    const style = document.createElement('style');
    style.dataset.bundledFont = family;
    style.textContent = css;
    document.head.appendChild(style);
    registered.add(family);
  }
}
