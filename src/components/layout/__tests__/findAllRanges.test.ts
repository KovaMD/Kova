import { describe, it, expect } from 'vitest';

import { findAllRanges } from '../../editor/formatCommands';

describe('findAllRanges', () => {
  it('finds every non-overlapping occurrence in order', () => {
    const doc = 'foo bar foo baz foo';
    expect(findAllRanges(doc, 'foo')).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
      { from: 16, to: 19 },
    ]);
  });

  it('matches case-insensitively', () => {
    const doc = 'Foo foo FOO';
    expect(findAllRanges(doc, 'foo')).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it('does not overlap matches within a run of the query', () => {
    const doc = 'aaaa';
    expect(findAllRanges(doc, 'aa')).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it('returns an empty array for an empty or whitespace query', () => {
    expect(findAllRanges('hello world', '')).toEqual([]);
    expect(findAllRanges('hello world', '   ')).toEqual([]);
  });

  it('returns an empty array when there are no matches', () => {
    expect(findAllRanges('hello world', 'xyz')).toEqual([]);
  });
});
