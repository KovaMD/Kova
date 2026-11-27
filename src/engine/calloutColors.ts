/**
 * Callout/admonition colours (issue #283).
 *
 * Each canonical callout style (see resolveCalloutStyle in the parser) has a
 * fixed default colour, which a theme or a document's `theme_overrides` can
 * replace per type under `colors.callout_colors`. The same block also controls
 * how a callout's title and body text are coloured:
 *
 *   title_text: callout        # the callout's own colour (default)
 *   body_text:  callout 70%    # 70% callout colour, 30% slide text colour
 *   body_text:  "#333333"      # any plain colour
 *
 * Mixing happens in sRGB, matching CSS `color-mix(in srgb, ...)` so the
 * preview and the PPTX export agree.
 */

export const CALLOUT_TYPES = ['note', 'info', 'tip', 'warning', 'danger'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export const DEFAULT_CALLOUT_COLORS: Record<CalloutType, string> = {
  note: '#448AFF',
  info: '#00B8D4',
  tip: '#00C853',
  warning: '#FF9100',
  danger: '#FF5252',
};

export interface CalloutColors {
  note?: string;
  info?: string;
  tip?: string;
  warning?: string;
  danger?: string;
  /** Title colour: a colour, `callout`, or `callout NN%`. Default: `callout`. */
  title_text?: string;
  /** Body colour: a colour, `callout`, or `callout NN%`. Default: slide text. */
  body_text?: string;
}

const CALLOUT_COLOR_KEYS: Array<keyof CalloutColors> = [...CALLOUT_TYPES, 'title_text', 'body_text'];

/**
 * How a callout's title or body text is coloured: `mix` percent of the
 * callout's own colour, the rest from `base` (the slide's text colour when
 * unset). A plain colour is `{ mix: 0, base: colour }`.
 */
export interface CalloutTextSpec {
  mix: number;
  base?: string;
}

const CALLOUT_REF_RE = /^callout(?:\s+(\d+(?:\.\d+)?)\s*%)?$/i;

/** Parses a `title_text`/`body_text` value; `undefined` for a missing value. */
export function parseCalloutTextSpec(value: string | undefined): CalloutTextSpec | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  const m = CALLOUT_REF_RE.exec(v);
  if (m) return { mix: m[1] === undefined ? 100 : Math.min(100, Math.max(0, Number(m[1]))) };
  return { mix: 0, base: v };
}

const TITLE_DEFAULT: CalloutTextSpec = { mix: 100 };
const BODY_DEFAULT: CalloutTextSpec = { mix: 0 };

export function calloutTitleSpec(c: CalloutColors | undefined): CalloutTextSpec {
  return parseCalloutTextSpec(c?.title_text) ?? TITLE_DEFAULT;
}

export function calloutBodySpec(c: CalloutColors | undefined): CalloutTextSpec {
  return parseCalloutTextSpec(c?.body_text) ?? BODY_DEFAULT;
}

/** The colour of one callout style, falling back to its built-in default
 *  (and an unknown style to `note`'s). */
export function calloutTypeColor(c: CalloutColors | undefined, type: string | undefined): string {
  const t = (CALLOUT_TYPES as readonly string[]).includes(type ?? '') ? (type as CalloutType) : 'note';
  return c?.[t] ?? DEFAULT_CALLOUT_COLORS[t];
}

/**
 * Merges a raw `callout_colors` object onto the base theme's, validating each
 * field individually — the same CSS-injection check as every other colour.
 */
export function sanitiseCalloutColors(raw: unknown, base: CalloutColors | undefined): CalloutColors | undefined {
  const merged: CalloutColors = { ...base };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    for (const key of CALLOUT_COLOR_KEYS) {
      const v = r[key];
      if (typeof v === 'string' && v.trim() && !/[;{}]/.test(v.trim())) merged[key] = v.trim();
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * CSS custom properties for the preview (consumed by `.sl-callout` rules in
 * SlideRenderer.css). Only what the theme sets is emitted, so an unstyled
 * theme renders exactly as before. The colour itself is resolved per callout
 * by CSS, since a custom property referencing another is substituted where
 * it's declared (the slide root), not where it's used.
 */
export function calloutVars(c: CalloutColors | undefined): Record<string, string> {
  if (!c) return {};
  const vars: Record<string, string> = {};
  for (const t of CALLOUT_TYPES) if (c[t]) vars[`--sl-callout-${t}`] = c[t]!;
  const title = parseCalloutTextSpec(c.title_text);
  if (title) {
    vars['--sl-callout-title-mix'] = `${title.mix}%`;
    if (title.base) vars['--sl-callout-title-base'] = title.base;
  }
  const body = parseCalloutTextSpec(c.body_text);
  if (body) {
    vars['--sl-callout-body-mix'] = `${body.mix}%`;
    if (body.base) vars['--sl-callout-body-base'] = body.base;
  }
  return vars;
}

/** Mixes two 6-digit hex colours (no `#`) in sRGB: `pct`% of `a`, the rest `b`. */
export function mixHex(a: string, b: string, pct: number): string {
  const p = Math.min(100, Math.max(0, pct)) / 100;
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  let out = '';
  for (const i of [0, 2, 4]) {
    const v = Math.round(ch(a, i) * p + ch(b, i) * (1 - p));
    out += v.toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}
