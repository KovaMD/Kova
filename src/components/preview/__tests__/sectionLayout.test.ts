import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { themeToVars, BUILT_IN_THEMES } from '../../../engine/theme';

// Regression guard for issue #244: a section divider must render in the theme's
// own `colors.section_bg`, not the brand primary. The plumbing (themeToVars
// emits --sl-section-bg, PPTX export paints section_bg) has always been there;
// what broke was the preview stylesheet, which quietly swapped .sl-section over
// to var(--sl-primary). These tests pin both halves so a silent revert fails.

const css = readFileSync('src/components/preview/SlideRenderer.css', 'utf8');

/** The body of the first `<selector> { ... }` rule whose selector matches. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no rule for "${selector}"`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('section layout background', () => {
  it('.sl-section paints --sl-section-bg, not the brand primary', () => {
    const body = ruleBody('.sl-section');
    expect(body).toMatch(/background-color:\s*var\(--sl-section-bg/);
    expect(body).not.toMatch(/background-color:\s*var\(--sl-primary\)/);
  });

  it('--sl-section-bg has a stylesheet fallback of its own', () => {
    expect(css).toMatch(/--sl-section-bg:\s*#[0-9a-fA-F]{3,8};/);
  });

  it('themeToVars surfaces each built-in theme\'s section_bg as --sl-section-bg', () => {
    for (const theme of BUILT_IN_THEMES) {
      const vars = themeToVars(theme) as Record<string, string>;
      expect(vars['--sl-section-bg']).toBe(theme.colors.section_bg);
    }
  });

  it('some built-in themes give the divider its own colour, so the swap is observable', () => {
    const distinct = BUILT_IN_THEMES.filter((t) => t.colors.section_bg !== t.colors.primary);
    expect(distinct.length).toBeGreaterThan(0);
  });
});
