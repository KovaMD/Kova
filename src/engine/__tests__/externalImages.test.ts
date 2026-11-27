import { describe, it, expect } from 'vitest';
import { countExternalImages } from '../externalImages';

// Images that live outside the document's folder display fine locally but
// break when the .md file is moved without them (status-bar warning).
describe('countExternalImages', () => {
  const FILE = '/home/me/decks/talk.md';

  it('counts absolute paths outside the doc folder and relative paths that escape it', () => {
    const md = [
      '![a](/home/me/pics/a.png)',      // outside: counted
      '![b](/home/me/decks/img/b.png)', // inside (absolute): not counted
      '![c](../shared/c.png)',          // escapes: counted
      '![d](img/d.png)',                // inside (relative): not counted
    ].join('\n');
    expect(countExternalImages(md, FILE)).toBe(2);
  });

  it('ignores web, data and asset URLs', () => {
    const md = [
      '![w](https://example.com/w.png)',
      '![d](data:image/png;base64,AAAA)',
      '![a](asset://localhost/%2Fx.png)',
    ].join('\n');
    expect(countExternalImages(md, FILE)).toBe(0);
  });

  it('handles Windows paths', () => {
    const md = '![a](C:\\Users\\me\\pics\\a.png)\n![b](C:\\Users\\me\\decks\\b.png)';
    expect(countExternalImages(md, 'C:\\Users\\me\\decks\\talk.md')).toBe(1);
  });
});
