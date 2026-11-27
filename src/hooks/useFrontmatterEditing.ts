// Inspector edits that rewrite the document's frontmatter (theme, theme
// overrides, title/author/date, aspect ratio). The edits themselves are pure
// functions in engine/parser/frontmatterEdits; this hook applies them to the
// document and marks it dirty when one actually changed something.
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  applyThemeOverridePatch,
  cycleAspectRatio,
  setMetaField,
  switchTheme,
} from '../engine/parser/frontmatterEdits';
import type { ThemeOverridePatch } from '../engine/theme';

export interface UseFrontmatterEditingOptions {
  setContent: Dispatch<SetStateAction<string>>;
  setIsDirty: (dirty: boolean) => void;
  /** useThemeState's selected-theme setter, updated with the document. */
  setActiveThemeId: (id: string) => void;
}

export function useFrontmatterEditing({ setContent, setIsDirty, setActiveThemeId }: UseFrontmatterEditingOptions) {
  const edit = useCallback((apply: (prev: string) => string) => {
    setContent((prev) => {
      const next = apply(prev);
      if (next !== prev) setIsDirty(true);
      return next;
    });
  }, [setContent, setIsDirty]);

  const handleThemeSelect = useCallback((id: string) => {
    setActiveThemeId(id);
    edit((prev) => switchTheme(prev, id));
  }, [setActiveThemeId, edit]);

  // Writing straight to the frontmatter keeps the editor's YAML and the
  // inspector in lock-step.
  const handleThemeChange = useCallback((patch: ThemeOverridePatch) => {
    edit((prev) => applyThemeOverridePatch(prev, patch));
  }, [edit]);

  const handleMetaChange = useCallback((field: 'title' | 'author' | 'date', value: string) => {
    edit((prev) => setMetaField(prev, field, value));
  }, [edit]);

  const handleAspectRatioCycle = useCallback(() => {
    edit(cycleAspectRatio);
  }, [edit]);

  return { handleThemeSelect, handleThemeChange, handleMetaChange, handleAspectRatioCycle };
}
