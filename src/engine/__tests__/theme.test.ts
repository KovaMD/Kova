import { describe, it, expect } from 'vitest';
import {
  themeToVars,
  resolveTemplate,
  parseThemeYaml,
  hexToHsl,
  hslToHex,
  isLightHex,
  defaultChartPalette,
  sanitiseThemeOverrides,
  DEFAULT_THEME,
  BUILT_IN_THEMES,
  type Theme,
} from '../theme';

// ── themeToVars ───────────────────────────────────────────────────────────────

describe('themeToVars', () => {
  const vars = themeToVars(DEFAULT_THEME) as Record<string, string>;

  it('maps all seven color slots', () => {
    expect(vars['--sl-bg']).toBe(DEFAULT_THEME.colors.background);
    expect(vars['--sl-text']).toBe(DEFAULT_THEME.colors.text);
    expect(vars['--sl-primary']).toBe(DEFAULT_THEME.colors.primary);
    expect(vars['--sl-accent']).toBe(DEFAULT_THEME.colors.accent);
    expect(vars['--sl-code-bg']).toBe(DEFAULT_THEME.colors.code_bg);
    expect(vars['--sl-title-text']).toBe(DEFAULT_THEME.colors.title_text);
    expect(vars['--sl-section-bg']).toBe(DEFAULT_THEME.colors.section_bg);
  });

  it('maps all three font slots', () => {
    expect(vars['--sl-font-title']).toBe(DEFAULT_THEME.fonts.title);
    expect(vars['--sl-font-body']).toBe(DEFAULT_THEME.fonts.body);
    expect(vars['--sl-font-code']).toBe(DEFAULT_THEME.fonts.code);
  });

  it('maps heading alignment', () => {
    expect(vars['--sl-heading-ta']).toBe(DEFAULT_THEME.layout.heading_align);
  });

  it('maps title alignment variables', () => {
    // DEFAULT_THEME is 'center' — should produce center alignment vars
    expect(vars['--sl-title-ta']).toBe('center');
  });

  it('decoration:none produces no background pattern', () => {
    expect(vars['--sl-deco-img']).toBe('none');
  });

  it('decoration:dots produces a gradient value', () => {
    const cosmosTheme = BUILT_IN_THEMES.find((t) => t.id === 'cosmos')!;
    const cosmosVars = themeToVars(cosmosTheme) as Record<string, string>;
    expect(cosmosVars['--sl-deco-img']).toContain('radial-gradient');
  });

  it('decoration:grid produces repeating-linear-gradient', () => {
    const forgeTheme = BUILT_IN_THEMES.find((t) => t.id === 'forge')!;
    const forgeVars = themeToVars(forgeTheme) as Record<string, string>;
    expect(forgeVars['--sl-deco-img']).toContain('repeating-linear-gradient');
  });

  it('decoration:bar-left references --sl-accent', () => {
    const horizonTheme = BUILT_IN_THEMES.find((t) => t.id === 'horizon')!;
    const horizonVars = themeToVars(horizonTheme) as Record<string, string>;
    expect(horizonVars['--sl-deco-img']).toContain('var(--sl-accent)');
  });

  it('decoration:diagonal produces a 45deg repeating-linear-gradient', () => {
    const result = parseThemeYaml('diag', 'name: Diag\nlayout:\n  decoration: diagonal\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diagVars = themeToVars(result.theme) as Record<string, string>;
    expect(diagVars['--sl-deco-img']).toContain('repeating-linear-gradient(45deg');
    expect(diagVars['--sl-deco-size']).toBe('24px 24px');
  });

  it('bottom-left title align sets flex-end justify', () => {
    const pitchTheme = BUILT_IN_THEMES.find((t) => t.id === 'pitch')!;
    const pitchVars = themeToVars(pitchTheme) as Record<string, string>;
    expect(pitchVars['--sl-title-ay']).toBe('flex-end');
  });

  // ── Per-slide heading/bold colour (issue #146) ──────────────────────────────

  it('heading/bold fall back to the theme text colour when unset', () => {
    expect(vars['--sl-heading-text']).toBe(DEFAULT_THEME.colors.text);
    expect(vars['--sl-bold-text']).toBe(DEFAULT_THEME.colors.text);
  });

  it('theme.colors.heading/bold override the text-colour fallback', () => {
    const themed: Theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, heading: '#FF00FF', bold: '#00FFAA' } };
    const themedVars = themeToVars(themed) as Record<string, string>;
    expect(themedVars['--sl-heading-text']).toBe('#FF00FF');
    expect(themedVars['--sl-bold-text']).toBe('#00FFAA');
  });

  it('a per-slide textOverride wins over theme.colors.heading/bold', () => {
    const themed: Theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, heading: '#FF00FF', bold: '#00FFAA' } };
    const overridden = themeToVars(themed, '#123456') as Record<string, string>;
    expect(overridden['--sl-text']).toBe('#123456');
    expect(overridden['--sl-heading-text']).toBe('#123456');
    expect(overridden['--sl-bold-text']).toBe('#123456');
  });
});

