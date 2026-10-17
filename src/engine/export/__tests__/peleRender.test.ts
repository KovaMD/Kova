import { describe, it, expect } from 'vitest';
import { renderWithPele, peleVarsFromThemeVariables, PeleUnsupportedError } from '../peleRender';
import { buildExportMermaidInit } from '../mermaidExportTheme';
import { buildMermaidRenderSource } from '../mermaidSource';
import { DEFAULT_THEME } from '../../theme';

const rootStyle = (svg: string) => svg.match(/<svg\b[^>]*\bstyle="([^"]*)"/)?.[1] ?? '';

describe('renderWithPele', () => {
  it('bakes the Kova theme into the root style so the SVG is self-contained', () => {
    const src = buildMermaidRenderSource('flowchart LR\n  A --> B', buildExportMermaidInit(DEFAULT_THEME));
    const style = rootStyle(renderWithPele('t1', src).svg);
    expect(style).toContain(`--pele-bg:${DEFAULT_THEME.colors.background}`);
    expect(style).toContain(`--pele-line:${DEFAULT_THEME.colors.accent}`);
    expect(style).toContain('--pele-series-1:');
  });

  it("drops Pele's max-width so MermaidDiagram's sizing rewrite keeps the style", () => {
    const { svg } = renderWithPele('t2', 'pie\n  "a" : 1\n  "b" : 2');
    expect(rootStyle(svg)).not.toMatch(/max-width/);
    expect(rootStyle(svg)).toContain('--_bg:var(--pele-bg');
  });

  it("honours a diagram's own init pragma over the theme", () => {
    const src = buildMermaidRenderSource(
      '%%{init: {"themeVariables": {"lineColor": "#00FF00"}}}%%\nflowchart LR\n  A --> B',
      buildExportMermaidInit(DEFAULT_THEME),
    );
    expect(rootStyle(renderWithPele('t3', src).svg)).toContain('--pele-line:#00FF00');
  });

  it('reports syntax errors as normal errors, not as unsupported', () => {
    expect(() => renderWithPele('t4', 'flowchart LR\n  A -->')).toThrow();
    expect(() => renderWithPele('t4', 'flowchart LR\n  A -->')).not.toThrow(PeleUnsupportedError);
  });

  it('flags an unknown diagram type as unsupported so callers can fall back', () => {
    expect(() => renderWithPele('t5', 'notADiagram\n  x')).toThrow(PeleUnsupportedError);
  });
});

describe('peleVarsFromThemeVariables', () => {
  it('tints the node surface toward the primary rather than using it raw', () => {
    const vars = peleVarsFromThemeVariables({ background: '#ffffff', primaryColor: '#000000', labelTextColor: '#111111' });
    expect(vars['--pele-surface']).toBe('#c7c7c7');
    expect(vars['--pele-accent']).toBe('#000000');
  });

  it('keeps a light cluster fill but replaces one the text cannot be read on', () => {
    const base = { background: '#ffffff', primaryColor: '#1e3a5f', labelTextColor: '#111111' };
    expect(peleVarsFromThemeVariables({ ...base, clusterBkg: '#eeeeee' })['--pele-surface-alt']).toBe('#eeeeee');
    expect(peleVarsFromThemeVariables({ ...base, clusterBkg: '#1e1e2e' })['--pele-surface-alt']).not.toBe('#1e1e2e');
  });

  it('swaps an accent that disappears into a dark background for the line colour', () => {
    const dark = { background: '#1F2937', primaryColor: '#111827', lineColor: '#C07A30', labelTextColor: '#F3F4F6' };
    expect(peleVarsFromThemeVariables(dark)['--pele-accent']).toBe('#C07A30');
  });

  it('skips blending for non-hex colours instead of producing garbage', () => {
    const vars = peleVarsFromThemeVariables({ background: 'white', primaryColor: 'teal' });
    expect(vars['--pele-surface']).toBe('teal');
    expect(vars['--pele-muted']).toBeUndefined();
  });

  it("passes the theme font to Pele, escaped inside the style attribute", () => {
    const { svg } = renderWithPele('t6', '%%{init: {"fontFamily": "IBM Plex Sans"}}%%\nflowchart LR\n  A --> B');
    expect(rootStyle(svg)).toContain('var(--pele-font,&quot;IBM Plex Sans&quot;, sans-serif)');
  });
});
