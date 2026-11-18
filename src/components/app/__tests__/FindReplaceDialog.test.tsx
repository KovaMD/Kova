// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen, act } from '@testing-library/react';
import { useEffect, type RefObject } from 'react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { FindReplaceDialog } from '../FindReplaceDialog';
import { useFindReplace } from '../../../hooks/useFindReplace';
import type { EditorHandle } from '../../layout/EditorPanel';

function fakeEditorRef() {
  const editor = {
    runFormat: vi.fn(), scrollToSlide: vi.fn(), findNext: vi.fn(),
    replaceCurrent: vi.fn(), replaceAll: vi.fn(() => 2),
    undo: vi.fn(), redo: vi.fn(), selectAll: vi.fn(), focus: vi.fn(),
  } satisfies EditorHandle;
  return { editor, editorRef: { current: editor } as RefObject<EditorHandle | null> };
}

function Harness({ editorRef, onSelectSlide, startOpen = true }: {
  editorRef: RefObject<EditorHandle | null>;
  onSelectSlide: (i: number) => void;
  startOpen?: boolean;
}) {
  const findReplace = useFindReplace({ editorRef, slideCount: 4, onSelectSlide });
  const { openDialog } = findReplace;
  useEffect(() => { if (startOpen) openDialog(); }, [startOpen, openDialog]);
  return <FindReplaceDialog findReplace={findReplace} />;
}

function renderDialog(startOpen = true) {
  const { editor, editorRef } = fakeEditorRef();
  const onSelectSlide = vi.fn();
  const result = renderWithProviders(
    <Harness editorRef={editorRef} onSelectSlide={onSelectSlide} startOpen={startOpen} />,
  );
  return { ...result, editor, onSelectSlide };
}

describe('FindReplaceDialog', () => {
  it('renders nothing while closed', () => {
    renderDialog(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Enter finds next, Shift+Enter finds previous, Escape closes', async () => {
    const { user, editor } = renderDialog();
    const input = screen.getByPlaceholderText('Find in document…');
    await user.type(input, 'abc{Enter}');
    await user.type(input, '{Shift>}{Enter}{/Shift}');
    expect(editor.findNext.mock.calls).toEqual([['abc', 1], ['abc', -1]]);
    await user.type(input, '{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editor.focus).toHaveBeenCalled();
  });

  it('Replace All shows the replaced count', async () => {
    const { user, editor } = renderDialog();
    await user.type(screen.getByPlaceholderText('Find in document…'), 'a');
    await user.click(screen.getByRole('checkbox', { name: 'Replace' }));
    await user.type(screen.getByPlaceholderText('Replace with…'), 'b');
    await user.click(screen.getByRole('button', { name: 'Replace All' }));
    expect(editor.replaceAll).toHaveBeenCalledWith('a', 'b');
    expect(screen.getByText('2 replaced')).toBeTruthy();
  });

  it('slide mode jumps to the typed slide and closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user, editor, onSelectSlide } = renderDialog();
      await user.click(screen.getByRole('radio', { name: 'Slide #' }));
      const input = screen.getByPlaceholderText('Go to slide (1–4)…');
      await user.type(input, 'x3');
      expect((input as HTMLInputElement).value).toBe('3');
      await user.click(screen.getByRole('button', { name: 'OK' }));
      expect(onSelectSlide).toHaveBeenCalledWith(2);
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => { vi.advanceTimersByTime(50); });
      expect(editor.scrollToSlide).toHaveBeenCalledWith(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
