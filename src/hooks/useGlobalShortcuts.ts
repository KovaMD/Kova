// Editor-wide keyboard shortcuts (new/open/save, focus mode, hide slide, F5
// to present). Inactive while presenting: the overlays own the keyboard then.
import { useEffect, useRef } from 'react';
import { getCombo, matchShortcut, type Keybindings } from '../engine/keybindings';

export interface GlobalShortcutActions {
  newFile: () => void;
  openFile: () => void;
  save: () => void;
  saveAs: () => void;
  toggleFocusMode: () => void;
  /** Hide/unhide the current slide; only bound when the deck has slides. */
  toggleHiddenCurrent?: () => void;
  /** F5 presents; Shift+F5 presents from the current slide (see handlePresentEnter). */
  present: (fromCurrent: boolean) => void;
}

export function useGlobalShortcuts(
  combos: Keybindings['combos'],
  presenting: boolean,
  actions: GlobalShortcutActions,
): void {
  // Latest actions, so the listener needn't re-attach when a handler's
  // identity changes (App passes inline closures).
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    if (presenting) return;
    const sc = (id: string) => getCombo(combos, id);
    const handler = (e: KeyboardEvent) => {
      // Default keybindings all require a modifier, but combos are loaded
      // from a user-editable file with no enforcement that a binding include
      // one: a bare-key rebind must not fire while the user is typing into an
      // input (mirrors the same guard in PresentationOverlay/PresenterOverlay).
      if (e.target instanceof HTMLInputElement) return;
      const { newFile, openFile, save, saveAs, toggleFocusMode, toggleHiddenCurrent, present } = actionsRef.current;
      if (e.key === 'F5') { e.preventDefault(); present(e.shiftKey); return; }
      if (matchShortcut(e, sc('newFile')))   { e.preventDefault(); newFile(); }
      if (matchShortcut(e, sc('openFile')))  { e.preventDefault(); openFile(); }
      if (matchShortcut(e, sc('save')))      { e.preventDefault(); save(); }
      if (matchShortcut(e, sc('saveAs')))    { e.preventDefault(); saveAs(); }
      if (matchShortcut(e, sc('focusMode'))) { e.preventDefault(); toggleFocusMode(); }
      if (toggleHiddenCurrent && matchShortcut(e, sc('hideSlide'))) {
        e.preventDefault();
        toggleHiddenCurrent();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [presenting, combos]);
}
