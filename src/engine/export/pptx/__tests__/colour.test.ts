// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { cssColorToHex, hex, resolveCssColorToHex } from '../colour';

// CSS colour parsing for the PPTX export. PptxGenJS only accepts 6-digit hex,
// so every theme / per-slide colour goes through these helpers before it
// reaches a layout renderer.

describe('hex', () => {
  it('strips the leading # and upper-cases', () => {
    expect(hex('#1a1a1a')).toBe('1A1A1A');
    expect(hex('ff0000')).toBe('FF0000');
  });

  it('expands 3-digit shorthand', () => {
    expect(hex('#abc')).toBe('AABBCC');
  });
});

describe('resolveCssColorToHex', () => {
  it('resolves hex values', () => {
    expect(resolveCssColorToHex('#ff0000')).toBe('FF0000');
    expect(resolveCssColorToHex('#f00')).toBe('FF0000');
  });

  it('resolves a named colour (regression: was silently black)', () => {
    expect(resolveCssColorToHex('red')).toBe('FF0000');
  });

  it('resolves a functional rgb() colour', () => {
    expect(resolveCssColorToHex('rgb(0, 128, 0)')).toBe('008000');
  });

  it('resolves hsl() via the DOM (regression: was silently black)', () => {
    expect(resolveCssColorToHex('hsl(0, 0%, 100%)')).toBe('FFFFFF');
    expect(resolveCssColorToHex('hsl(120, 100%, 25%)')).toBe('008000');
  });

  it('resolves darkmagenta (once missing from the fallback table)', () => {
    expect(resolveCssColorToHex('darkmagenta')).toBe('8B008B');
  });

  it('returns the fallback for empty input', () => {
    expect(resolveCssColorToHex('')).toBe('000000');
    expect(resolveCssColorToHex('', '#fff')).toBe('FFFFFF');
  });

  describe('without a DOM (local fallback converter)', () => {
    it('handles hex, #rrggbbaa, rgb(), color() and named colours', () => {
      vi.stubGlobal('document', undefined);
      try {
        expect(resolveCssColorToHex('#abc')).toBe('AABBCC');
        expect(resolveCssColorToHex('#11223344')).toBe('112233');
        expect(resolveCssColorToHex('rgb(0, 128, 0)')).toBe('008000');
        expect(resolveCssColorToHex('rgb(100%, 0%, 0%)')).toBe('FF0000');
        expect(resolveCssColorToHex('color(255 0 0)')).toBe('FF0000');
        expect(resolveCssColorToHex('darkmagenta')).toBe('8B008B');
        // hsl() is deliberately not converted locally: falls back safely.
        expect(resolveCssColorToHex('hsl(0, 100%, 50%)')).toBe('000000');
        expect(resolveCssColorToHex('notacolour', 'abcdef')).toBe('ABCDEF');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

describe('cssColorToHex caching', () => {
  it('resolves each distinct colour via getComputedStyle only once', () => {
    const spy = vi.spyOn(window, 'getComputedStyle');
    // Colour strings unique to this test so the module-scope cache is cold.
    for (let i = 0; i < 12; i++) {
      expect(cssColorToHex('rgb(1, 2, 3)')).toBe('010203');
      expect(cssColorToHex('rgb(4, 5, 6)')).toBe('040506');
    }
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('keys the cache on the fallback too', () => {
    expect(cssColorToHex('', '111111')).toBe('111111');
    expect(cssColorToHex('', '222222')).toBe('222222');
  });
});
