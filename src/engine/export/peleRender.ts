import { render, PeleError } from 'pele';
import { parseChannels } from './mermaidExportTheme';

/**
 * Pele (github.com/obsidianmd/pele) renders Mermaid source to SVG
 * synchronously, with no global state, so it needs none of the queueing,
 * render-host or id re-scoping workarounds mermaid.render() does.
 *
 * Kova's theme reaches Mermaid as an `%%{init}%%` pragma (buildExportMermaidInit),
 * and that pragma is also part of every render cache key. Rather than thread a
 * second theme channel through every call site, the Pele path reads the same
 * pragma back and maps its themeVariables onto Pele's `--pele-*` CSS variables.
 * A user-written pragma maps the same way, so a diagram's own themeVariables
 * still win.
 */

const INIT_PRAGMA_RE = /^\s*%%\{init:\s*(\{[\s\S]*?\})\s*\}%%/;

type InitConfig = { fontFamily?: string; themeVariables?: Record<string, unknown> };

function readInitPragma(src: string): InitConfig {
  const json = src.match(INIT_PRAGMA_RE)?.[1];
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as InitConfig : {};
  } catch {
    return {};
  }
}

const isHex6 = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Blend `a` toward `b` by `t` (0 = all a, 1 = all b). Pele draws node fills
// behind its single foreground colour, so a saturated theme primary can't be
// used as the fill directly the way Mermaid's primaryColor is.
function mix(a: string, b: string, t: number): string {
  const ca = parseChannels(a.slice(1));
  const cb = parseChannels(b.slice(1));
  return '#' + ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string): number {
  const [r, g, b] = parseChannels(hex.slice(1)).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Maps Mermaid themeVariables onto Pele's CSS custom properties. */
export function peleVarsFromThemeVariables(tv: Record<string, unknown>): Record<string, string> {
  const str = (k: string) => (typeof tv[k] === 'string' ? tv[k] as string : undefined);
  const bg = str('background');
  const fg = str('labelTextColor') ?? str('titleColor') ?? str('signalColor');
  const primary = str('primaryColor') ?? str('mainBkg');
  const out: Record<string, string> = {};
  const put = (name: string, v: string | undefined) => { if (v) out[`--pele-${name}`] = v; };

  put('bg', bg);
  put('fg', fg);
  put('muted', isHex6(fg) && isHex6(bg) ? mix(fg, bg, 0.4) : undefined);
  put('line', str('lineColor'));
  put('surface', isHex6(primary) && isHex6(bg) ? mix(bg, primary, 0.22) : primary);
  // Pele draws its one foreground colour on top of surface-alt (notes, Gantt
  // done bars, journey sections), unlike Mermaid, which pairs each
  // fill with its own contrasting text. clusterBkg defaults to the theme's
  // code_bg, dark in most themes, so a fill too dark for the text drops back
  // to a tint of the primary.
  const readable = (fill: string | undefined, fallback: string | undefined) =>
    fill && isHex6(fill) && isHex6(fg) && contrast(fill, fg) < 4.5 ? fallback : fill;
  const tint = (t: number) => (isHex6(primary) && isHex6(bg) ? mix(bg, primary, t) : undefined);
  put('surface-alt', readable(str('clusterBkg') ?? str('tertiaryColor'), tint(0.35)));
  put('border', str('primaryBorderColor') ?? str('nodeBorder'));
  // Text on the accent is drawn in the background colour (Gantt task bars),
  // so it must stand out from the background instead. Dark themes often have
  // a primary close to the background; their line accent is the next choice.
  const line = str('lineColor');
  const vsBg = (c: string | undefined) => (c && isHex6(c) && isHex6(bg) ? contrast(c, bg) : 0);
  put('accent', vsBg(primary) >= 3 || vsBg(line) <= vsBg(primary) ? primary : line);
  for (let i = 1; i <= 8; i++) put(`series-${i}`, str(`pie${i}`) ?? str(`cScale${i - 1}`));
  return out;
}

/**
 * Bakes the theme into the SVG's own root style so it is self-contained:
 * Pele's output reads its colours as `var(--pele-*, default)` on the root
 * element, and an SVG rasterised through an <img> (svgToPng) or cloned into
 * an export has no surrounding page to inherit those variables from. Also
 * drops Pele's `max-width:100%;height:auto`, which MermaidDiagram's sizing
 * rewrite would otherwise strip along with the whole style attribute.
 */
function bakeVars(svg: string, vars: Record<string, string>): string {
  const decl = Object.entries(vars).map(([k, v]) => `${k}:${v.replace(/[";<>]/g, '')};`).join('');
  return svg.replace(/<svg\b([^>]*?)\bstyle="([^"]*)"/i, (_m, pre: string, style: string) =>
    `<svg${pre}style="${decl}${style.replace(/max-width:100%;height:auto;?/, '')}"`);
}

export class PeleUnsupportedError extends Error {}

export function renderWithPele(id: string, src: string): { svg: string } {
  const init = readInitPragma(src);
  const tv = init.themeVariables ?? {};
  const fontFamily = init.fontFamily ?? (typeof tv.fontFamily === 'string' ? tv.fontFamily : undefined);
  try {
    // Pele measures labels with this font and writes it as the fallback for
    // --pele-font, so it also carries into exports.
    const { svg } = render(src, { idPrefix: id, fontFamily: fontFamily ? `"${fontFamily}", sans-serif` : undefined });
    return { svg: bakeVars(svg, peleVarsFromThemeVariables(tv)) };
  } catch (err) {
    if (err instanceof PeleError && err.code === 'unsupported-diagram') throw new PeleUnsupportedError(err.message);
    throw err;
  }
}
