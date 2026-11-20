import { describe, it, expect } from 'vitest';
import {
  calloutBodySpec, calloutTitleSpec, calloutTypeColor, calloutVars, mixHex,
  parseCalloutTextSpec, sanitiseCalloutColors,
} from '../calloutColors';
import { parseThemeYaml, sanitiseThemeOverrides, themeToVars, DEFAULT_THEME } from '../theme';

describe('parseCalloutTextSpec (issue #283)', () => {
  it('reads "callout" as the full callout colour', () => {
    expect(parseCalloutTextSpec('callout')).toEqual({ mix: 100 });
    expect(parseCalloutTextSpec('  Callout ')).toEqual({ mix: 100 });
  });

  it('reads "callout NN%" as a mix with the text colour', () => {
    expect(parseCalloutTextSpec('callout 70%')).toEqual({ mix: 70 });
    expect(parseCalloutTextSpec('callout 12.5 %')).toEqual({ mix: 12.5 });
  });

  it('clamps an out-of-range percentage', () => {
    expect(parseCalloutTextSpec('callout 150%')).toEqual({ mix: 100 });
  });

  it('treats anything else as a plain colour', () => {
    expect(parseCalloutTextSpec('#333333')).toEqual({ mix: 0, base: '#333333' });
    expect(parseCalloutTextSpec('red')).toEqual({ mix: 0, base: 'red' });
  });

  it('returns undefined for a missing or empty value', () => {
    expect(parseCalloutTextSpec(undefined)).toBeUndefined();
    expect(parseCalloutTextSpec('  ')).toBeUndefined();
  });

  it('defaults title to the callout colour and body to the text colour', () => {
    expect(calloutTitleSpec(undefined)).toEqual({ mix: 100 });
    expect(calloutBodySpec(undefined)).toEqual({ mix: 0 });
    expect(calloutBodySpec({ body_text: 'callout 70%' })).toEqual({ mix: 70 });
  });
});

describe('calloutTypeColor', () => {
  it('uses the built-in default unless the theme sets one', () => {
    expect(calloutTypeColor(undefined, 'warning')).toBe('#FF9100');
    expect(calloutTypeColor({ warning: '#e11d48' }, 'warning')).toBe('#e11d48');
    expect(calloutTypeColor({ warning: '#e11d48' }, 'tip')).toBe('#00C853');
  });

  it('falls back to note for an unknown type', () => {
    expect(calloutTypeColor(undefined, 'bogus')).toBe('#448AFF');
    expect(calloutTypeColor({ note: '#000000' }, undefined)).toBe('#000000');
  });
});

describe('mixHex', () => {
  it('mixes in sRGB like CSS color-mix', () => {
    expect(mixHex('FF9100', '1A1A1A', 70)).toBe('BA6D08');
    expect(mixHex('FF9100', '1A1A1A', 100)).toBe('FF9100');
    expect(mixHex('ff9100', '1a1a1a', 0)).toBe('1A1A1A');
  });
});

describe('sanitiseCalloutColors', () => {
  it('merges onto the base and drops injection attempts and unknown keys', () => {
    const out = sanitiseCalloutColors(
      { warning: '#e11d48', danger: '#fff; background: red', body_text: 'callout 70%', bogus: '#000', info: 42 },
      { note: '#111111', title_text: 'callout' },
    );
    expect(out).toEqual({ note: '#111111', title_text: 'callout', warning: '#e11d48', body_text: 'callout 70%' });
  });

  it('returns undefined when nothing is set', () => {
    expect(sanitiseCalloutColors(undefined, undefined)).toBeUndefined();
    expect(sanitiseCalloutColors('nope', undefined)).toBeUndefined();
  });
});

describe('calloutVars / themeToVars', () => {
  it('emits nothing for a theme without callout_colors', () => {
    expect(calloutVars(undefined)).toEqual({});
    const vars = themeToVars(DEFAULT_THEME) as Record<string, string>;
    expect(Object.keys(vars).some((k) => k.startsWith('--sl-callout'))).toBe(false);
  });

  it('emits per-type colours and title/body mix variables', () => {
    expect(calloutVars({ warning: '#e11d48', title_text: 'callout', body_text: 'callout 70%' })).toEqual({
      '--sl-callout-warning': '#e11d48',
      '--sl-callout-title-mix': '100%',
      '--sl-callout-body-mix': '70%',
    });
    expect(calloutVars({ body_text: '#333333' })).toEqual({
      '--sl-callout-body-mix': '0%',
      '--sl-callout-body-base': '#333333',
    });
  });
});

describe('callout_colors in themes and frontmatter', () => {
  it('accepts a callout_colors block in a theme file', () => {
    const yaml = 'name: Callouts\ncolors:\n  callout_colors:\n    warning: "#ff9100"\n    title_text: callout\n    body_text: callout 70%\n';
    const result = parseThemeYaml('callouts', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.colors.callout_colors).toEqual({ warning: '#ff9100', title_text: 'callout', body_text: 'callout 70%' });
  });

  it('inherits callout_colors from an extended theme and overrides per key', () => {
    const parent = 'name: Parent\ncolors:\n  callout_colors:\n    note: "#111111"\n    body_text: callout\n';
    const child = 'name: Child\nextends: parent\ncolors:\n  callout_colors:\n    body_text: callout 50%\n';
    const result = parseThemeYaml('child', child, undefined, undefined, { entries: [['parent', parent], ['child', child]] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.colors.callout_colors).toEqual({ note: '#111111', body_text: 'callout 50%' });
  });

  it('passes callout_colors through frontmatter theme_overrides', () => {
    const result = sanitiseThemeOverrides({
      colors: { callout_colors: { warning: '#e11d48', title_text: 'callout', body_text: 'callout 70%', danger: '#f00}' } },
    });
    expect(result.colors?.callout_colors).toEqual({ warning: '#e11d48', title_text: 'callout', body_text: 'callout 70%' });
  });
});
