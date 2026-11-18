// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createTextRunBuilder } from '../elements/textRuns';
import { firstFont } from '../fonts';
import { stripHtml } from '../html';

describe('createTextRunBuilder', () => {
  it('numbers paragraphs from 0 and groups them by build step', () => {
    const b = createTextRunBuilder();
    b.startParagraph(undefined); // 0
    b.startParagraph(1);         // 1
    b.startParagraph(2);         // 2
    b.startParagraph(1);         // 3
    expect([...b.paraSteps]).toEqual([[1, [1, 3]], [2, [2]]]);
    expect(b.runs).toEqual([]);
  });
});

describe('firstFont', () => {
  it('takes the first family of a stack and strips quotes', () => {
    expect(firstFont(`"Fira Code", 'JetBrains Mono', monospace`)).toBe('Fira Code');
  });
});

describe('stripHtml', () => {
  it('decodes entities and keeps image alt text', () => {
    expect(stripHtml('AT&amp;T <img alt="logo" src="x.png">')).toBe('AT&T logo');
  });
});
