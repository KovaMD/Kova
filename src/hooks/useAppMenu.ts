// The app's menu actions, shared by the native macOS menu bar and the
// in-window FileMenu, plus the macOS menu build itself.
import { useEffect, useRef } from 'react';
import { message } from '@tauri-apps/plugin-dialog';
import { buildMacMenu, delegateMenuActions, type MacMenuLabels, type MenuActions } from '../macMenu';
import { isMac } from '../engine/keybindings';
import { installCliSymlink } from '../platform/ipc';
import type { Translator } from '../i18n';

/** Menu > Install command-line tool: report the result in a dialog. */
export async function installCli(t: Translator): Promise<void> {
  try {
    const dir = await installCliSymlink();
    await message(t('app.cliInstallSuccess', { dir }), { title: 'Kova' });
  } catch (e) {
    await message(t('app.cliInstallFailure', { command: String(e) }), { title: 'Kova', kind: 'error' });
  }
}

export function macMenuLabels(t: Translator): MacMenuLabels {
  return {
    present: t('macMenu.present'),
    view: t('macMenu.view'),
    toggleInspector: t('macMenu.toggleInspector'),
    installCli: t('macMenu.installCli'),
    file: t('app.menuFile'),
    edit: t('app.menuEdit'),
    newFile: t('app.menuNew'),
    open: t('app.menuOpen'),
    openRecent: t('app.menuOpenRecent'),
    noRecentFiles: t('app.menuNoRecentFiles'),
    clearMenu: t('app.menuClearMenu'),
    save: t('app.menuSave'),
    saveAs: t('app.menuSaveAs'),
    import: t('app.menuImport'),
    importFromPowerPoint: t('app.menuImportFromPowerPoint'),
    importFromUrl: t('app.menuImportFromUrl'),
    importFromMarp: t('app.menuImportFromMarp'),
    export: t('app.menuExport'),
    exportPowerpoint: t('app.menuExportPowerpoint'),
    exportPdf: t('app.menuExportPdf'),
    exportHtml: t('app.menuExportHtml'),
    print: t('app.menuPrint'),
  };
}

/**
 * Stable menu actions that always run the latest `handlers`. The native menu
 * is rebuilt only when `recents` (or the locale) changes, so its items
 * delegate through a ref, refreshed every render, to run current logic
 * without rebuilding on every keystroke.
 */
export function useAppMenu(handlers: MenuActions, recents: string[], t: Translator): MenuActions {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const menuActions = useRef(delegateMenuActions(handlersRef)).current;

  useEffect(() => {
    if (!isMac) return;
    void buildMacMenu(menuActions, recents, macMenuLabels(t));
  }, [recents, menuActions, t]);

  return menuActions;
}
