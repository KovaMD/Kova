import { describe, it, expect } from 'vitest';
import { extractFrontmatter } from '../frontmatter';
import {
  applyThemeOverridePatch,
  cycleAspectRatio,
  setMetaField,
  switchTheme,
} from '../frontmatterEdits';

// The inspector's frontmatter edits (moved out of App.tsx in P4-12). Each takes
// the whole document and returns it with the frontmatter rewritten; the body
// is never touched.
const fm = (doc: string) => extractFrontmatter(doc).frontmatter;
const BODY = '# Slide\n\nText\n';

describe('switchTheme', () => {
  it('sets the theme and keeps layout-ish overrides, dropping colours', () => {
    const doc = [
      '---',
      'theme: light',
      'theme_overrides:',
      '  colors:',
      '    primary: "#123456"',
      '  fonts:',
      '    title: Inter',
      '  footer:',
      '    show: true',
      '    text: "{title}"',
      '  logo: null',
      '  logo_opacity: 0.5',
      '---',
      BODY,
    ].join('\n');
    const out = switchTheme(doc, 'dark');
    const f = fm(out);
    expect(f.theme).toBe('dark');
    const o = f.theme_overrides as Record<string, unknown>;
    expect(o.colors).toBeUndefined();
    expect(o.fonts).toEqual({ title: 'Inter' });
    expect(o.footer).toMatchObject({ show: true, text: '{title}' });
    expect('logo' in o).toBe(true);
    expect(o.logo).toBeNull();
    expect(o.logo_opacity).toBe(0.5);
    expect(out.endsWith(BODY)).toBe(true);
  });

  it('removes theme_overrides when nothing is worth keeping', () => {
    const doc = '---\ntheme: light\ntheme_overrides:\n  colors:\n    primary: "#123456"\n---\n' + BODY;
    const f = fm(switchTheme(doc, 'dark'));
    expect(f.theme).toBe('dark');
    expect(f.theme_overrides).toBeUndefined();
  });

  it('returns the same string when the theme is already selected and nothing changes', () => {
    const doc = '---\ntheme: dark\n---\n' + BODY;
    expect(switchTheme(doc, 'dark')).toBe(doc);
  });
});

describe('applyThemeOverridePatch', () => {
  const doc = '---\ntheme_overrides:\n  colors:\n    primary: "#111111"\n    accent: "#222222"\n---\n' + BODY;

  it('merges colours key by key', () => {
    const o = fm(applyThemeOverridePatch(doc, { colors: { accent: '#333333' } })).theme_overrides as Record<string, unknown>;
    expect(o.colors).toEqual({ primary: '#111111', accent: '#333333' });
  });

  it('clears a colour with undefined, and the colors block once empty', () => {
    const one = applyThemeOverridePatch(doc, { colors: { accent: undefined } });
    expect((fm(one).theme_overrides as Record<string, unknown>).colors).toEqual({ primary: '#111111' });
    const none = applyThemeOverridePatch(one, { colors: { primary: undefined } });
    expect(fm(none).theme_overrides).toBeUndefined();
  });

  it('treats any logo value but a non-empty path as "hide the logo" (null)', () => {
    const set = fm(applyThemeOverridePatch(BODY, { logo: 'img/logo.png' })).theme_overrides as Record<string, unknown>;
    expect(set.logo).toBe('img/logo.png');
    const hidden = fm(applyThemeOverridePatch(BODY, { logo: '' })).theme_overrides as Record<string, unknown>;
    expect(hidden.logo).toBeNull();
  });

  it('sets and removes plain keys', () => {
    const set = applyThemeOverridePatch(BODY, { logo_opacity: 0.4 });
    expect((fm(set).theme_overrides as Record<string, unknown>).logo_opacity).toBe(0.4);
    expect(fm(applyThemeOverridePatch(set, { logo_opacity: undefined })).theme_overrides).toBeUndefined();
  });
});

describe('setMetaField', () => {
  it('sets a trimmed value and removes the key when blank', () => {
    const set = setMetaField(BODY, 'author', '  Ada  ');
    expect(fm(set).author).toBe('Ada');
    expect(fm(setMetaField(set, 'author', '   ')).author).toBeUndefined();
  });
});

describe('cycleAspectRatio', () => {
  it('goes 16:9 (default, no key) -> 4:3 -> 16:10 -> back to no key', () => {
    const a = cycleAspectRatio(BODY);
    expect(fm(a).aspect_ratio).toBe('4:3');
    const b = cycleAspectRatio(a);
    expect(fm(b).aspect_ratio).toBe('16:10');
    const c = cycleAspectRatio(b);
    expect(fm(c).aspect_ratio).toBeUndefined();
  });
});
