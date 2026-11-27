import { describe, expect, it } from 'vitest';
import { assetUrlToPath, isAssetUrl, isDataUrl, htmlHasAssetSrc } from '../assetUrl';

// convertFileSrc returns asset://localhost/<encoded> on macOS/Linux but
// http://asset.localhost/<encoded> on Windows (WebView2 can't load custom
// schemes). Both must be treated as local files.
const MAC = 'asset://localhost/%2FUsers%2Fme%2Fdeck%2Fpic.png';
const WIN = 'http://asset.localhost/C%3A%2FUsers%2Fme%2Fdeck%2Fpic.png';

describe('isAssetUrl', () => {
  it('recognises the macOS/Linux and Windows forms', () => {
    expect(isAssetUrl(MAC)).toBe(true);
    expect(isAssetUrl(WIN)).toBe(true);
    expect(isAssetUrl('https://asset.localhost/x.png')).toBe(true);
  });
  it('rejects remote, data and relative srcs', () => {
    expect(isAssetUrl('https://example.com/pic.png')).toBe(false);
    expect(isAssetUrl('http://asset.localhost.evil.com/x.png')).toBe(false);
    expect(isAssetUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isAssetUrl('pic.png')).toBe(false);
  });
});

describe('assetUrlToPath', () => {
  it('decodes a POSIX path', () => {
    expect(assetUrlToPath(MAC)).toBe('//Users/me/deck/pic.png');
  });
  it('drops the slash in front of a Windows drive letter', () => {
    expect(assetUrlToPath(WIN)).toBe('C:/Users/me/deck/pic.png');
    expect(assetUrlToPath('http://asset.localhost/C%3A%5CUsers%5Cpic.png')).toBe('C:\\Users\\pic.png');
  });
});

describe('isDataUrl', () => {
  it('matches data URLs, which have no //', () => {
    expect(isDataUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isDataUrl('DATA:image/svg+xml,<svg/>')).toBe(true);
    expect(isDataUrl('data.png')).toBe(false);
  });
});

describe('htmlHasAssetSrc', () => {
  it('finds either asset form in a src attribute', () => {
    expect(htmlHasAssetSrc(`<img src="${MAC}">`)).toBe(true);
    expect(htmlHasAssetSrc(`<img src="${WIN}">`)).toBe(true);
    expect(htmlHasAssetSrc('<img src="data:image/png;base64,AA">')).toBe(false);
  });
});
