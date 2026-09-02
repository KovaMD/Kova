import { describe, it, expect } from 'vitest';
import {
  parseProgressDirective,
  looksLikeProgressDirective,
  progressBarInnerHtml,
  clampPercent,
} from '../progressBar';

describe('parseProgressDirective', () => {
  it('parses a literal percentage', () => {
    expect(parseProgressDirective('!progress[Done](75)')).toEqual({ label: 'Done', value: 75 });
    expect(parseProgressDirective('!progress[Done](7.5)')).toEqual({ label: 'Done', value: 7.5 });
  });

  it('parses a sheet formula, stripping the leading =', () => {
    expect(parseProgressDirective('!progress[Total](=sum(total))'))
      .toEqual({ label: 'Total', formula: 'sum(total)' });
    // greedy inner: the formula keeps its own parentheses
    expect(parseProgressDirective('!progress[T](=sum(x) * (1 + vat))'))
      .toEqual({ label: 'T', formula: 'sum(x) * (1 + vat)' });
  });

  it('tolerates whitespace between ( and =', () => {
    expect(parseProgressDirective('!progress[T]( =a+b)')).toEqual({ label: 'T', formula: 'a+b' });
  });

  it('allows an empty label', () => {
    expect(parseProgressDirective('!progress[](40)')).toEqual({ label: '', value: 40 });
  });

  it('trims surrounding whitespace', () => {
    expect(parseProgressDirective('  !progress[A](10)  ')).toEqual({ label: 'A', value: 10 });
  });

  it('rejects non-directives and malformed payloads', () => {
    expect(parseProgressDirective('just text')).toBeNull();
    expect(parseProgressDirective('!progress[A]()')).toBeNull();      // empty payload
    expect(parseProgressDirective('!progress[A](abc)')).toBeNull();   // neither number nor formula
    expect(parseProgressDirective('!progress[A](75) trailing')).toBeNull();
    expect(parseProgressDirective('!progress[A]( 75 )')).toBeNull();  // padded number, as before
  });
});

describe('looksLikeProgressDirective', () => {
  it('is true for any !progress[…](…) shape, well-formed or not', () => {
    expect(looksLikeProgressDirective('!progress[A](75)')).toBe(true);
    expect(looksLikeProgressDirective('!progress[A](=x)')).toBe(true);
    expect(looksLikeProgressDirective('!progress[A](abc)')).toBe(true);
  });

  it('is false for a plain footer label or empty payload', () => {
    expect(looksLikeProgressDirective('!Total')).toBe(false);
    expect(looksLikeProgressDirective('!progress[A]()')).toBe(false);
  });
});

describe('progressBarInnerHtml', () => {
  it('clamps the percentage and escapes the label', () => {
    const html = progressBarInnerHtml('A & B', 150);
    expect(html).toContain('A &amp; B');
    expect(html).toContain('width: 100%');
    expect(html).toContain('>100%<');
  });

  it('keeps a fractional percentage', () => {
    expect(progressBarInnerHtml('x', 67.14)).toContain('width: 67.14%');
  });
});

describe('clampPercent', () => {
  it('bounds to 0–100', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(120)).toBe(100);
  });
});
