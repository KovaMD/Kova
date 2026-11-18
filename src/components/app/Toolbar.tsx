import type { MouseEvent, ReactNode } from 'react';
import { useT } from '../../i18n';
import { formatCombo, isMac } from '../../engine/keybindings';
import { basename } from '../../engine/paths';

export interface ToolbarProps {
  /** In-window File/Edit menus (omitted on macOS, which uses the native menu bar). */
  menus?: ReactNode;
  /** Custom window buttons (omitted on macOS, which uses native traffic lights). */
  windowControls?: ReactNode;
  filePath: string | null;
  isDirty: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameStart: (initialValue: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  canPresent: boolean;
  onPresent: (e: MouseEvent) => void;
  focusMode: boolean;
  focusModeCombo: string;
  onToggleFocusMode: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
  onOpenSettings: () => void;
}

/** The app's top bar: menus, document title, Present and panel toggles. */
export function Toolbar(p: ToolbarProps) {
  const t = useT();
  const { filePath, isDirty, focusMode, showInspector } = p;
  return (
    <div className="app-toolbar">
      {/* macOS uses native traffic lights (titleBarStyle: Overlay) + the native
          menu bar, so reserve a draggable strip for the lights and drop the
          custom window buttons + in-window File/Edit menus here. */}
      {isMac && <div className="mac-traffic-pad" data-tauri-drag-region />}
      {p.menus}
      <div className="toolbar-spacer" data-tauri-drag-region />
      {p.isRenaming ? (
        <input
          className="toolbar-doctitle toolbar-doctitle--editing"
          value={p.renameValue}
          autoFocus
          onChange={(e) => p.onRenameChange(e.target.value)}
          onBlur={p.onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); p.onRenameCommit(); }
            if (e.key === 'Escape') { e.preventDefault(); p.onRenameCancel(); }
          }}
        />
      ) : (
        <div
          className="toolbar-doctitle"
          onDoubleClick={() => {
            if (!filePath) return;
            const base = basename(filePath);
            p.onRenameStart(base.replace(/\.(md|markdown)$/i, ''));
          }}
        >
          {filePath ? basename(filePath) : t('app.untitledFilename')}{isDirty ? ' *' : ''}
        </div>
      )}
      <button
        className="btn btn-primary"
        onClick={p.onPresent}
        disabled={!p.canPresent}
        title={t('app.presentButtonTitle')}
      >{t('app.presentButton')}</button>
      <button
        className="wm-btn"
        onClick={p.onToggleFocusMode}
        title={focusMode
          ? t('app.exitFocusMode', { combo: formatCombo(p.focusModeCombo) })
          : t('app.enterFocusMode', { combo: formatCombo(p.focusModeCombo) })}
        style={{ marginLeft: 4, color: focusMode ? 'var(--accent)' : undefined }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
          <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
          <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
          <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
        </svg>
      </button>
      <button
        className={`wm-btn${showInspector ? ' wm-btn--active' : ''}`}
        onClick={p.onToggleInspector}
        title={t('app.toggleInspector')}
        style={{ marginLeft: 4 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="8" strokeWidth="2"/>
          <line x1="12" y1="12" x2="12" y2="16"/>
        </svg>
      </button>
      <button
        className="wm-btn"
        onClick={p.onOpenSettings}
        title={t('app.settingsButtonTitle')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      {p.windowControls}
    </div>
  );
}
