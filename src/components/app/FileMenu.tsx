import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { formatCombo, getCombo } from '../../engine/keybindings';
import { recentFileMenuLabel } from '../../store/recentFiles';
import type { MenuActions } from '../../macMenu';

export interface FileMenuProps {
  /** Shared with the native macOS menu bar (see macMenu.ts). */
  actions: MenuActions;
  recents: string[];
  filePath: string | null;
  isDirty: boolean;
  hasContent: boolean;
  /** There are slides to export and no PDF export is running (D15). */
  canExport: boolean;
  pdfExporting: boolean;
  printing: boolean;
  combos: Record<string, string>;
}

/** In-window File menu (Windows/Linux; macOS uses the native menu bar). */
export function FileMenu({ actions, recents, filePath, isDirty, hasContent, canExport, pdfExporting, printing, combos }: FileMenuProps) {
  const t = useT();
  const [fileMenuOpen, setFileMenuOpen]       = useState(false);
  const [importSubmenuOpen, setImportSubmenuOpen] = useState(false);
  const [recentSubmenuOpen, setRecentSubmenuOpen] = useState(false);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);

  // Close the menu when the user clicks outside it.
  useEffect(() => {
    if (!fileMenuOpen) {
      setImportSubmenuOpen(false);
      setExportSubmenuOpen(false);
      setRecentSubmenuOpen(false);
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [fileMenuOpen]);

  return (
    <div className="btn-group" ref={fileMenuRef}>
      <button className="btn" onClick={() => setFileMenuOpen((o) => !o)}>
        {t('app.menuFile')}
      </button>
      {fileMenuOpen && (
        <div className="btn-group-menu">
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setFileMenuOpen(false); actions.newFile(); }}>
            {t('app.menuNew')} <span>{formatCombo(getCombo(combos, 'newFile'))}</span>
          </button>
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" onClick={() => { setFileMenuOpen(false); actions.openFile(); }}>
            {t('app.menuOpen')} <span>{formatCombo(getCombo(combos, 'openFile'))}</span>
          </button>
          <div style={{ position: 'relative' }} onMouseEnter={() => setRecentSubmenuOpen(true)} onMouseLeave={() => setRecentSubmenuOpen(false)}>
            <button
              className="btn-group-menu-item btn-group-menu-item--shortcut"
              aria-haspopup="true"
              aria-expanded={recentSubmenuOpen}
              onClick={() => setRecentSubmenuOpen((o) => !o)}
              onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') setRecentSubmenuOpen(true); }}
            >
              {t('app.menuOpenRecent')} <span>›</span>
            </button>
            {recentSubmenuOpen && (
              <div className="btn-group-menu btn-group-menu--sub">
                {recents.length === 0 ? (
                  <button className="btn-group-menu-item" disabled>{t('app.menuNoRecentFiles')}</button>
                ) : (
                  <>
                    {recents.map((path) => (
                      <button
                        key={path}
                        className="btn-group-menu-item"
                        title={path}
                        onClick={() => { setFileMenuOpen(false); actions.openRecent(path); }}
                      >
                        {recentFileMenuLabel(path, recents)}
                      </button>
                    ))}
                    <div className="btn-group-menu-separator" />
                    <button
                      className="btn-group-menu-item"
                      onClick={() => { setFileMenuOpen(false); actions.clearRecent(); }}
                    >
                      {t('app.menuClearMenu')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }} onMouseEnter={() => setImportSubmenuOpen(true)} onMouseLeave={() => setImportSubmenuOpen(false)}>
            <button
              className="btn-group-menu-item btn-group-menu-item--shortcut"
              aria-haspopup="true"
              aria-expanded={importSubmenuOpen}
              onClick={() => setImportSubmenuOpen((o) => !o)}
              onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') setImportSubmenuOpen(true); }}
            >
              {t('app.menuImport')} <span>›</span>
            </button>
            {importSubmenuOpen && (
              <div className="btn-group-menu btn-group-menu--sub">
                <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); actions.import(); }}>
                  {t('app.menuImportFromPowerPoint')}
                </button>
                <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); actions.importUrl(); }}>
                  {t('app.menuImportFromUrl')}
                </button>
                <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); actions.importMarp(); }}>
                  {t('app.menuImportFromMarp')}
                </button>
              </div>
            )}
          </div>
          <div className="btn-group-menu-separator" />
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" disabled={!filePath || !isDirty} onClick={() => { setFileMenuOpen(false); actions.save(); }}>
            {t('app.menuSave')} <span>{formatCombo(getCombo(combos, 'save'))}</span>
          </button>
          <button className="btn-group-menu-item btn-group-menu-item--shortcut" disabled={!hasContent} onClick={() => { setFileMenuOpen(false); actions.saveAs(); }}>
            {t('app.menuSaveAs')} <span>{formatCombo(getCombo(combos, 'saveAs'))}</span>
          </button>
          <button className="btn-group-menu-item" disabled={!filePath} onClick={() => { setFileMenuOpen(false); actions.copyWithAssets(); }}>
            {t('app.menuCopyWithAssets')}
          </button>
          <div className="btn-group-menu-separator" />
          <div style={{ position: 'relative' }} onMouseEnter={() => setExportSubmenuOpen(true)} onMouseLeave={() => setExportSubmenuOpen(false)}>
            <button
              className="btn-group-menu-item btn-group-menu-item--shortcut"
              aria-haspopup="true"
              aria-expanded={exportSubmenuOpen}
              disabled={!canExport}
              onClick={() => setExportSubmenuOpen((o) => !o)}
              onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') setExportSubmenuOpen(true); }}
            >
              {t('app.menuExport')} <span>›</span>
            </button>
            {exportSubmenuOpen && (
              <div className="btn-group-menu btn-group-menu--sub">
                <button className="btn-group-menu-item" disabled={!canExport} onClick={() => { setFileMenuOpen(false); actions.export(); }}>
                  {t('app.menuExportPowerpoint')}
                </button>
                <button className="btn-group-menu-item" disabled={!canExport} onClick={() => { setFileMenuOpen(false); actions.exportPdf(); }}>
                  {pdfExporting ? t('app.menuExportingPdf') : t('app.menuExportPdf')}
                </button>
                <button className="btn-group-menu-item" disabled={!canExport} onClick={() => { setFileMenuOpen(false); actions.exportHtml(); }}>
                  {pdfExporting ? t('app.menuExporting') : t('app.menuExportHtml')}
                </button>
              </div>
            )}
          </div>
          <button className="btn-group-menu-item" disabled={!canExport || printing} onClick={() => { setFileMenuOpen(false); actions.print(); }}>
            {printing ? t('app.menuPreparingPrint') : t('app.menuPrint')}
          </button>
          <div className="btn-group-menu-separator" />
          <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); actions.exit(); }}>
            {t('app.menuExit')}
          </button>
        </div>
      )}
    </div>
  );
}
