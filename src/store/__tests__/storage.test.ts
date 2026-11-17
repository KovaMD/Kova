import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readJson, writeJson } from '../storage';

// vitest runs in a node environment with no browser localStorage, so stub it
// the same way the other store tests do.
let store: Record<string, string>;
function stubLocalStorage() {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
}

function stubThrowingLocalStorage() {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('unavailable'); },
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => { throw new Error('unavailable'); },
  });
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

describe('readJson', () => {
  beforeEach(stubLocalStorage);
  afterEach(() => vi.unstubAllGlobals());

  it('returns the fallback when the key is missing', () => {
    const fallback = ['x'];
    expect(readJson('missing', fallback)).toBe(fallback);
  });

  it('returns the fallback for corrupt JSON', () => {
    store.k = '{not json';
    expect(readJson('k', 42)).toBe(42);
  });

  it('returns the fallback for an empty string', () => {
    store.k = '';
    expect(readJson('k', 'fb')).toBe('fb');
  });

  it('returns the fallback when localStorage.getItem throws', () => {
    stubThrowingLocalStorage();
    expect(readJson('k', 'fb')).toBe('fb');
  });

  it('returns the fallback when the validator rejects the value', () => {
    store.k = JSON.stringify([1, 2]);
    expect(readJson('k', ['fb'], isStringArray)).toEqual(['fb']);
  });

  it('returns the parsed value when the validator accepts it', () => {
    store.k = JSON.stringify(['a', 'b']);
    expect(readJson('k', [], isStringArray)).toEqual(['a', 'b']);
  });

  it('returns the parsed value unchecked when no validator is given', () => {
    store.k = 'null';
    expect(readJson<string[] | null>('k', [])).toBeNull();
  });
});

describe('writeJson', () => {
  beforeEach(stubLocalStorage);
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a value through readJson', () => {
    const value = { path: '/a.md', slideIndex: 3, tags: ['x'] };
    expect(writeJson('k', value)).toBe(true);
    expect(store.k).toBe(JSON.stringify(value));
    expect(readJson('k', null)).toEqual(value);
  });

  it('swallows a throwing localStorage.setItem and reports failure', () => {
    stubThrowingLocalStorage();
    expect(() => writeJson('k', [1])).not.toThrow();
    expect(writeJson('k', [1])).toBe(false);
  });
});
