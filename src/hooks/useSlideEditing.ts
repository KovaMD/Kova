import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { resolveImagePathForMarkdown } from '../components/editor/mediaSnippet';
import type { EditorHandle } from '../components/layout/EditorPanel';
import { editSlideSegments } from '../engine/document/editSlideSegments';
import { setSlideBackgroundInRaw } from '../engine/document/slideBackground';
import { IMAGE_DIALOG_FILTER } from '../engine/mediaTypes';
import type { Translator } from '../i18n';

export interface UseSlideEditingOptions {
  /** Setter for the full document source (frontmatter included). */
  setContent: Dispatch<SetStateAction<string>>;
  setIsDirty: (dirty: boolean) => void;
  setCurrentSlideIndex: (index: number) => void;
  /** Editor scrolled to the edited slide shortly after each structural edit. */
  editorRef: RefObject<EditorHandle | null>;
  /** Current parsed slide count, used to clamp the selection after a delete. */
  slideCount: number;
  /** Path of the open document, or null for an unsaved one. */
  filePath: string | null;
  onWarn: (message: string) => void;
  t: Translator;
}

export interface UseSlideEditingResult {
  handleSlideReorder: (fromIndex: number, toIndex: number) => void;
  handleDuplicateSlide: (index: number) => void;
  handleNewSlide: (index: number) => void;
  handleDeleteSlide: (index: number) => void;
  handleDeleteMultiple: (indices: number[]) => void;
  handleReorderMultiple: (fromIndices: number[], anchorIndex: number, toIndex: number) => void;
  handleToggleHidden: (index: number) => void;
  handleToggleTodo: (index: number) => void;
  handleSetSlideBackground: (index: number) => Promise<void>;
  handleClearSlideBackground: (index: number) => void;
}

/**
 * Thumbnail-panel slide edits on the document source: reorder (single and
 * multi-select block), duplicate, new, delete (single and multi-select),
 * hidden/todo markers and slide backgrounds. Each goes through the
 * fence-aware editSlideSegments.
 */
