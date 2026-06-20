// Native macOS menu bar. Built once on the Mac (Windows/Linux keep the
// in-window File/Edit buttons). Items call into App.tsx handlers; we rebuild
// only when the recent-files list changes — everything else routes through a
// stable handlers ref, so menu items stay correct without per-state churn.
//
// ponytail: menu items are always enabled and the handlers guard invalid calls
// (e.g. Save with nothing to save). Add per-item setEnabled() if users complain.

import { Menu, Submenu } from '@tauri-apps/api/menu';
import { getVersion } from '@tauri-apps/api/app';

export interface MacMenuHandlers {
  newFile: () => void;
  openFile: () => void;
  openRecent: (path: string) => void;
  clearRecent: () => void;
  save: () => void;
  saveAs: () => void;
  import: () => void;
  importUrl: () => void;
  importMarp: () => void;
  export: () => void;
  exportPdf: () => void;
  print: () => void;
  present: () => void;
  toggleInspector: () => void;
  openSettings: () => void;
}

const base = (p: string) => p.split(/[\\/]/).pop() || p;

export async function buildMacMenu(h: MacMenuHandlers, recents: string[]): Promise<void> {
  const version = await getVersion().catch(() => '');

  const recentItems = recents.length
    ? [
        ...recents.map((p) => ({ text: base(p), action: () => h.openRecent(p) })),
        { item: 'Separator' as const },
        { text: 'Clear Menu', action: () => h.clearRecent() },
      ]
    : [{ text: 'No Recent Files', enabled: false }];

  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: 'Kova',
        items: [
          { item: { About: { name: 'Kova', version } } },
          { item: 'Separator' },
          { text: 'Settings…', accelerator: 'CmdOrCtrl+,', action: () => h.openSettings() },
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
        text: 'File',
        items: [
          { text: 'New', accelerator: 'CmdOrCtrl+N', action: () => h.newFile() },
          { text: 'Open…', accelerator: 'CmdOrCtrl+O', action: () => h.openFile() },
          await Submenu.new({ text: 'Open Recent', items: recentItems }),
          { item: 'Separator' },
          { text: 'Save', accelerator: 'CmdOrCtrl+S', action: () => h.save() },
          { text: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', action: () => h.saveAs() },
          await Submenu.new({
            text: 'Import',
            items: [
              { text: 'From PowerPoint…', action: () => h.import() },
              { text: 'From URL…', action: () => h.importUrl() },
              { text: 'From Marp…', action: () => h.importMarp() },
            ],
          }),
          { item: 'Separator' },
          { text: 'Export PowerPoint (.pptx)', action: () => h.export() },
          { text: 'Export PDF (.pdf)', action: () => h.exportPdf() },
          { text: 'Print…', accelerator: 'CmdOrCtrl+P', action: () => h.print() },
          { item: 'Separator' },
          { item: 'Quit' },
        ],
      }),
      await Submenu.new({
        text: 'Edit',
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
        text: 'View',
        items: [
          { text: 'Toggle Inspector', action: () => h.toggleInspector() },
          { text: 'Present', accelerator: 'F5', action: () => h.present() },
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
