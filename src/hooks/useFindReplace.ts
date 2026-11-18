import { useCallback, useRef, useState, type RefObject } from 'react';
import type { EditorHandle } from '../components/layout/EditorPanel';

export type FindMode = 'text' | 'slide';

export interface UseFindReplaceOptions {
  editorRef: RefObject<EditorHandle | null>;
  /** Number of slides in the deck; bounds slide-number mode. */
  slideCount: number;
  /** Called with the zero-based index when slide-number mode jumps. */
  onSelectSlide: (index: number) => void;
}

export interface FindReplaceState {
  open: boolean;
  mode: FindMode;
  query: string;
  showReplace: boolean;
  replaceQuery: string;
  /** Count from the last Replace All, or null when stale or not run. */
  replacedCount: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
  slideCount: number;
  openDialog: () => void;
  close: () => void;
  setMode: (mode: FindMode) => void;
  setQuery: (query: string) => void;
  setShowReplace: (show: boolean) => void;
  setReplaceQuery: (query: string) => void;
  runFind: (dir?: 1 | -1) => void;
  runReplace: () => void;
  runReplaceAll: () => void;
}

const nonDigits = /\D+/g;

/** State and actions for the Find / Replace / go-to-slide dialog. */
export function useFindReplace({ editorRef, slideCount, onSelectSlide }: UseFindReplaceOptions): FindReplaceState {
  const [open, setOpen] = useState(false);
  const [mode, setModeState] = useState<FindMode>('text');
  const [query, setQueryState] = useState('');
  const [showReplace, setShowReplaceState] = useState(false);
  const [replaceQuery, setReplaceQueryState] = useState('');
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openDialog = useCallback(() => {
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    editorRef.current?.focus();
  }, [editorRef]);

  const setMode = useCallback((next: FindMode) => {
    setModeState(next);
    if (next === 'slide') setQueryState((q) => q.replace(nonDigits, ''));
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(mode === 'slide' ? next.replace(nonDigits, '') : next);
    setReplacedCount(null);
  }, [mode]);

  const setShowReplace = useCallback((show: boolean) => {
    setShowReplaceState(show);
    setReplacedCount(null);
  }, []);

  const setReplaceQuery = useCallback((next: string) => {
    setReplaceQueryState(next);
    setReplacedCount(null);
  }, []);

  const runFind = useCallback((dir: 1 | -1 = 1) => {
    if (mode === 'slide') {
      const trimmed = query.trim();
      if (!/^\d+$/.test(trimmed)) return;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 1 || n > slideCount) return;
      const idx = n - 1;
      onSelectSlide(idx);
      setTimeout(() => editorRef.current?.scrollToSlide(idx), 50);
      setOpen(false);
      editorRef.current?.focus();
      return;
    }
    editorRef.current?.findNext(query, dir);
  }, [mode, query, slideCount, onSelectSlide, editorRef]);

  const runReplace = useCallback(() => {
    if (!query.trim()) return;
    setReplacedCount(null);
    editorRef.current?.replaceCurrent(query, replaceQuery);
  }, [query, replaceQuery, editorRef]);

  const runReplaceAll = useCallback(() => {
    if (!query.trim()) return;
    const count = editorRef.current?.replaceAll(query, replaceQuery) ?? 0;
    setReplacedCount(count);
  }, [query, replaceQuery, editorRef]);

  return {
    open, mode, query, showReplace, replaceQuery, replacedCount, inputRef, slideCount,
    openDialog, close, setMode, setQuery, setShowReplace, setReplaceQuery,
    runFind, runReplace, runReplaceAll,
  };
}
