// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, type RefObject } from 'react';
import type { EditorHandle } from '../../components/layout/EditorPanel';
import type { Translator } from '../../i18n';

// ── Fakes ────────────────────────────────────────────────────────────────────

const dialog = vi.hoisted(() => ({
  open: vi.fn<(opts: unknown) => Promise<string | string[] | null>>(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

const ipc = vi.hoisted(() => ({
  copyImageToAssets: vi.fn<(abs: string, dir: string) => Promise<string>>(async () => 'copied.png'),
}));
vi.mock('../../platform/ipc', () => ipc);

import { useSlideEditing, type UseSlideEditingOptions } from '../useSlideEditing';

const t = ((key: string) => `t:${key}`) as unknown as Translator;

function doc(slides: string[]): string {
  return '---\ntitle: X\n---\n' + slides.join('\n---\n');
}

/** Slide bodies of a document, trimmed, in order. */
function slidesOf(text: string): string[] {
  return text.slice('---\ntitle: X\n---\n'.length).split(/\n---\n/).map((s) => s.trim());
}

function setup(initial: string, opts: Partial<UseSlideEditingOptions> = {}) {
  const scrollToSlide = vi.fn<(index: number) => void>();
  const editorRef = { current: { scrollToSlide } as unknown as EditorHandle } as RefObject<EditorHandle | null>;
  const setIsDirty = vi.fn<(dirty: boolean) => void>();
  const setCurrentSlideIndex = vi.fn<(index: number) => void>();
  const onWarn = vi.fn<(message: string) => void>();
  const hook = renderHook(() => {
    const [content, setContent] = useState(initial);
    const editing = useSlideEditing({
      setContent,
      setIsDirty,
      setCurrentSlideIndex,
      editorRef,
      slideCount: slidesOf(content).length,
      filePath: '/docs/deck.md',
      onWarn,
      t,
      ...opts,
    });
    return { content, editing };
  });
  return { ...hook, scrollToSlide, setIsDirty, setCurrentSlideIndex, onWarn };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Structural edits ─────────────────────────────────────────────────────────

describe('useSlideEditing: reorder', () => {
  it('moves one slide, selects it and scrolls the editor to it', () => {
    const { result, setIsDirty, setCurrentSlideIndex, scrollToSlide } = setup(doc(['A', 'B', 'C']));
    act(() => result.current.editing.handleSlideReorder(0, 2));
    expect(slidesOf(result.current.content)).toEqual(['B', 'C', 'A']);
    expect(setIsDirty).toHaveBeenCalledWith(true);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(2);
    expect(scrollToSlide).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50));
    expect(scrollToSlide).toHaveBeenCalledWith(2);
  });

  it('ignores a drop onto the slide itself', () => {
    const { result, setIsDirty } = setup(doc(['A', 'B']));
    const before = result.current.content;
    act(() => result.current.editing.handleSlideReorder(1, 1));
    expect(result.current.content).toBe(before);
    expect(setIsDirty).not.toHaveBeenCalled();
  });

  it('leaves content unchanged for an out-of-range index', () => {
    const { result } = setup(doc(['A', 'B']));
    const before = result.current.content;
    act(() => result.current.editing.handleSlideReorder(0, 5));
    expect(result.current.content).toBe(before);
  });
});

describe('useSlideEditing: reorder multiple', () => {
  it('drags a selected block down: it lands after the drop target', () => {
    const { result, setCurrentSlideIndex, scrollToSlide } = setup(doc(['A', 'B', 'C', 'D']));
    act(() => result.current.editing.handleReorderMultiple([0, 1], 0, 3));
    expect(slidesOf(result.current.content)).toEqual(['C', 'D', 'A', 'B']);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(2);
    act(() => vi.advanceTimersByTime(50));
    expect(scrollToSlide).toHaveBeenCalledWith(2);
  });

  it('drags a selected block up: it lands before the drop target', () => {
    const { result, setCurrentSlideIndex } = setup(doc(['A', 'B', 'C', 'D']));
    act(() => result.current.editing.handleReorderMultiple([2, 3], 3, 0));
    expect(slidesOf(result.current.content)).toEqual(['C', 'D', 'A', 'B']);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(0);
  });

  it('keeps a non-contiguous selection in document order', () => {
    const { result } = setup(doc(['A', 'B', 'C', 'D', 'E']));
    act(() => result.current.editing.handleReorderMultiple([3, 0], 3, 4));
    expect(slidesOf(result.current.content)).toEqual(['B', 'C', 'E', 'A', 'D']);
  });

  it('ignores a drop onto one of the selected slides', () => {
    const { result, setIsDirty } = setup(doc(['A', 'B', 'C']));
    const before = result.current.content;
    act(() => result.current.editing.handleReorderMultiple([0, 1], 0, 1));
    expect(result.current.content).toBe(before);
    expect(setIsDirty).not.toHaveBeenCalled();
  });
});

describe('useSlideEditing: duplicate and new', () => {
  it('duplicates a slide after itself and selects the copy', () => {
    const { result, setCurrentSlideIndex, scrollToSlide } = setup(doc(['A', 'B']));
    act(() => result.current.editing.handleDuplicateSlide(0));
    expect(slidesOf(result.current.content)).toEqual(['A', 'A', 'B']);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(1);
    act(() => vi.advanceTimersByTime(50));
    expect(scrollToSlide).toHaveBeenCalledWith(1);
  });

  it('inserts an empty slide after the given one and selects it', () => {
    const { result, setCurrentSlideIndex } = setup(doc(['A', 'B']));
    act(() => result.current.editing.handleNewSlide(1));
    expect(slidesOf(result.current.content)).toEqual(['A', 'B', '']);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(2);
  });
});

describe('useSlideEditing: delete', () => {
  it('deletes one slide and selects the slide now in its place', () => {
    const { result, setCurrentSlideIndex } = setup(doc(['A', 'B', 'C']));
    act(() => result.current.editing.handleDeleteSlide(1));
    expect(slidesOf(result.current.content)).toEqual(['A', 'C']);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(1);
  });

  it('clamps the selection when deleting the last slide', () => {
    const { result, setCurrentSlideIndex } = setup(doc(['A', 'B', 'C']));
    act(() => result.current.editing.handleDeleteSlide(2));
    expect(slidesOf(result.current.content)).toEqual(['A', 'B']);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(1);
  });

  it('refuses to delete the only slide', () => {
    const { result } = setup(doc(['A']));
    const before = result.current.content;
    act(() => result.current.editing.handleDeleteSlide(0));
    expect(result.current.content).toBe(before);
  });

  it('deletes a multi-selection', () => {
    const { result, setCurrentSlideIndex } = setup(doc(['A', 'B', 'C', 'D']));
    act(() => result.current.editing.handleDeleteMultiple([2, 0]));
    expect(slidesOf(result.current.content)).toEqual(['B', 'D']);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(0);
  });

  it('refuses a multi-delete of every slide', () => {
    const { result } = setup(doc(['A', 'B']));
    const before = result.current.content;
    act(() => result.current.editing.handleDeleteMultiple([0, 1]));
    expect(result.current.content).toBe(before);
  });

  it('ignores an empty multi-selection', () => {
    const { result, setIsDirty } = setup(doc(['A', 'B']));
    act(() => result.current.editing.handleDeleteMultiple([]));
    expect(setIsDirty).not.toHaveBeenCalled();
  });
});

// ── In-place edits ───────────────────────────────────────────────────────────

describe('useSlideEditing: markers', () => {
  it('toggles the hidden marker on and off, leaving other slides byte-identical', () => {
    const { result, setIsDirty, setCurrentSlideIndex } = setup(doc(['A', '  B\n\nspaced  ']));
    act(() => result.current.editing.handleToggleHidden(0));
    expect(result.current.content).toBe(doc(['<!-- hidden -->\nA', '  B\n\nspaced  ']));
    expect(setIsDirty).toHaveBeenCalledWith(true);
    expect(setCurrentSlideIndex).not.toHaveBeenCalled();
    act(() => result.current.editing.handleToggleHidden(0));
    expect(result.current.content).toBe(doc(['A', '  B\n\nspaced  ']));
  });

  it('toggles the todo marker independently of hidden', () => {
    const { result } = setup(doc(['<!-- hidden -->\nA']));
    act(() => result.current.editing.handleToggleTodo(0));
    expect(result.current.content).toBe(doc(['<!-- todo -->\n<!-- hidden -->\nA']));
  });
});

describe('useSlideEditing: background', () => {
  it('sets a background from the picked image, relative to the document', async () => {
    dialog.open.mockResolvedValue('/docs/img/bg.png');
    const { result, setCurrentSlideIndex, scrollToSlide } = setup(doc(['# A', 'B']));
    await act(() => result.current.editing.handleSetSlideBackground(0));
    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(result.current.content).toBe(doc(['![bg](img/bg.png)\n\n# A', 'B']));
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(0);
    act(() => vi.advanceTimersByTime(50));
    expect(scrollToSlide).toHaveBeenCalledWith(0);
  });

  it('places a new background after hidden/todo markers', async () => {
    dialog.open.mockResolvedValue('/docs/bg.png');
    const { result } = setup(doc(['<!-- hidden -->\n# A']));
    await act(() => result.current.editing.handleSetSlideBackground(0));
    expect(result.current.content).toBe(doc(['<!-- hidden -->\n![bg](bg.png)\n\n# A']));
  });

  it('replaces an existing background line, keeping its options', async () => {
    dialog.open.mockResolvedValue('/docs/new.png');
    const { result } = setup(doc(['![bg contain](old.png)\n# A']));
    await act(() => result.current.editing.handleSetSlideBackground(0));
    expect(result.current.content).toBe(doc(['![bg contain](new.png)\n# A']));
  });

  it('warns and does nothing for an unsaved document', async () => {
    const { result, onWarn } = setup(doc(['A']), { filePath: null });
    const before = result.current.content;
    await act(() => result.current.editing.handleSetSlideBackground(0));
    expect(onWarn).toHaveBeenCalledWith('t:editor.saveFirstDropMedia');
    expect(dialog.open).not.toHaveBeenCalled();
    expect(result.current.content).toBe(before);
  });

  it('does nothing when the picker is cancelled', async () => {
    dialog.open.mockResolvedValue(null);
    const { result, setIsDirty } = setup(doc(['A']));
    await act(() => result.current.editing.handleSetSlideBackground(0));
    expect(setIsDirty).not.toHaveBeenCalled();
  });

  it('clears a background, ignoring bg-like lines inside a code fence', () => {
    const fenced = '```\n![bg](kept.png)\n```';
    const { result, setIsDirty } = setup(doc([`![bg](a.png)\n# A\n${fenced}`, 'B']));
    act(() => result.current.editing.handleClearSlideBackground(0));
    expect(result.current.content).toBe(doc([`# A\n${fenced}`, 'B']));
    expect(setIsDirty).toHaveBeenCalledWith(true);
  });
});
