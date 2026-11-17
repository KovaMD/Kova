// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../html';

describe('escapeHtml', () => {
  it('escapes &, <, > and "', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
  });

  it('escapes & first so its own entities are not escaped twice', () => {
    expect(escapeHtml('<b>"AT&T"</b>')).toBe('&lt;b&gt;&quot;AT&amp;T&quot;&lt;/b&gt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves single quotes and plain text untouched', () => {
    expect(escapeHtml("it's fine")).toBe("it's fine");
    expect(escapeHtml('')).toBe('');
  });

  it('cannot break out of a double-quoted attribute value', () => {
    const hostile = '" onerror="alert(1)" x="<>&';
    const html = `<img alt="${escapeHtml(hostile)}">`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const img = doc.querySelector('img')!;
    expect(img.getAttributeNames()).toEqual(['alt']);
    expect(img.getAttribute('alt')).toBe(hostile);
  });

  it('round-trips through a text node without creating elements', () => {
    const text = '<script>"x" & y</script>';
    const doc = new DOMParser().parseFromString(`<p>${escapeHtml(text)}</p>`, 'text/html');
    expect(doc.querySelector('p')!.textContent).toBe(text);
    expect(doc.querySelector('script')).toBeNull();
  });
});
