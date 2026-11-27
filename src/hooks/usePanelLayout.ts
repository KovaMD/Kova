// The editor's three resizable panels (thumbnails | editor | inspector): the
// layout persisted across sessions, and Focus Mode, which collapses the side
// panels without that collapse being saved as the user's layout.
import { useCallback, useMemo, useRef, useState } from 'react';
import { usePanelRef, useDefaultLayout } from 'react-resizable-panels';

export const PANEL_IDS = ['thumb', 'editor', 'inspector'] as const;

/**
 * localStorage for the layout, with two guards:
 * - setItem is dropped while `blocked()` (focus mode). collapse() fires
 *   onLayoutChanged synchronously, before React re-renders, so checking state
 *   in that callback is too early; setItem runs inside the library's 100 ms
 *   debounce, by which time React has committed.
 * - getItem discards a saved layout with any panel at size 0: it was saved
 *   while collapsed (an earlier bug) and would restore invisible panels.
 */
export function focusGuardedStorage(blocked: () => boolean, backing: Storage = localStorage): Storage {
  return {
    get length()            { return backing.length; },
    clear()                 { backing.clear(); },
    key(i: number)          { return backing.key(i); },
    removeItem(key: string) { backing.removeItem(key); },
    getItem(key: string) {
      const val = backing.getItem(key);
      if (val) {
        try {
          const parsed = JSON.parse(val) as Record<string, unknown>;
          if (Object.values(parsed).some((v) => v === 0)) {
            backing.removeItem(key);
            return null;
          }
        } catch { /* non-JSON key: pass through */ }
      }
      return val;
    },
    setItem(key: string, val: string) {
      if (!blocked()) backing.setItem(key, val);
    },
  };
}

export function usePanelLayout(showInspector: boolean) {
  const [focusMode, setFocusMode] = useState(false);
  const focusModeRef = useRef(false);
  focusModeRef.current = focusMode;
  const storage = useMemo(() => focusGuardedStorage(() => focusModeRef.current), []);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'kova-main',
    panelIds: [...PANEL_IDS],
    storage,
  });

  const thumbPanelRef     = usePanelRef();
  const inspectorPanelRef = usePanelRef();

  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      if (next) {
        thumbPanelRef.current?.collapse();
        inspectorPanelRef.current?.collapse();
      } else {
        thumbPanelRef.current?.expand();
        if (showInspector) inspectorPanelRef.current?.expand();
      }
      return next;
    });
  }, [thumbPanelRef, inspectorPanelRef, showInspector]);

  return { focusMode, toggleFocusMode, defaultLayout, onLayoutChanged, thumbPanelRef, inspectorPanelRef };
}
