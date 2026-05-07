import { describe, it, expect } from 'vitest';
import { parseAspectRatio } from '../types';

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

  it('returns 16:9 for empty string', () => {
    expect(parseAspectRatio('')).toEqual({ w: 16, h: 9 });
  });
});
