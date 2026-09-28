import { describe, it, expect } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { replaceCurrent, replaceAll, goToNextMatch } from '../../editor/formatCommands';

// A DOM-free stand-in for EditorView, matching the pattern used for the other
// format commands in this directory.
function makeView(doc: string, from: number, to: number) {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to } });
  return {
    get state() { return state; },
    dispatch(tr: TransactionSpec) { state = state.update(tr).state; },
    focus() {},
  } as unknown as EditorView;
}

describe('goToNextMatch', () => {
  it('selects the next occurrence forward and wraps around', () => {
    const view = makeView('foo bar foo', 0, 0);
    expect(goToNextMatch(view, 'foo', 1)).toBe(true);
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 3 });
    expect(goToNextMatch(view, 'foo', 1)).toBe(true);
    expect(view.state.selection.main).toMatchObject({ from: 8, to: 11 });
  });

  it('returns false when there is no match', () => {
    const view = makeView('foo bar', 0, 0);
    expect(goToNextMatch(view, 'xyz', 1)).toBe(false);
  });
});

describe('replaceCurrent', () => {
  it('replaces the current selection when it is a live match, then selects the next occurrence', () => {
    const doc = 'foo bar foo';
    const view = makeView(doc, 0, 3); // "foo" selected at the front
    replaceCurrent(view, 'foo', 'baz');
    expect(view.state.doc.toString()).toBe('baz bar foo');
    // Cursor should have advanced to select the remaining "foo".
    expect(view.state.selection.main).toMatchObject({ from: 8, to: 11 });
  });

  it('does not replace when the current selection is not a live match — behaves like Find', () => {
    const doc = 'foo bar foo';
    const view = makeView(doc, 0, 0); // no selection
    replaceCurrent(view, 'foo', 'baz');
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 3 });
  });

  it('does nothing for an empty query', () => {
    const doc = 'foo bar foo';
    const view = makeView(doc, 0, 3);
    replaceCurrent(view, '   ', 'baz');
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe('replaceAll', () => {
  it('replaces every occurrence and returns the count', () => {
    const doc = 'foo bar foo baz foo';
    const view = makeView(doc, 0, 0);
    const count = replaceAll(view, 'foo', 'qux');
    expect(count).toBe(3);
    expect(view.state.doc.toString()).toBe('qux bar qux baz qux');
  });

  it('returns 0 and makes no changes when there are no matches', () => {
    const doc = 'hello world';
    const view = makeView(doc, 0, 0);
    const count = replaceAll(view, 'xyz', 'qux');
    expect(count).toBe(0);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
