// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';
import type { EditorHandle } from '../../components/layout/EditorPanel';
import { useFindReplace, type UseFindReplaceOptions } from '../useFindReplace';

function fakeEditor() {
  const editor = {
    runFormat: vi.fn(),
    scrollToSlide: vi.fn(),
    findNext: vi.fn(),
    replaceCurrent: vi.fn(),
    replaceAll: vi.fn(() => 3),
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    focus: vi.fn(),
  } satisfies EditorHandle;
  const editorRef = { current: editor } as RefObject<EditorHandle | null>;
  return { editor, editorRef };
}

function setup(overrides: Partial<UseFindReplaceOptions> = {}) {
  const { editor, editorRef } = fakeEditor();
  const onSelectSlide = vi.fn();
  const hook = renderHook(
    (props: UseFindReplaceOptions) => useFindReplace(props),
    { initialProps: { editorRef, slideCount: 5, onSelectSlide, ...overrides } },
  );
  return { ...hook, editor, editorRef, onSelectSlide };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useFindReplace', () => {
  it('starts closed in text mode with empty queries', () => {
    const { result } = setup();
    expect(result.current.open).toBe(false);
    expect(result.current.mode).toBe('text');
    expect(result.current.query).toBe('');
    expect(result.current.replaceQuery).toBe('');
    expect(result.current.showReplace).toBe(false);
    expect(result.current.replacedCount).toBeNull();
  });

  it('openDialog opens and selects the find input on the next tick', () => {
    const { result } = setup();
    const input = document.createElement('input');
    const select = vi.spyOn(input, 'select');
    result.current.inputRef.current = input;
    act(() => result.current.openDialog());
    expect(result.current.open).toBe(true);
    expect(select).not.toHaveBeenCalled();
    act(() => { vi.runAllTimers(); });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('close hides the dialog and refocuses the editor', () => {
    const { result, editor } = setup();
    act(() => result.current.openDialog());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });

  it('find next and previous delegate to the editor with the query', () => {
    const { result, editor } = setup();
    act(() => result.current.setQuery('hello'));
    act(() => result.current.runFind());
    act(() => result.current.runFind(1));
    act(() => result.current.runFind(-1));
    expect(editor.findNext.mock.calls).toEqual([['hello', 1], ['hello', 1], ['hello', -1]]);
  });

  it('replace delegates to the editor and clears a previous count', () => {
    const { result, editor } = setup();
    act(() => result.current.setQuery('a'));
    act(() => result.current.setReplaceQuery('b'));
    act(() => result.current.runReplaceAll());
    expect(result.current.replacedCount).toBe(3);
    act(() => result.current.runReplace());
    expect(editor.replaceCurrent).toHaveBeenCalledWith('a', 'b');
    expect(result.current.replacedCount).toBeNull();
  });

  it('replace all reports the editor count', () => {
    const { result, editor } = setup();
    act(() => result.current.setQuery('a'));
    act(() => result.current.setReplaceQuery('b'));
    act(() => result.current.runReplaceAll());
    expect(editor.replaceAll).toHaveBeenCalledWith('a', 'b');
    expect(result.current.replacedCount).toBe(3);
  });

  it('replace all reports zero when the editor is unmounted', () => {
    const { editorRef } = fakeEditor();
    editorRef.current = null;
    const { result } = setup({ editorRef });
    act(() => result.current.setQuery('a'));
    act(() => result.current.runReplaceAll());
    expect(result.current.replacedCount).toBe(0);
  });

  it('replace and replace all do nothing for a blank query', () => {
    const { result, editor } = setup();
    act(() => result.current.setQuery('   '));
    act(() => result.current.runReplace());
    act(() => result.current.runReplaceAll());
    expect(editor.replaceCurrent).not.toHaveBeenCalled();
    expect(editor.replaceAll).not.toHaveBeenCalled();
    expect(result.current.replacedCount).toBeNull();
  });

  it('editing the query, replacement or replace toggle clears the count', () => {
    const { result } = setup();
    const replaceAllThenCount = () => {
      act(() => result.current.runReplaceAll());
      expect(result.current.replacedCount).toBe(3);
    };
    act(() => result.current.setQuery('a'));
    replaceAllThenCount();
    act(() => result.current.setQuery('ab'));
    expect(result.current.replacedCount).toBeNull();
    replaceAllThenCount();
    act(() => result.current.setReplaceQuery('x'));
    expect(result.current.replacedCount).toBeNull();
    replaceAllThenCount();
    act(() => result.current.setShowReplace(true));
    expect(result.current.showReplace).toBe(true);
    expect(result.current.replacedCount).toBeNull();
  });

  describe('slide mode', () => {
    it('switching to slide mode strips non-digits from the query', () => {
      const { result } = setup();
      act(() => result.current.setQuery('slide 3a'));
      act(() => result.current.setMode('slide'));
      expect(result.current.mode).toBe('slide');
      expect(result.current.query).toBe('3');
    });

    it('switching back to text mode keeps the query', () => {
      const { result } = setup();
      act(() => result.current.setMode('slide'));
      act(() => result.current.setQuery('4'));
      act(() => result.current.setMode('text'));
      expect(result.current.mode).toBe('text');
      expect(result.current.query).toBe('4');
    });

    it('typing in slide mode keeps only digits', () => {
      const { result } = setup();
      act(() => result.current.setMode('slide'));
      act(() => result.current.setQuery('1x2'));
      expect(result.current.query).toBe('12');
    });

    it('jumps to a valid slide number, closes and focuses the editor', () => {
      const { result, editor, onSelectSlide } = setup();
      act(() => result.current.openDialog());
      act(() => result.current.setMode('slide'));
      act(() => result.current.setQuery('2'));
      act(() => result.current.runFind());
      expect(onSelectSlide).toHaveBeenCalledWith(1);
      expect(result.current.open).toBe(false);
      expect(editor.focus).toHaveBeenCalledTimes(1);
      expect(editor.findNext).not.toHaveBeenCalled();
      expect(editor.scrollToSlide).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(50); });
      expect(editor.scrollToSlide).toHaveBeenCalledWith(1);
    });

    it.each(['', '0', '6'])('ignores out-of-range slide number %j', (q) => {
      const { result, editor, onSelectSlide } = setup();
      act(() => result.current.openDialog());
      act(() => result.current.setMode('slide'));
      act(() => result.current.setQuery(q));
      act(() => result.current.runFind());
      act(() => { vi.runAllTimers(); });
      expect(onSelectSlide).not.toHaveBeenCalled();
      expect(editor.findNext).not.toHaveBeenCalled();
      expect(editor.scrollToSlide).not.toHaveBeenCalled();
      expect(result.current.open).toBe(true);
    });

    it('accepts the last slide using the current slide count', () => {
      const { result, rerender, editorRef, onSelectSlide } = setup();
      act(() => result.current.setMode('slide'));
      act(() => result.current.setQuery('7'));
      rerender({ editorRef, slideCount: 7, onSelectSlide });
      act(() => result.current.runFind());
      expect(onSelectSlide).toHaveBeenCalledWith(6);
    });
  });
});
