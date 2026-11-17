import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import * as ipc from '../ipc';

// [wrapper call, expected command name, expected argument object (undefined = none)]
const cases: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['readFile', () => ipc.readFile('/a.md'), 'read_file', { path: '/a.md' }],
  ['writeFile', () => ipc.writeFile('/a.md', 'x'), 'write_file', { path: '/a.md', content: 'x' }],
  ['startWatching', () => ipc.startWatching('/a.md'), 'start_watching', { path: '/a.md' }],
  ['renameFile', () => ipc.renameFile('/a', '/b'), 'rename_file', { oldPath: '/a', newPath: '/b' }],
  ['stopWatching', () => ipc.stopWatching(), 'stop_watching', undefined],
  ['pathExists', () => ipc.pathExists('/a'), 'path_exists', { path: '/a' }],
  ['takePendingOpen', () => ipc.takePendingOpen(), 'take_pending_open', undefined],
  ['takePendingCli', () => ipc.takePendingCli(), 'take_pending_cli', undefined],
  ['loadKeybindings', () => ipc.loadKeybindings(), 'load_keybindings', undefined],
  ['loadCustomThemes', () => ipc.loadCustomThemes(), 'load_custom_themes', undefined],
  ['startWatchingThemes', () => ipc.startWatchingThemes(), 'start_watching_themes', undefined],
  ['saveTheme', () => ipc.saveTheme('t', 'y: 1'), 'save_theme', { id: 't', yaml: 'y: 1' }],
  ['deleteTheme', () => ipc.deleteTheme('t'), 'delete_theme', { id: 't' }],
  ['downloadAndCacheFont', () => ipc.downloadAndCacheFont('https://f', 'abc'), 'download_and_cache_font', { url: 'https://f', sha256: 'abc' }],
  ['listSystemFonts', () => ipc.listSystemFonts(), 'list_system_fonts', undefined],
  ['writeFileBytes', () => ipc.writeFileBytes('/a.pdf', 'QQ=='), 'write_file_bytes', { path: '/a.pdf', data: 'QQ==' }],
  ['readFileB64', () => ipc.readFileB64('/a.png'), 'read_file_b64', { path: '/a.png' }],
  ['writeAssetBytes', () => ipc.writeAssetBytes({ data: 'QQ==', filename: 'p.png', destDir: '/d' }), 'write_asset_bytes', { data: 'QQ==', filename: 'p.png', destDir: '/d' }],
  ['copyImageToAssets', () => ipc.copyImageToAssets('/i.png', '/d'), 'copy_image_to_assets', { src: '/i.png', destDir: '/d' }],
  ['copyFileWithAssets', () => ipc.copyFileWithAssets({ srcPath: '/a.md', content: 'c', destPath: '/b.md', assetRefs: ['x.png'] }), 'copy_file_with_assets', { srcPath: '/a.md', content: 'c', destPath: '/b.md', assetRefs: ['x.png'] }],
  ['setupAudienceWindow', () => ipc.setupAudienceWindow({ x: 1, y: 2, physicalX: 3, physicalY: 4 }), 'setup_audience_window', { x: 1, y: 2, physicalX: 3, physicalY: 4 }],
  ['setWakeLock', () => ipc.setWakeLock(true), 'set_wake_lock', { active: true }],
  ['canSelfUpdate', () => ipc.canSelfUpdate(), 'can_self_update', undefined],
  ['restartApp', () => ipc.restartApp(), 'restart_app', undefined],
  ['confirmExit', () => ipc.confirmExit(), 'confirm_exit', undefined],
  ['cliExit without message', () => ipc.cliExit(0), 'cli_exit', { code: 0 }],
  ['cliExit with message', () => ipc.cliExit(1, 'boom'), 'cli_exit', { message: 'boom', code: 1 }],
  ['cliStdout', () => ipc.cliStdout('ok'), 'cli_stdout', { text: 'ok' }],
  ['installCliSymlink', () => ipc.installCliSymlink(), 'install_cli_symlink', undefined],
  ['readClipboardImage', () => ipc.readClipboardImage(), 'read_clipboard_image', undefined],
  ['readClipboardText', () => ipc.readClipboardText(), 'read_clipboard_text', undefined],
  ['fetchUrlB64', () => ipc.fetchUrlB64('https://x'), 'fetch_url_b64', { url: 'https://x' }],
  ['fetchUrlText', () => ipc.fetchUrlText('https://x'), 'fetch_url_text', { url: 'https://x' }],
  ['probeUrl', () => ipc.probeUrl('https://x'), 'probe_url', { url: 'https://x' }],
  [
    'exportPdfNative',
    () => ipc.exportPdfNative({ htmlContent: '<p/>', outputPath: '/o.pdf', widthMm: 297, heightMm: 167, pageCount: 3, pageWidthPx: 1123, pageHeightPx: 632 }),
    'export_pdf_native',
    { htmlContent: '<p/>', outputPath: '/o.pdf', widthMm: 297, heightMm: 167, pageCount: 3, pageWidthPx: 1123, pageHeightPx: 632 },
  ],
];

describe('typed IPC wrappers', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('result');
  });

  it.each(cases)('%s passes the right command and arguments', async (_label, call, name, args) => {
    await expect(call()).resolves.toBe('result');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    if (args === undefined) {
      expect(invokeMock).toHaveBeenCalledWith(name);
    } else {
      expect(invokeMock).toHaveBeenCalledWith(name, args);
    }
  });

  it('covers every command in the map', () => {
    expect(new Set(cases.map(([, , name]) => name))).toEqual(new Set(Object.keys(ipc.commands)));
  });

  it('maps each command name to the wrapper that invokes it', async () => {
    for (const [name, fn] of Object.entries(ipc.commands)) {
      invokeMock.mockClear();
      // Argument values do not matter here; only the command name is checked.
      await (fn as (...a: unknown[]) => Promise<unknown>)('a', 'b');
      expect(invokeMock.mock.calls[0][0], name).toBe(name);
    }
  });

  it('propagates rejections from invoke', async () => {
    invokeMock.mockRejectedValueOnce('denied');
    await expect(ipc.readFile('/x')).rejects.toBe('denied');
  });
});
