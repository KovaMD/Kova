// CSS colour to the 6-digit hex string PptxGenJS requires.

export function hex(color: string): string {
  const h = color.replace('#', '').toUpperCase();
  return h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
}

// Convert any CSS colour value accepted by the parser into the 6-digit hex
// string PptxGenJS requires. `parseColorValue` in the parser already blocks
// injection-y values, so only legit colours reach here.
//
// Resolution order (per review of #150): resolve via the DOM first. A browser
// (and jsdom) normalises every sRGB-compatible colour — hex, named colours,
// `hsl()`/`hwb()`, and all modern notations like `lab()/lch()/oklab()/oklch()`
// — to `rgb(...)`, so this single path covers far more than a hand-maintained
// table ever could (and survives future CSS additions). We fall back to a local
// converter for exotic notations the DOM left unresolved (e.g. `oklch()` under
// jsdom) or for DOM-less contexts.
// A deck's slides overwhelmingly repeat the same 2-3 colour strings (the
// theme's text/heading/bold colours), but each call re-resolves via a
// DOM-append/getComputedStyle/remove round trip — a forced style recalc
// that's pure cost on every repeat. The result is a pure function of the
// input string (browser CSS colour parsing doesn't change mid-session), so
// caching indefinitely at module scope is safe across exports too.
const cssColorToHexCache = new Map<string, string>();

export function cssColorToHex(color: string, fallback = '000000'): string {
  const key = `${color ?? ''}\u0000${fallback}`;
  const cached = cssColorToHexCache.get(key);
  if (cached !== undefined) return cached;
  const result = resolveCssColorToHex(color, fallback);
  cssColorToHexCache.set(key, result);
  return result;
}

export function resolveCssColorToHex(color: string, fallback = '000000'): string {
  const v = (color ?? '').trim();
  if (!v) return hex(fallback);

  // 1) DOM resolution — normalises to `rgb(...)` wherever the engine supports it.
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const el = document.createElement('div');
    el.style.color = v;
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    document.body.removeChild(el);
    const fromDom = rgbToHex(resolved);
    if (fromDom) return fromDom;
  }

  // 2) Local fallback: hex handling, then the functional/colour notations the
  //    parser accepts, then the named-colour table.

  // #rgb / #rrggbb (with or without leading #) → 6-digit hex
  const h = v.replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{3}$/.test(h)) return h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (/^[0-9A-F]{6}$/.test(h)) return h;
  // #rrggbbaa → drop alpha
  if (/^[0-9A-F]{8}$/.test(h)) return h.slice(0, 6);

  // functional notations rgb()/rgba()/hsl()/hsla()/color()/hwb()/lab()/lch()/oklab()/oklch()
  const fn = v.match(/^(rgb|rgba|hsl|hsla|color|hwb|lab|lch|oklab|oklch)\(\s*(.*?)\s*\)$/i);
  if (fn) {
    const args = fn[2].split(/[\s,/]+/).filter(Boolean);
    const rgb = fn[1].toLowerCase();
    // rgb()/rgba() with numeric channels → hex. hsl()/hsla() are deliberately
    // NOT handled here: their h/s/l channels aren't 0-255 RGB values, so
    // reusing parseCssChannel on them would produce a wrong colour rather than
    // a safe fallback (e.g. hsl(0,100%,50%) red → 00FF80, not FF0000). The DOM
    // resolution path above already covers hsl() correctly for every real
    // call site; this branch only needs rgb()/rgba().
    if ((rgb === 'rgb' || rgb === 'rgba') && args.length >= 3) {
      const r = parseCssChannel(args[0], 255);
      const g = parseCssChannel(args[1], 255);
      const b = parseCssChannel(args[2], 255);
      if (r !== null && g !== null && b !== null) {
        return [r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
      }
    }
    // For `color(...)` with three 0–255-style sRGB channels, keep them.
    if (rgb === 'color') {
      const nums = args.map((a) => parseFloat(a)).filter((n) => !Number.isNaN(n));
      if (nums.length >= 3 && nums.every((n) => n >= 0 && n <= 255)) {
        return nums.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, '0').toUpperCase()).join('');
      }
    }
  }

  // named colours
  const named = NAMED_COLORS[v.toLowerCase()];
  if (named) return named;

  return hex(fallback);
}

// Extract a 6-digit hex from a `rgb(...)` / `rgba(...)` computed-style string.
// Returns null for anything that isn't an rgb family value (e.g. an unresolved
// `oklch(...)`), so the caller can fall through to the local converter.
function rgbToHex(resolved: string): string | null {
  const m = resolved.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const toHex = (n: string) => Math.round(Number(n)).toString(16).padStart(2, '0').toUpperCase();
  return toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
}

// Map a single rgb() channel value: integer 0–255 or percentage 0–100%.
// Returns null when the value isn't a plain channel (e.g. an hsl angle).
function parseCssChannel(token: string | undefined, max: number): number | null {
  if (!token) return null;
  if (/^\d+(\.\d+)?%$/.test(token)) {
    return Math.round((parseFloat(token) / 100) * max);
  }
  if (/^\d+(\.\d+)?$/.test(token)) {
    return Math.round(Math.min(max, Math.max(0, parseFloat(token))));
  }
  return null;
}

