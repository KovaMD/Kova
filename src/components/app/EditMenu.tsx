import { useEffect, useRef, useState, type RefObject } from 'react';
import { useT } from '../../i18n';
import { formatCombo, isMac } from '../../engine/keybindings';
import type { EditorHandle } from '../layout/EditorPanel';

export interface EditMenuProps {
  editorRef: RefObject<EditorHandle | null>;
  onFind: () => void;
}

/** In-window Edit menu (Windows/Linux; macOS uses the native menu bar). */
export function EditMenu({ editorRef, onFind }: EditMenuProps) {
  const t = useT();
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const editMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) {
        setEditMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editMenuOpen]);

  return (
    <div className="btn-group" ref={editMenuRef}>
      <button className="btn" onClick={() => setEditMenuOpen((o) => !o)}>
        {t('app.menuEdit')}
      </button>
      {editMenuOpen && (
        <div className="btn-group-menu">
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); editorRef.current?.undo(); }}>
            {t('app.menuUndo')} <span>{formatCombo('ctrl+z')}</span>
          </button>
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); editorRef.current?.redo(); }}>
            {t('app.menuRedo')} <span>{formatCombo(isMac ? 'meta+shift+z' : 'ctrl+y')}</span>
          </button>
          <div className="btn-group-menu-separator" />
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); setTimeout(() => { editorRef.current?.focus(); document.execCommand('cut'); }, 0); }}>
            {t('app.menuCut')} <span>{formatCombo('ctrl+x')}</span>
          </button>
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); setTimeout(() => { editorRef.current?.focus(); document.execCommand('copy'); }, 0); }}>
            {t('app.menuCopy')} <span>{formatCombo('ctrl+c')}</span>
          </button>
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); setTimeout(() => { editorRef.current?.focus(); document.execCommand('paste'); }, 0); }}>
            {t('app.menuPaste')} <span>{formatCombo('ctrl+v')}</span>
          </button>
          <div className="btn-group-menu-separator" />
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); editorRef.current?.selectAll(); }}>
            {t('app.menuSelectAll')} <span>{formatCombo('ctrl+a')}</span>
          </button>
          <div className="btn-group-menu-separator" />
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setEditMenuOpen(false); onFind(); }}>
            {t('editor.findDialogTitle')} <span>{formatCombo('ctrl+f')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
