import { describe, it, expect } from 'vitest';
import { parseAspectRatio, nextAspectRatio } from '../types';

describe('parseAspectRatio', () => {
  it('returns 16:9 by default when undefined', () => {
    expect(parseAspectRatio(undefined)).toEqual({ w: 16, h: 9 });
  });

  it('returns 16:9 for an unrecognised string', () => {
    expect(parseAspectRatio('3:2')).toEqual({ w: 16, h: 9 });
  });

  it('returns 4:3 for the "4:3" string', () => {
    expect(parseAspectRatio('4:3')).toEqual({ w: 4, h: 3 });
  });

  it('returns 16:10 for the "16:10" string', () => {
    expect(parseAspectRatio('16:10')).toEqual({ w: 16, h: 10 });
  });

  it('returns 16:9 for empty string', () => {
    expect(parseAspectRatio('')).toEqual({ w: 16, h: 9 });
  });
});

describe('nextAspectRatio', () => {
  it('cycles 16:9 -> 4:3 -> 16:10 -> 16:9', () => {
    expect(nextAspectRatio('16:9')).toBe('4:3');
    expect(nextAspectRatio('4:3')).toBe('16:10');
    expect(nextAspectRatio('16:10')).toBe('16:9');
  });

  it('treats an absent aspect_ratio as 16:9 and goes to 4:3', () => {
    expect(nextAspectRatio(undefined)).toBe('4:3');
  });

  it('sends an unrecognised value to 4:3', () => {
    expect(nextAspectRatio('3:2')).toBe('4:3');
    expect(nextAspectRatio('')).toBe('4:3');
  });
});
