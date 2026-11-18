// Native macOS menu bar. Built once on the Mac (Windows/Linux keep the
// in-window File/Edit buttons). Items call into the shared MenuActions; we rebuild
// only when the recent-files list changes — everything else routes through a
// stable handlers ref, so menu items stay correct without per-state churn.
//
// ponytail: menu items are always enabled and the handlers guard invalid calls
// (e.g. Save with nothing to save). Add per-item setEnabled() if users complain.

import { Menu, Submenu } from '@tauri-apps/api/menu';
import { getVersion } from '@tauri-apps/api/app';
import { recentFileMenuLabel } from './store/recentFiles';

/**
 * Everything the app menus can do. One object serves both menu paths: the
 * native macOS menu bar (buildMacMenu) and the in-window FileMenu used on
 * Windows/Linux. macOS leaves `copyWithAssets` and `exit` unused (its native
 * menu has no Copy with Assets item and uses the built-in Quit).
 */
export interface MenuActions {
  newFile: () => void;
  openFile: () => void;
  openRecent: (path: string) => void;
  clearRecent: () => void;
  save: () => void;
  saveAs: () => void;
  copyWithAssets: () => void;
  import: () => void;
  importUrl: () => void;
  importMarp: () => void;
  export: () => void;
  exportPdf: () => void;
  exportHtml: () => void;
  print: () => void;
  exit: () => void;
  present: () => void;
  toggleInspector: () => void;
  openSettings: () => void;
  installCli: () => void;
}

// Record (not an array) so the compiler rejects a MenuActions key missing here.
const MENU_ACTION_KEYS: Record<keyof MenuActions, true> = {
  newFile: true, openFile: true, openRecent: true, clearRecent: true,
  save: true, saveAs: true, copyWithAssets: true,
  import: true, importUrl: true, importMarp: true,
  export: true, exportPdf: true, exportHtml: true, print: true, exit: true,
  present: true, toggleInspector: true, openSettings: true, installCli: true,
};

/**
 * A MenuActions object whose every method forwards to `ref.current` at call
 * time. Its identity never changes, so menus built once (the native macOS
 * menu) or memoised consumers still run the latest handlers.
 */
export function delegateMenuActions(ref: { readonly current: MenuActions }): MenuActions {
  const delegate = {} as Record<keyof MenuActions, (...args: never[]) => void>;
  for (const key of Object.keys(MENU_ACTION_KEYS) as (keyof MenuActions)[]) {
    delegate[key] = (...args: never[]) => (ref.current[key] as (...a: never[]) => void)(...args);
  }
  return delegate as MenuActions;
}

export interface MacMenuLabels {
  present: string;
  view: string;
  toggleInspector: string;
  installCli: string;
  file: string;
  edit: string;
  newFile: string;
  open: string;
  openRecent: string;
  noRecentFiles: string;
  clearMenu: string;
  save: string;
  saveAs: string;
  import: string;
  importFromPowerPoint: string;
  importFromUrl: string;
  importFromMarp: string;
  export: string;
  exportPowerpoint: string;
  exportPdf: string;
  exportHtml: string;
  print: string;
}

export async function buildMacMenu(h: MenuActions, recents: string[], labels: MacMenuLabels): Promise<void> {
  const version = await getVersion().catch(() => '');

  const recentItems = recents.length
    ? [
        ...recents.map((p) => ({ text: recentFileMenuLabel(p, recents), action: () => h.openRecent(p) })),
        { item: 'Separator' as const },
        { text: labels.clearMenu, action: () => h.clearRecent() },
      ]
    : [{ text: labels.noRecentFiles, enabled: false }];

  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: 'Kova',
        items: [
          { item: { About: { name: 'Kova', version } } },
          { item: 'Separator' },
          { text: 'Settings…', accelerator: 'CmdOrCtrl+,', action: () => h.openSettings() },
          { text: labels.installCli, action: () => h.installCli() },
          { item: 'Separator' },
          { item: 'Services' },
          { item: 'Separator' },
          { item: 'Hide' },
          { item: 'HideOthers' },
          { item: 'ShowAll' },
          { item: 'Separator' },
          { item: 'Quit' },
        ],
      }),
      await Submenu.new({
        text: labels.file,
        items: [
          { text: labels.newFile, accelerator: 'CmdOrCtrl+N', action: () => h.newFile() },
          { text: labels.open, accelerator: 'CmdOrCtrl+O', action: () => h.openFile() },
          await Submenu.new({ text: labels.openRecent, items: recentItems }),
          { item: 'Separator' },
          { text: labels.save, accelerator: 'CmdOrCtrl+S', action: () => h.save() },
          { text: labels.saveAs, accelerator: 'CmdOrCtrl+Shift+S', action: () => h.saveAs() },
          await Submenu.new({
            text: labels.import,
            items: [
              { text: labels.importFromPowerPoint, action: () => h.import() },
              { text: labels.importFromUrl, action: () => h.importUrl() },
              { text: labels.importFromMarp, action: () => h.importMarp() },
            ],
          }),
          { item: 'Separator' },
          await Submenu.new({
            text: labels.export,
            items: [
              { text: labels.exportPowerpoint, action: () => h.export() },
              { text: labels.exportPdf, action: () => h.exportPdf() },
              { text: labels.exportHtml, action: () => h.exportHtml() },
            ],
          }),
          { text: labels.print, accelerator: 'CmdOrCtrl+P', action: () => h.print() },
          { item: 'Separator' },
          { item: 'Quit' },
        ],
      }),
      await Submenu.new({
        text: labels.edit,
        items: [
          { item: 'Undo' },
          { item: 'Redo' },
          { item: 'Separator' },
          { item: 'Cut' },
          { item: 'Copy' },
          { item: 'Paste' },
          { item: 'SelectAll' },
        ],
      }),
      await Submenu.new({
        text: labels.view,
        items: [
          { text: labels.toggleInspector, action: () => h.toggleInspector() },
          { text: labels.present, accelerator: 'F5', action: () => h.present() },
          { item: 'Separator' },
          { item: 'Fullscreen' },
        ],
      }),
      await Submenu.new({
        text: 'Window',
        items: [{ item: 'Minimize' }, { item: 'Maximize' }],
      }),
    ],
  });

  await menu.setAsAppMenu();
}
