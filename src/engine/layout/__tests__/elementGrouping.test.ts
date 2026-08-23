import { describe, it, expect } from 'vitest';
import { autoSplitElements, explodeListItems, groupProgressRuns, splitByColumnBreaks } from '../elementGrouping';
import type { SlideElement, ListItem } from '../../types';

const item = (text: string): ListItem => ({ text, html: `<p>${text}</p>`, children: [] });

const paragraph = (text: string): SlideElement => ({ type: 'paragraph', text, html: `<p>${text}</p>` });
const progress = (label: string, value: number): SlideElement => ({ type: 'progress', label, value });
const image: SlideElement = { type: 'image', src: 'a.png', alt: 'a' };

describe('groupProgressRuns', () => {
  it('collapses consecutive progress elements into one group', () => {
    const groups = groupProgressRuns([progress('a', 1), progress('b', 2), progress('c', 3)]);
    expect(groups).toEqual([[progress('a', 1), progress('b', 2), progress('c', 3)]]);
  });

  it('keeps non-progress elements in their own groups', () => {
    const groups = groupProgressRuns([paragraph('x'), image]);
    expect(groups).toEqual([[paragraph('x')], [image]]);
  });

  it('starts a new group when a progress run is broken by another element', () => {
    const groups = groupProgressRuns([progress('a', 1), paragraph('mid'), progress('b', 2)]);
    expect(groups).toEqual([[progress('a', 1)], [paragraph('mid')], [progress('b', 2)]]);
  });
});

describe('explodeListItems', () => {
  it('splits a bullet list into one single-item list per cell (issue #229)', () => {
    const items = [item('a'), item('b'), item('c')];
    const list: SlideElement = { type: 'list', ordered: false, items };

    const exploded = explodeListItems([list]);

    expect(exploded).toEqual([
      { type: 'list', ordered: false, items: [items[0]] },
      { type: 'list', ordered: false, items: [items[1]] },
      { type: 'list', ordered: false, items: [items[2]] },
    ]);
  });

  it('leaves non-list elements untouched and preserves their position', () => {
    const list: SlideElement = { type: 'list', ordered: false, items: [item('a'), item('b')] };
    const exploded = explodeListItems([paragraph('intro'), list, image]);

    expect(exploded).toEqual([
      paragraph('intro'),
      { type: 'list', ordered: false, items: [item('a')] },
      { type: 'list', ordered: false, items: [item('b')] },
      image,
    ]);
  });

  it('leaves a single-item list as-is', () => {
    const list: SlideElement = { type: 'list', ordered: true, items: [item('only')] };
    expect(explodeListItems([list])).toEqual([list]);
  });
});

describe('splitByColumnBreaks', () => {
  const colBreak: SlideElement = { type: 'column-break' };

  it('splits into 2 groups at a single break', () => {
    const groups = splitByColumnBreaks([paragraph('a'), colBreak, paragraph('b')], 2);
    expect(groups).toEqual([[paragraph('a')], [paragraph('b')]]);
  });

  it('splits into 3 clean groups at 2 breaks', () => {
    const groups = splitByColumnBreaks(
      [paragraph('a'), colBreak, paragraph('b'), colBreak, paragraph('c')],
      3,
    );
    expect(groups).toEqual([[paragraph('a')], [paragraph('b')], [paragraph('c')]]);
  });

  it('folds a 3rd+ break and trailing content into the last group when capped at 3 columns', () => {
    const groups = splitByColumnBreaks(
      [paragraph('a'), colBreak, paragraph('b'), colBreak, paragraph('c'), colBreak, paragraph('d')],
      3,
    );
    expect(groups).toEqual([[paragraph('a')], [paragraph('b')], [paragraph('c'), colBreak, paragraph('d')]]);
  });

  it('puts all content in the first group when there are no breaks, leaving the rest empty', () => {
    const groups = splitByColumnBreaks([paragraph('a'), paragraph('b')], 3);
    expect(groups).toEqual([[paragraph('a'), paragraph('b')], [], []]);
  });
});

