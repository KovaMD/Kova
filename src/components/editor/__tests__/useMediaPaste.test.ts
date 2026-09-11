import { describe, it, expect } from 'vitest';
import { pastedUrl } from '../useMediaPaste';

// Issue #247 — pasting a bare URL over selected text turns it into a
// markdown link instead of overwriting the selection; pasting anything else
// (a URL alongside other words, non-URL text) must behave as a plain paste.
describe('pastedUrl', () => {
  it('recognises a bare http(s) URL', () => {
    expect(pastedUrl('https://example.com/page')).toBe('https://example.com/page');
    expect(pastedUrl('http://example.com')).toBe('http://example.com');
  });

  it('trims surrounding whitespace (e.g. a trailing newline from the clipboard)', () => {
    expect(pastedUrl('  https://example.com/page  \n')).toBe('https://example.com/page');
  });

  it('rejects text that merely contains a URL alongside other words', () => {
    expect(pastedUrl('check out https://example.com/page')).toBeNull();
    expect(pastedUrl('https://example.com/page — see this')).toBeNull();
  });

  it('rejects plain non-URL text', () => {
    expect(pastedUrl('just some text')).toBeNull();
    expect(pastedUrl('')).toBeNull();
  });

  it('rejects a non-http(s) scheme', () => {
    expect(pastedUrl('ftp://example.com/file')).toBeNull();
    expect(pastedUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects a URL containing internal whitespace', () => {
    expect(pastedUrl('https://example.com/a page')).toBeNull();
  });
});
