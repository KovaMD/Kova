import { describe, it, expect } from 'vitest';
import { parseChannels, buildExportMermaidInit } from '../export/mermaidExportTheme';
import { DEFAULT_THEME } from '../theme';

describe('parseChannels', () => {
  it('parses a 6-character hex string into RGB components', () => {
    expect(parseChannels('FF8040')).toEqual([255, 128, 64]);
    expect(parseChannels('000000')).toEqual([0, 0, 0]);
  });
});

describe('buildExportMermaidInit', () => {
  it('emits a mermaid init pragma with base theme variables from the slide theme', () => {
    const init = buildExportMermaidInit(DEFAULT_THEME);
    expect(init).toMatch(/^%%\{init: /);
    expect(init).toContain('"theme":"base"');
    expect(init).toContain(DEFAULT_THEME.colors.primary);
    expect(init).toContain(DEFAULT_THEME.colors.background);
    expect(init).toContain('"fontFamily"');
    expect(init).toContain('"xyChart"');
  });

  // Regression test: this function used to omit the top-level fontFamily key
  // (only setting it inside themeVariables), a drift from the live preview's
  // copy of this same builder that could make exported diagrams render in a
  // different font than what the user saw in the app. Parses the JSON out of
  // the pragma and asserts on the object directly — a substring match like
  // the assertion above would pass either way, since themeVariables.fontFamily
  // always contained the string "fontFamily" regardless of the top-level key.
  it('sets fontFamily on the top-level config object, not just themeVariables', () => {
    const init = buildExportMermaidInit(DEFAULT_THEME);
    const jsonStr = init.replace(/^%%\{init:\s*/, '').replace(/\}%%\n?$/, '');
    const config = JSON.parse(jsonStr) as { fontFamily?: string; themeVariables?: { fontFamily?: string } };
    expect(config.fontFamily).toBeTruthy();
    expect(config.themeVariables?.fontFamily).toBe(config.fontFamily);
  });

  it('uses chart_colors from the theme when provided', () => {
    const theme = {
      ...DEFAULT_THEME,
      colors: {
        ...DEFAULT_THEME.colors,
        chart_colors: ['#111111', '#222222', '#333333'],
      },
    };
    const init = buildExportMermaidInit(theme);
    expect(init).toContain('#111111');
    expect(init).toContain('#222222');
    expect(init).toContain('#333333');
  });

  // Issue #245 — flowchart/sequence colours can be set directly via
  // diagram_colors instead of always deriving from primary/accent/code_bg/text.
  describe('diagram_colors', () => {
    function withDiagramColors(diagram_colors: Record<string, string>) {
      return {
        ...DEFAULT_THEME,
        colors: { ...DEFAULT_THEME.colors, diagram_colors },
      };
    }

    it('uses diagram_colors.primary for primaryColor and mainBkg', () => {
      const config = parseInit(buildExportMermaidInit(withDiagramColors({ primary: '#123456' })));
      expect(config.themeVariables.primaryColor).toBe('#123456');
      expect(config.themeVariables.mainBkg).toBe('#123456');
    });

    it('uses diagram_colors.line for lineColor without touching the theme accent', () => {
      const config = parseInit(buildExportMermaidInit(withDiagramColors({ line: '#00FF00' })));
      expect(config.themeVariables.lineColor).toBe('#00FF00');
    });

    it('uses diagram_colors.cluster for clusterBkg', () => {
      const config = parseInit(buildExportMermaidInit(withDiagramColors({ cluster: '#ABCDEF' })));
      expect(config.themeVariables.clusterBkg).toBe('#ABCDEF');
    });

    it('uses diagram_colors.text for titleColor/labelTextColor/signalColor but not pieSectionTextColor', () => {
      const config = parseInit(buildExportMermaidInit(withDiagramColors({ text: '#FEDCBA' })));
      expect(config.themeVariables.titleColor).toBe('#FEDCBA');
      expect(config.themeVariables.labelTextColor).toBe('#FEDCBA');
      expect(config.themeVariables.signalColor).toBe('#FEDCBA');
      // pieSectionTextColor must stay tied to title_text for contrast on
      // coloured pie slices — diagram_colors.text must not leak into it.
      expect(config.themeVariables.pieSectionTextColor).toBe(DEFAULT_THEME.colors.title_text);
    });

    it('border defaults to the overridden primary when border itself is unset', () => {
      const config = parseInit(buildExportMermaidInit(withDiagramColors({ primary: '#123456' })));
      expect(config.themeVariables.primaryBorderColor).toBe('#123456');
      expect(config.themeVariables.nodeBorder).toBe('#123456');
    });

    it('an explicit border overrides the primary-derived default', () => {
      const config = parseInit(buildExportMermaidInit(withDiagramColors({ primary: '#123456', border: '#654321' })));
      expect(config.themeVariables.primaryBorderColor).toBe('#654321');
      expect(config.themeVariables.nodeBorder).toBe('#654321');
    });

    it('falls back to the theme-derived values when diagram_colors is unset', () => {
      const config = parseInit(buildExportMermaidInit(DEFAULT_THEME));
      expect(config.themeVariables.primaryColor).toBe(DEFAULT_THEME.colors.primary);
      expect(config.themeVariables.lineColor).toBe(DEFAULT_THEME.colors.accent);
    });
  });
});

function parseInit(init: string): { themeVariables: Record<string, string> } {
  const jsonStr = init.replace(/^%%\{init:\s*/, '').replace(/\}%%\n?$/, '');
  return JSON.parse(jsonStr) as { themeVariables: Record<string, string> };
}