describe('autoSplitElements — multi-element branch', () => {
  it('falls back to a count-based midpoint when elements have equal estimated weight', () => {
    const els = [paragraph('a'), paragraph('b'), paragraph('c'), paragraph('d')];
    const [left, right] = autoSplitElements(els);
    expect(left).toEqual([paragraph('a'), paragraph('b')]);
    expect(right).toEqual([paragraph('c'), paragraph('d')]);
  });

  it('balances by cumulative estimated line count, not raw element count', () => {
    // A long paragraph (several wrapped lines) followed by three short ones:
    // a naive count-based midpoint (ceil(4/2) = 2) would pair the long
    // paragraph with one short paragraph on the left, leaving the right
    // column comparatively empty once the renderer shrinks the font to fit
    // — line-count balancing should instead put the long paragraph on its
    // own (see issue #145).
    const long = paragraph('x '.repeat(200)); // ~400 visual chars, several wrapped lines at ~90 chars/line
    const shorts = [paragraph('a'), paragraph('b'), paragraph('c')];
    const els = [long, ...shorts];

    const [left, right] = autoSplitElements(els);

    expect(left).toEqual([long]);
    expect(right).toEqual(shorts);
  });

  it('still weighs non-text elements like images into the balance', () => {
    const els = [paragraph('a'), paragraph('b'), image, paragraph('c')];
    const [left, right] = autoSplitElements(els);
    expect(left).toEqual([paragraph('a'), paragraph('b'), image]);
    expect(right).toEqual([paragraph('c')]);
  });

  it('never leaves the right column empty when the heaviest item is last', () => {
    // Mirror of the heaviest-item-first case above: the cumulative-weight
    // scan only crosses 50% at the final index, which previously put
    // everything in the left column and left the right column with zero
    // elements (a completely empty sibling column/divider).
    const shorts = [paragraph('a'), paragraph('b'), paragraph('c'), paragraph('d')];
    const long = paragraph('x '.repeat(200));
    const els = [...shorts, long];

    const [left, right] = autoSplitElements(els);

    expect(right.length).toBeGreaterThan(0);
    expect(right).toEqual([long]);
    expect(left).toEqual(shorts);
  });
});

describe('autoSplitElements — single list branch', () => {
  it('balances by cumulative estimated line count, not item count', () => {
    // One long item (several wrapped lines) followed by four short ones: a
    // naive count-based midpoint split (Math.ceil(5/2) = 3) would put the
    // long item alone with two short items on the left — line-based
    // balancing should instead isolate the long item by itself, since its
    // estimated line count already exceeds half the total.
    const long = item('x'.repeat(700));
    const shorts = [item('a'), item('b'), item('c'), item('d')];
    const list: SlideElement = { type: 'list', ordered: false, items: [long, ...shorts] };

    const [left, right] = autoSplitElements([list]);

    expect(left).toEqual([{ type: 'list', ordered: false, items: [long] }]);
    expect(right).toEqual([{ type: 'list', ordered: false, items: shorts }]);
  });

  it('falls back to a count-based midpoint when items are equal length', () => {
    const items = [item('aa'), item('bb'), item('cc'), item('dd')];
    const list: SlideElement = { type: 'list', ordered: true, items };

    const [left, right] = autoSplitElements([list]);

    expect(left).toEqual([{ type: 'list', ordered: true, items: items.slice(0, 2) }]);
    expect(right).toEqual([{ type: 'list', ordered: true, items: items.slice(2) }]);
  });
});

describe('autoSplitElements — single toc branch', () => {
  it('balances by cumulative estimated line count and carries numberStart into the second half', () => {
    const entries = [
      { title: 'x'.repeat(700), index: 0 },
      { title: 'a', index: 1 },
      { title: 'b', index: 2 },
      { title: 'c', index: 3 },
    ];
    const toc: SlideElement = { type: 'toc', entries };

    const [left, right] = autoSplitElements([toc]);

    expect(left).toEqual([{ type: 'toc', entries: [entries[0]] }]);
    expect(right).toEqual([{ type: 'toc', entries: entries.slice(1), numberStart: 1 }]);
  });
});
