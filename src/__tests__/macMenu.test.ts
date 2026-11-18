import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MenuActions } from '../macMenu';

interface Item { text?: string; action?: () => void; items?: Item[] }
const built: { items: Item[] }[] = [];

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: vi.fn(async (opts: { items: Item[] }) => { built.push(opts); return { setAsAppMenu: vi.fn(async () => {}) }; }) },
  Submenu: { new: vi.fn(async (opts: Item) => opts) },
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.2.3') }));

const { buildMacMenu, delegateMenuActions } = await import('../macMenu');

const KEYS: (keyof MenuActions)[] = [
  'newFile', 'openFile', 'openRecent', 'clearRecent', 'save', 'saveAs', 'copyWithAssets',
  'import', 'importUrl', 'importMarp', 'export', 'exportPdf', 'exportHtml', 'print', 'exit',
  'present', 'toggleInspector', 'openSettings', 'installCli',
];

function makeActions(): MenuActions {
  return Object.fromEntries(KEYS.map((k) => [k, vi.fn()])) as unknown as MenuActions;
}

const labels = new Proxy({}, { get: (_t, key) => `L:${String(key)}` }) as Parameters<typeof buildMacMenu>[2];

function findItem(items: Item[], text: string): Item | undefined {
  for (const item of items) {
    if (item.text === text) return item;
    const sub = item.items && findItem(item.items, text);
    if (sub) return sub;
  }
  return undefined;
}

describe('delegateMenuActions', () => {
  it('forwards every action to the current target, arguments included', () => {
    const ref = { current: makeActions() };
    const delegate = delegateMenuActions(ref);
    expect(Object.keys(delegate).sort()).toEqual([...KEYS].sort());

    const next = makeActions();
    ref.current = next;
    delegate.openRecent('/docs/a.md');
    delegate.save();
    expect(next.openRecent).toHaveBeenCalledWith('/docs/a.md');
    expect(next.save).toHaveBeenCalledTimes(1);
  });
});

describe('buildMacMenu', () => {
  beforeEach(() => { built.length = 0; });

  it('wires native menu items to the shared MenuActions', async () => {
    const actions = makeActions();
    await buildMacMenu(actions, ['/docs/a.md'], labels);
    const items = built[0].items;
    const cases: [string, keyof MenuActions][] = [
      ['L:newFile', 'newFile'], ['L:open', 'openFile'], ['L:save', 'save'], ['L:saveAs', 'saveAs'],
      ['L:importFromPowerPoint', 'import'], ['L:importFromUrl', 'importUrl'], ['L:importFromMarp', 'importMarp'],
      ['L:exportPowerpoint', 'export'], ['L:exportPdf', 'exportPdf'], ['L:exportHtml', 'exportHtml'],
      ['L:print', 'print'], ['L:present', 'present'], ['L:toggleInspector', 'toggleInspector'],
      ['L:installCli', 'installCli'], ['Settings…', 'openSettings'], ['L:clearMenu', 'clearRecent'],
    ];
    for (const [text, key] of cases) {
      findItem(items, text)!.action!();
      expect(actions[key]).toHaveBeenCalledTimes(1);
    }
    findItem(items, 'a.md')!.action!();
    expect(actions.openRecent).toHaveBeenCalledWith('/docs/a.md');
  });
});
