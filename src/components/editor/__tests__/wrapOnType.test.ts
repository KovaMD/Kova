// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { wrapOnType, handleWrapOnType } from '../formatCommands';

function makeEditor(doc: string, anchor: number, head: number) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: [wrapOnType],
  });
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

// inputHandler isn't reachable via a synthetic 'beforeinput'/'input' DOM event
// in jsdom (no real contentEditable input pipeline) — call the exported
// handler directly instead, which is what CodeMirror invokes on real input.
function type(view: EditorView, insert: string) {
  const sel = view.state.selection.main;
  return handleWrapOnType(view, sel.from, sel.to, insert);
}

describe('wrapOnType', () => {
  it('wraps a selection in asterisks instead of replacing it', () => {
    const view = makeEditor('hello world', 6, 11); // "world" selected
    const handled = type(view, '*');
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe('hello *world*');
    view.destroy();
  });

  it('keeps the inner text selected so a second press nests to bold', () => {
    const view = makeEditor('hello world', 6, 11);
    type(view, '*');
    type(view, '*');
    expect(view.state.doc.toString()).toBe('hello **world**');
    view.destroy();
  });

  it('wraps a selection in backticks', () => {
    const view = makeEditor('const x = 1', 0, 11);
    type(view, '`');
    expect(view.state.doc.toString()).toBe('`const x = 1`');
    view.destroy();
  });

  it('does nothing when there is no selection (cursor only)', () => {
    const view = makeEditor('hello world', 5, 5);
    const handled = type(view, '*');
    expect(handled).toBe(false);
    view.destroy();
  });

  it('does not intercept characters outside the wrap set', () => {
    const view = makeEditor('hello world', 6, 11);
    const handled = type(view, 'x');
    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe('hello world');
    view.destroy();
  });
});