// CSS named colours commonly used for slide text. Marp decks frequently use
// bare names like `white`/`red`; the parser's colour validator already blocks
// anything containing spaces/quotes/`;{}/`, so this only resolves valid names.
const NAMED_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', lime: '00FF00',
  blue: '0000FF', yellow: 'FFFF00', cyan: '00FFFF', aqua: '00FFFF', magenta: 'FF00FF',
  fuchsia: 'FF00FF', silver: 'C0C0C0', gray: '808080', grey: '808080', maroon: '800000',
  olive: '808000', purple: '800080', teal: '008080', navy: '000080', orange: 'FFA500',
  pink: 'FFC0CB', brown: 'A52A2A', gold: 'FFD700', indigo: '4B0082', violet: 'EE82EE',
  turquoise: '40E0D0', salmon: 'FA8072', crimson: 'DC143C', tomato: 'FF6347',
  coral: 'FF7F50', khaki: 'F0E68C', plum: 'DDA0DD', orchid: 'DA70D6', slateblue: '6A5ACD',
  steelblue: '4682B4', skyblue: '87CEEB', lightblue: 'ADD8E6', darkblue: '00008B',
  darkgreen: '006400', darkred: '8B0000', darkgray: 'A9A9A9', darkgrey: 'A9A9A9',
  lightgray: 'D3D3D3', lightgrey: 'D3D3D3', midnightblue: '191970', rebeccapurple: '663399',
  dodgerblue: '1E90FF', forestgreen: '228B22', firebrick: 'B22222', hotpink: 'FF69B4',
  chocolate: 'D2691E', peru: 'CD853F', saddlebrown: '8B4513', sienna: 'A0522D',
  indianred: 'CD5C5C', rosybrown: 'BC8F8F', dimgray: '696969', dimgrey: '696969',
  lightslategray: '778899', lightslategrey: '778899', slategray: '708090', slategrey: '708090',
  darkslategray: '2F4F4F', darkslategrey: '2F4F4F', whitesmoke: 'F5F5F5', snow: 'FFFAFA',
  gainsboro: 'DCDCDC', lightcoral: 'F08080', palevioletred: 'DB7093', mediumvioletred: 'C71585',
  deeppink: 'FF1493', orangered: 'FF4500', darkorange: 'FF8C00', darkgoldenrod: 'B8860B',
  goldenrod: 'DAA520', darkkhaki: 'BDB76B', yellowgreen: '9ACD32', lawngreen: '7CFC00',
  chartreuse: '7FFF00', greenyellow: 'ADFF2F', springgreen: '00FF7F', mediumspringgreen: '00FA9A',
  aquamarine: '7FFFD4', mediumaquamarine: '66CDAA', lightseagreen: '20B2AA',
  cadetblue: '5F9EA0', darkturquoise: '00CED1', mediumturquoise: '48D1CC', powderblue: 'B0E0E6',
  lightcyan: 'E0FFFF', paleturquoise: 'AFEEEE', lightsteelblue: 'B0C4DE', cornflowerblue: '6495ED',
  royalblue: '4169E1', mediumblue: '0000CD', mediumslateblue: '7B68EE', blueviolet: '8A2BE2',
  darkviolet: '9400D3', darkorchid: '9932CC', mediumorchid: 'BA55D3', thistle: 'D8BFD8',
  lavender: 'E6E6FA', mistyrose: 'FFE4E1', antiquewhite: 'FAEBD7', linen: 'FAF0E6',
  oldlace: 'FDF5E6', floralwhite: 'FFFAF0', ivory: 'FFFFF0', beige: 'F5F5DC', wheat: 'F5DEB3',
  burlywood: 'DEB887', tan: 'D2B48C', moccasin: 'FFE4B5', navajowhite: 'FFDEAD',
  peachpuff: 'FFDAB9', bisque: 'FFE4C4', blanchedalmond: 'FFEBCD', cornsilk: 'FFF8DC',
  lemonchiffon: 'FFFACD', lightgoldenrodyellow: 'FAFAD2', palegoldenrod: 'EEE8AA',
  darkolivegreen: '556B2F', olivedrab: '6B8E23', seagreen: '2E8B57', mediumseagreen: '3CB371',
  lightgreen: '90EE90', darkseagreen: '8FBC8F', darkcyan: '008B8B',
  lightyellow: 'FFFFE0', honeydew: 'F0FFF0', mintcream: 'F5FFFA', azure: 'F0FFFF',
  aliceblue: 'F0F8FF', ghostwhite: 'F8F8FF', lavenderblush: 'FFF0F5', seashell: 'FFF5EE',
  mediumpurple: '9370DB', darkslateblue: '483D8B',
  // Remaining standard CSS keyword names (the DOM path resolves these in a
  // real browser; listed here so the local fallback stays complete).
  darkmagenta: '8B008B', darksalmon: 'E9967A', deepskyblue: '00BFFF',
  lightpink: 'FFB6C1', lightsalmon: 'FFA07A', lightskyblue: '87CEFA',
  limegreen: '32CD32', palegreen: '98FB98', papayawhip: 'FFEFD5', sandybrown: 'F4A460',
};
