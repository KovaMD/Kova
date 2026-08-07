// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { doToggleLineStepMarker, hasLineStepMarker } from '../contextMenuActions';

function makeView(doc: string): EditorView {
  return new EditorView({ state: EditorState.create({ doc }) });
}

describe('doToggleLineStepMarker / hasLineStepMarker', () => {
  it('appends a trailing marker to a plain bullet line', () => {
    const view = makeView('- Second bullet');
    expect(hasLineStepMarker(view, 3)).toBe(false);
    doToggleLineStepMarker(view, 3);
    expect(view.state.doc.toString()).toBe('- Second bullet <!-- step -->');
    view.destroy();
  });

  it('removes an existing trailing marker (toggle off)', () => {
    const view = makeView('- Second bullet <!-- step -->');
    expect(hasLineStepMarker(view, 3)).toBe(true);
    doToggleLineStepMarker(view, 3);
    expect(view.state.doc.toString()).toBe('- Second bullet');
    view.destroy();
  });

  it('removes an explicit-number marker just as well as a bare one', () => {
    const view = makeView('- Grouped bullet <!-- step: 2 -->');
    expect(hasLineStepMarker(view, 0)).toBe(true);
    doToggleLineStepMarker(view, 0);
    expect(view.state.doc.toString()).toBe('- Grouped bullet');
    view.destroy();
  });

  it('only affects the line containing the given position, in a multi-line doc', () => {
    const view = makeView('- First\n- Second\n- Third');
    const secondLineStart = view.state.doc.line(2).from;
    doToggleLineStepMarker(view, secondLineStart);
    expect(view.state.doc.toString()).toBe('- First\n- Second <!-- step -->\n- Third');
    view.destroy();
  });
});
