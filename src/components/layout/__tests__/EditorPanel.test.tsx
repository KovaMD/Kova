// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { EditorPanel, type EditorHandle } from '../EditorPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
// OS file drops arrive via the Tauri window, which has no IPC bridge in jsdom.
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onDragDropEvent: vi.fn(() => Promise.resolve(() => {})) }),
}));

// Runs real CodeMirror in jsdom. Layout-dependent behaviour (measuring,
// scrolling) is out of scope; these tests cover what reaches the document.

function renderEditor(content: string) {
  const onChange = vi.fn();
  const ref = createRef<EditorHandle>();
  const result = renderWithProviders(<EditorPanel ref={ref} content={content} onChange={onChange} />);
  const editable = result.container.querySelector<HTMLElement>('.cm-content');
  if (!editable) throw new Error('CodeMirror did not mount');
  return { ...result, ref, onChange, editable };
}

describe('EditorPanel smoke test', () => {
  it('shows the Markdown content in an editable CodeMirror surface', () => {
    const { editable } = renderEditor('# Hello\n\nWorld');
    expect(editable.getAttribute('contenteditable')).toBe('true');
    // Syntax highlighting splits lines into spans, so read each line's text.
    const lines = [...editable.querySelectorAll('.cm-line')].map((l) => l.textContent);
    expect(lines).toEqual(['# Hello', '', 'World']);
  });

  it('wraps the selection in bold with Ctrl+B and reports the edit', () => {
    const { ref, editable, onChange } = renderEditor('make me bold');
    act(() => ref.current!.selectAll());
    fireEvent.keyDown(editable, { key: 'b', code: 'KeyB', keyCode: 66, ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('**make me bold**');
  });

  it('applies a heading through the imperative format API', () => {
    const { ref, onChange } = renderEditor('Title');
    act(() => ref.current!.runFormat({ type: 'heading', level: 2 }));
    expect(onChange).toHaveBeenLastCalledWith('## Title');
  });

  it('does not report a change when the content prop is synced from outside', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<EditorPanel content="one" onChange={onChange} />);
    rerender(<EditorPanel content="two" onChange={onChange} />);
    expect(screen.getByText('two')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