// ── Colour utilities ──────────────────────────────────────────────────────────

describe('hexToHsl', () => {
  it('converts white to zero saturation and full lightness', () => {
    const [h, s, l] = hexToHsl('#FFFFFF');
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(1, 5);
  });

  it('converts black to zero lightness', () => {
    const [, s, l] = hexToHsl('#000000');
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  it('returns [0, 0, 0] for invalid hex strings', () => {
    expect(hexToHsl('not-a-color')).toEqual([0, 0, 0]);
    expect(hexToHsl('#ABC')).toEqual([0, 0, 0]);
  });
});

describe('hslToHex', () => {
  it('round-trips through hexToHsl for a saturated blue', () => {
    const original = '#2563EB';
    const [h, s, l] = hexToHsl(original);
    const roundTripped = hslToHex(h, s, l);
    expect(roundTripped.toLowerCase()).toBe(original.toLowerCase());
  });

  it('wraps hue values outside 0–360', () => {
    expect(hslToHex(450, 0.5, 0.5)).toBe(hslToHex(90, 0.5, 0.5));
  });
});

describe('isLightHex', () => {
  it('returns true for perceptually light colours', () => {
    expect(isLightHex('#FFFFFF')).toBe(true);
    expect(isLightHex('#F0F0F0')).toBe(true);
  });

  it('returns false for dark colours and invalid input', () => {
    expect(isLightHex('#111111')).toBe(false);
    expect(isLightHex('#2563EB')).toBe(false);
    expect(isLightHex('invalid')).toBe(false);
  });
});

describe('defaultChartPalette', () => {
  it('returns the requested number of hex colours', () => {
    expect(defaultChartPalette('#2563EB', 8)).toHaveLength(8);
    expect(defaultChartPalette('#2563EB', 4)).toHaveLength(4);
  });

  it('returns distinct colours anchored to the accent', () => {
    const palette = defaultChartPalette('#2563EB', 8);
    expect(new Set(palette).size).toBe(8);
    expect(palette.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
  });
});

describe('sanitiseThemeOverrides', () => {
  it('passes through valid color and font overrides', () => {
    const result = sanitiseThemeOverrides({
      colors: { primary: '#1B3A5C', accent: '#2563EB' },
      fonts: { body: 'Inter, sans-serif' },
    });
    expect(result.colors?.primary).toBe('#1B3A5C');
    expect(result.colors?.accent).toBe('#2563EB');
    expect(result.fonts?.body).toBe('Inter, sans-serif');
  });

  it('drops CSS injection attempts in color values', () => {
    const result = sanitiseThemeOverrides({
      colors: { primary: '#fff; background: red', accent: '#2563EB' },
    });
    expect(result.colors?.primary).toBeUndefined();
    expect(result.colors?.accent).toBe('#2563EB');
  });

  it('filters invalid entries from chart_colors', () => {
    const result = sanitiseThemeOverrides({
      colors: { chart_colors: ['#FF0000', 'bad;injection', '#00FF00'] },
    });
    expect(result.colors?.chart_colors).toEqual(['#FF0000', '#00FF00']);
  });

  it('sanitises header and footer fields', () => {
    const result = sanitiseThemeOverrides({
      footer: { show: true, text: 'Confidential', show_slide_number: true },
      header: { show: true, text: 'bad; css' },
    });
    expect(result.footer?.show).toBe(true);
    expect(result.footer?.text).toBe('Confidential');
    expect(result.footer?.show_slide_number).toBe(true);
    expect(result.header?.text).toBeUndefined();
  });

  it('preserves footer/header text containing template variables', () => {
    const result = sanitiseThemeOverrides({
      footer: { text: '{date} | {title} | {slide_number} / {total}' },
      header: { text: '{title}' },
    });
    expect(result.footer?.text).toBe('{date} | {title} | {slide_number} / {total}');
    expect(result.header?.text).toBe('{title}');
  });

  it('drops footer/header text containing semicolons', () => {
    const result = sanitiseThemeOverrides({
      footer: { text: 'bad; css' },
      header: { text: 'also; bad' },
    });
    expect(result.footer?.text).toBeUndefined();
    expect(result.header?.text).toBeUndefined();
  });

  it('clamps logo_opacity and accepts valid logo paths', () => {
    const result = sanitiseThemeOverrides({
      logo: '/Users/me/logo.png',
      logo_position: 'top-right',
      logo_opacity: 1.5,
    });
    expect(result.logo).toBe('/Users/me/logo.png');
    expect(result.logo_position).toBe('top-right');
    expect(result.logo_opacity).toBe(1);
  });

  it('rejects invalid logo URLs and positions', () => {
    const result = sanitiseThemeOverrides({
      logo: 'javascript:alert(1)',
      logo_position: 'center',
    });
    expect(result.logo).toBeUndefined();
    expect(result.logo_position).toBeUndefined();
  });

  it('passes through heading/bold color overrides (issue #146)', () => {
    const result = sanitiseThemeOverrides({
      colors: { heading: '#FF00FF', bold: 'rebeccapurple' },
    });
    expect(result.colors?.heading).toBe('#FF00FF');
    expect(result.colors?.bold).toBe('rebeccapurple');
  });

  it('drops CSS injection attempts in heading/bold color values', () => {
    const result = sanitiseThemeOverrides({
      colors: { heading: '#fff; background: red', bold: '#000{}' },
    });
    expect(result.colors?.heading).toBeUndefined();
    expect(result.colors?.bold).toBeUndefined();
  });
});

// ── resolveTemplate ───────────────────────────────────────────────────────────

describe('resolveTemplate', () => {
  it('replaces {title}', () => {
    expect(resolveTemplate('{title}', { title: 'My Talk' })).toBe('My Talk');
  });

  it('replaces {author}', () => {
    expect(resolveTemplate('{author}', { author: 'Jane Doe' })).toBe('Jane Doe');
  });

  it('replaces {date}', () => {
    expect(resolveTemplate('{date}', { date: '2026' })).toBe('2026');
  });

  it('replaces {slide_number}', () => {
    expect(resolveTemplate('Slide {slide_number}', { slideNumber: 3 })).toBe('Slide 3');
  });

  it('replaces {total}', () => {
    expect(resolveTemplate('{slide_number} of {total}', { slideNumber: 2, totalSlides: 10 })).toBe('2 of 10');
  });

  it('leaves unknown tokens unchanged', () => {
    expect(resolveTemplate('{unknown}', {})).toBe('{unknown}');
  });

  it('replaces all occurrences of a token', () => {
    expect(resolveTemplate('{title} — {title}', { title: 'X' })).toBe('X — X');
  });

  it('handles empty template', () => {
    expect(resolveTemplate('', { title: 'T' })).toBe('');
  });

  it('uses empty string when variable is undefined', () => {
    expect(resolveTemplate('{title}', {})).toBe('');
  });
});

// ── parseThemeYaml ────────────────────────────────────────────────────────────

describe('parseThemeYaml', () => {
  it('parses a minimal valid theme', () => {
    const yaml = `
name: My Theme
colors:
  primary: "#FF0000"
  background: "#FFFFFF"
`;
    const result = parseThemeYaml('my-theme', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.name).toBe('My Theme');
    expect(result.theme.colors.primary).toBe('#FF0000');
    expect(result.theme.colors.background).toBe('#FFFFFF');
  });

  it('inherits unspecified color values from the default theme', () => {
    const yaml = 'name: Partial\ncolors:\n  primary: "#123456"\n';
    const result = parseThemeYaml('partial', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.colors.text).toBe(DEFAULT_THEME.colors.text);
    expect(result.theme.colors.accent).toBe(DEFAULT_THEME.colors.accent);
  });

  it('inherits font values from the default theme when not specified', () => {
    const yaml = 'name: Partial\n';
    const result = parseThemeYaml('partial', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.fonts.body).toBe(DEFAULT_THEME.fonts.body);
  });

  it('accepts custom heading/bold colors (issue #146)', () => {
    const yaml = 'name: Headings\ncolors:\n  primary: "#123456"\n  heading: "#FF00FF"\n  bold: "#00FFAA"\n';
    const result = parseThemeYaml('headings', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.colors.heading).toBe('#FF00FF');
    expect(result.theme.colors.bold).toBe('#00FFAA');
  });

  it('leaves heading/bold undefined (falls back to text) when not specified', () => {
    const yaml = 'name: Partial\n';
    const result = parseThemeYaml('partial', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.colors.heading).toBeUndefined();
    expect(result.theme.colors.bold).toBeUndefined();
  });

  it('overrides header and footer settings', () => {
    const yaml = `
name: With Header
header:
  show: true
  text: "{title}"
footer:
  show: true
  show_slide_number: true
  text: "Slide {slide_number}"
`;
    const result = parseThemeYaml('header-test', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.header.show).toBe(true);
    expect(result.theme.header.text).toBe('{title}');
    expect(result.theme.footer.show_slide_number).toBe(true);
  });

  it('returns an error result for invalid YAML', () => {
    const result = parseThemeYaml('bad', ': invalid: yaml: {{{');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });

  it('uses the provided id as theme id', () => {
    const result = parseThemeYaml('my-custom-id', 'name: Whatever\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.id).toBe('my-custom-id');
  });

  it('parses layout decoration field', () => {
    const yaml = 'name: Dotted\nlayout:\n  decoration: dots\n  title_align: left\n';
    const result = parseThemeYaml('dots-theme', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.layout.decoration).toBe('dots');
    expect(result.theme.layout.title_align).toBe('left');
  });

  it('parses bundledFonts list', () => {
    const result = parseThemeYaml('fonts-theme', 'name: Fonts\nbundledFonts:\n  - Montserrat\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.bundledFonts).toEqual(['Montserrat']);
  });

  it('filters non-string entries out of bundledFonts', () => {
    const result = parseThemeYaml('fonts-theme', 'name: Fonts\nbundledFonts:\n  - Montserrat\n  - 42\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.bundledFonts).toEqual(['Montserrat']);
  });

  it('round-trips a chart_colors array through YAML parse', () => {
    const yaml = 'name: Chart\ncolors:\n  chart_colors:\n    - "#FF0000"\n    - "#00FF00"\n    - "#0000FF"\n';
    const result = parseThemeYaml('chart-theme', yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.colors.chart_colors).toEqual(['#FF0000', '#00FF00', '#0000FF']);
  });
});

// ── Built-in themes integrity ─────────────────────────────────────────────────

describe('built-in themes', () => {
  it('all built-in themes have unique ids', () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all built-in themes have required color keys', () => {
    const required = ['primary', 'accent', 'background', 'text', 'code_bg', 'title_text', 'section_bg'];
    for (const t of BUILT_IN_THEMES) {
      for (const key of required) {
        expect(t.colors[key as keyof typeof t.colors], `${t.id}.${key}`).toBeTruthy();
      }
    }
  });

  it('default theme is the first built-in theme', () => {
    expect(DEFAULT_THEME).toBe(BUILT_IN_THEMES[0]);
  });
});