export function useSlideEditing({
  setContent,
  setIsDirty,
  setCurrentSlideIndex,
  editorRef,
  slideCount,
  filePath,
  onWarn,
  t,
}: UseSlideEditingOptions): UseSlideEditingResult {
  const selectAndScroll = useCallback((index: number) => {
    setCurrentSlideIndex(index);
    setTimeout(() => editorRef.current?.scrollToSlide(index), 50);
  }, [setCurrentSlideIndex, editorRef]);

  const handleSlideReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (fromIndex < 0 || fromIndex >= segments.length || toIndex < 0 || toIndex >= segments.length) return null;
      const reordered = [...segments];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      return reordered;
    }, 'trim'));
    setIsDirty(true);
    selectAndScroll(toIndex);
  }, [setContent, setIsDirty, selectAndScroll]);

  const handleDuplicateSlide = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next.splice(index + 1, 0, segments[index]);
      return next;
    }, 'trim'));
    setIsDirty(true);
    selectAndScroll(index + 1);
  }, [setContent, setIsDirty, selectAndScroll]);

  const handleNewSlide = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next.splice(index + 1, 0, '');
      return next;
    }, 'trim'));
    setIsDirty(true);
    selectAndScroll(index + 1);
  }, [setContent, setIsDirty, selectAndScroll]);

  const handleDeleteSlide = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length || segments.length <= 1) return null;
      const next = [...segments];
      next.splice(index, 1);
      return next;
    }, 'trim'));
    setIsDirty(true);
    selectAndScroll(Math.max(0, Math.min(index, slideCount - 2)));
  }, [setContent, setIsDirty, selectAndScroll, slideCount]);

  // Multi-select delete (ThumbnailPanel). Refuses to remove every slide,
  // same guard as the single-slide delete above.
  const handleDeleteMultiple = useCallback((indices: number[]) => {
    if (indices.length === 0) return;
    setContent((prev) => editSlideSegments(prev, (segments) => {
      const toRemove = new Set(indices);
      if (toRemove.size >= segments.length) return null;
      return segments.filter((_, i) => !toRemove.has(i));
    }, 'trim'));
    setIsDirty(true);
    selectAndScroll(Math.max(0, Math.min(Math.min(...indices), slideCount - indices.length - 1)));
  }, [setContent, setIsDirty, selectAndScroll, slideCount]);

  // Multi-select block drag-reorder (ThumbnailPanel). `anchorIndex` is the
  // specific thumbnail the user physically grabbed — its position relative to
  // `toIndex` decides whether the block lands before or after the drop
  // target, the same rule handleSlideReorder's two-step splice produces for
  // a single slide (drag down → land after target; drag up → land before).
  // The landing position is computed up front, synchronously, from the
  // indices alone — not from inside the setContent updater, whose callback
  // may run later (or twice, in StrictMode) rather than during this call.
  const handleReorderMultiple = useCallback((fromIndices: number[], anchorIndex: number, toIndex: number) => {
    if (fromIndices.length === 0 || fromIndices.includes(toIndex)) return;
    const fromSet = new Set(fromIndices);
    let restTargetPos = 0;
    for (let i = 0; i < toIndex; i++) if (!fromSet.has(i)) restTargetPos++;
    const insertAt = anchorIndex < toIndex ? restTargetPos + 1 : restTargetPos;

    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (toIndex < 0 || toIndex >= segments.length) return null;
      for (const i of fromIndices) if (i < 0 || i >= segments.length) return null;
      const moving = [...fromIndices].sort((a, b) => a - b).map((i) => segments[i]);
      const rest = segments.filter((_, i) => !fromSet.has(i));
      const next = [...rest];
      next.splice(insertAt, 0, ...moving);
      return next;
    }, 'trim'));
    setIsDirty(true);
    selectAndScroll(insertAt);
  }, [setContent, setIsDirty, selectAndScroll]);

  // Adds or removes a `<!-- name -->` marker line at the top of one slide.
  const toggleSlideMarker = useCallback((index: number, name: 'hidden' | 'todo') => {
    const re = new RegExp(`<!--\\s*${name}\\s*-->`);
    const lineRe = new RegExp(`[ \\t]*<!--\\s*${name}\\s*-->[ \\t]*\\r?\\n?`);
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      const seg = next[index];
      next[index] = re.test(seg)
        ? seg.replace(lineRe, '')
        : seg.replace(/^(\s*)/, `$1<!-- ${name} -->\n`);
      return next;
    }, 'preserve'));
    setIsDirty(true);
  }, [setContent, setIsDirty]);

  const handleToggleHidden = useCallback((index: number) => toggleSlideMarker(index, 'hidden'), [toggleSlideMarker]);
  const handleToggleTodo = useCallback((index: number) => toggleSlideMarker(index, 'todo'), [toggleSlideMarker]);

  const handleSetSlideBackground = useCallback(async (index: number) => {
    if (!filePath) {
      onWarn(t('editor.saveFirstDropMedia'));
      return;
    }
    const selected = await open({
      filters: [IMAGE_DIALOG_FILTER],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return;

    const relPath = await resolveImagePathForMarkdown(selected, filePath, onWarn);
    if (!relPath) return;

    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next[index] = setSlideBackgroundInRaw(next[index], relPath);
      return next;
    }, 'preserve'));
    setIsDirty(true);
    selectAndScroll(index);
  }, [filePath, onWarn, t, setContent, setIsDirty, selectAndScroll]);

  const handleClearSlideBackground = useCallback((index: number) => {
    setContent((prev) => editSlideSegments(prev, (segments) => {
      if (index < 0 || index >= segments.length) return null;
      const next = [...segments];
      next[index] = setSlideBackgroundInRaw(next[index], null);
      return next;
    }, 'preserve'));
    setIsDirty(true);
    selectAndScroll(index);
  }, [setContent, setIsDirty, selectAndScroll]);

  return {
    handleSlideReorder,
    handleDuplicateSlide,
    handleNewSlide,
    handleDeleteSlide,
    handleDeleteMultiple,
    handleReorderMultiple,
    handleToggleHidden,
    handleToggleTodo,
    handleSetSlideBackground,
    handleClearSlideBackground,
  };
}
