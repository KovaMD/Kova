import { describe, it, expect } from 'vitest';
import {
  themeToVars,
  resolveTemplate,
  parseThemeYaml,
  DEFAULT_THEME,
  BUILT_IN_THEMES,
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

  it('bottom-left title align sets flex-end justify', () => {
    const pitchTheme = BUILT_IN_THEMES.find((t) => t.id === 'pitch')!;
    const pitchVars = themeToVars(pitchTheme) as Record<string, string>;
    expect(pitchVars['--sl-title-ay']).toBe('flex-end');
  });
});

// ── resolveTemplate ───────────────────────────────────────────────────────────

describe('resolveTemplate', () => {
  it('replaces {title}', () => {
    expect(resolveTemplate('{title}', { title: 'My Talk' })).toBe('My Talk');
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
    const theme = parseThemeYaml('my-theme', yaml);
    expect(theme).not.toBeNull();
    expect(theme?.name).toBe('My Theme');
    expect(theme?.colors.primary).toBe('#FF0000');
    expect(theme?.colors.background).toBe('#FFFFFF');
  });

  it('inherits unspecified color values from the default theme', () => {
    const yaml = 'name: Partial\ncolors:\n  primary: "#123456"\n';
    const theme = parseThemeYaml('partial', yaml);
    expect(theme?.colors.text).toBe(DEFAULT_THEME.colors.text);
    expect(theme?.colors.accent).toBe(DEFAULT_THEME.colors.accent);
  });

  it('inherits font values from the default theme when not specified', () => {
    const yaml = 'name: Partial\n';
    const theme = parseThemeYaml('partial', yaml);
    expect(theme?.fonts.body).toBe(DEFAULT_THEME.fonts.body);
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
    const theme = parseThemeYaml('header-test', yaml);
    expect(theme?.header.show).toBe(true);
    expect(theme?.header.text).toBe('{title}');
    expect(theme?.footer.show_slide_number).toBe(true);
  });

  it('returns null for invalid YAML', () => {
    const theme = parseThemeYaml('bad', ': invalid: yaml: {{{');
    expect(theme).toBeNull();
  });

  it('uses the provided id as theme id', () => {
    const theme = parseThemeYaml('my-custom-id', 'name: Whatever\n');
    expect(theme?.id).toBe('my-custom-id');
  });

  it('parses layout decoration field', () => {
    const yaml = 'name: Dotted\nlayout:\n  decoration: dots\n  title_align: left\n';
    const theme = parseThemeYaml('dots-theme', yaml);
    expect(theme?.layout.decoration).toBe('dots');
    expect(theme?.layout.title_align).toBe('left');
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
