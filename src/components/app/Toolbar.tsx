import type { MouseEvent, ReactNode } from 'react';
import { useT } from '../../i18n';
import { formatCombo, isMac } from '../../engine/keybindings';
import { FocusModeIcon, InspectorIcon, SettingsIcon } from '../icons';
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
        <FocusModeIcon />
      </button>
      <button
        className={`wm-btn${showInspector ? ' wm-btn--active' : ''}`}
        onClick={p.onToggleInspector}
        title={t('app.toggleInspector')}
        style={{ marginLeft: 4 }}
      >
        <InspectorIcon />
      </button>
      <button
        className="wm-btn"
        onClick={p.onOpenSettings}
        title={t('app.settingsButtonTitle')}
      >
        <SettingsIcon />
      </button>
      {p.windowControls}
    </div>
  );
}
