// Document edits made by the inspector: each takes the whole Markdown document
// and returns it with its YAML frontmatter rewritten (the body is untouched).
// Returning the same string means nothing changed, which callers use to
// decide whether the document is now dirty.
import { extractFrontmatter, patchFrontmatter } from './frontmatter';
import { sanitiseThemeOverrides, type ThemeOverridePatch } from '../theme';
import { nextAspectRatio } from '../types';

/**
 * Select a theme. User-configured values survive the switch: header, footer
 * and toc content, font choices (issue #281) and any logo the user chose.
 * Colour overrides are cleared, since they customised the old theme's palette.
 */
export function switchTheme(content: string, id: string): string {
  const cur = sanitiseThemeOverrides(
    extractFrontmatter(content).frontmatter.theme_overrides as Record<string, unknown> ?? {},
  );
  const kept: Record<string, unknown> = {};
  if (cur.fonts !== undefined) kept.fonts = cur.fonts;
  if (cur.header !== undefined) kept.header = cur.header;
  if (cur.footer !== undefined) kept.footer = cur.footer;
  if (cur.toc !== undefined) kept.toc = cur.toc;
  if ('logo' in cur) kept.logo = cur.logo ?? null;
  if (cur.logo_position !== undefined) kept.logo_position = cur.logo_position;
  if (cur.logo_opacity !== undefined) kept.logo_opacity = cur.logo_opacity;
  return patchFrontmatter(content, {
    theme: id,
    theme_overrides: Object.keys(kept).length > 0 ? kept : null,
  });
}

/**
 * Apply one inspector edit to `theme_overrides`. Colours and fonts merge key
 * by key (a single tweak never rewrites the whole palette); an `undefined`
 * value clears that key.
 */
export function applyThemeOverridePatch(content: string, patch: ThemeOverridePatch): string {
  const raw = extractFrontmatter(content).frontmatter.theme_overrides;
  const cur: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch) as [keyof ThemeOverridePatch, unknown][]) {
    if (key === 'colors' || key === 'fonts') {
      const base = cur[key] && typeof cur[key] === 'object' ? cur[key] as Record<string, unknown> : {};
      const next: Record<string, unknown> = { ...base, ...(value as Record<string, unknown>) };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      if (Object.keys(next).length > 0) cur[key] = next; else delete cur[key];
    } else if (key === 'logo') {
      // A `logo` key in the patch is always deliberate: a path sets it,
      // anything else clears it (`null` = "hide the base theme's logo too").
      cur.logo = typeof value === 'string' && value ? value : null;
    } else if (value === undefined) {
      delete cur[key];
    } else {
      cur[key] = value;
    }
  }
  return patchFrontmatter(content, {
    theme_overrides: Object.keys(cur).length > 0 ? cur : null,
  });
}

/** Set title, author or date; a blank value removes the key. */
export function setMetaField(content: string, field: 'title' | 'author' | 'date', value: string): string {
  return patchFrontmatter(content, { [field]: value.trim() || null });
}

/** Step aspect_ratio to the next value. 16:9 is the default, so it removes the key. */
export function cycleAspectRatio(content: string): string {
  const current = extractFrontmatter(content).frontmatter.aspect_ratio as string | undefined;
  const nextAr = nextAspectRatio(current);
  return patchFrontmatter(content, { aspect_ratio: nextAr === '16:9' ? null : nextAr });
}
