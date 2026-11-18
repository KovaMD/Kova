import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, checkMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), checkMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }));

import { tauriEnginePorts as ports, toAssetUrl, installTauriEnginePorts } from '../enginePorts';
import { enginePorts, installEnginePorts } from '../../engine/ports';

beforeEach(() => { invokeMock.mockReset(); invokeMock.mockResolvedValue(undefined); checkMock.mockReset(); });

// Each port method must reach the same Rust command (and payload) the engine
// used to call directly before P3-04.
const cases: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['assets.readFileB64', () => ports.assets.readFileB64('/a.png'), 'read_file_b64', { path: '/a.png' }],
  ['assets.fetchUrlB64', () => ports.assets.fetchUrlB64('https://x/a.png'), 'fetch_url_b64', { url: 'https://x/a.png' }],
  ['files.readFileB64', () => ports.files.readFileB64('/d.pptx'), 'read_file_b64', { path: '/d.pptx' }],
  ['files.writeAssetBytes', () => ports.files.writeAssetBytes({ data: 'QQ==', filename: 'p.png', destDir: '/d' }), 'write_asset_bytes', { data: 'QQ==', filename: 'p.png', destDir: '/d' }],
  ['keybindings.loadKeybindings', () => ports.keybindings.loadKeybindings(), 'load_keybindings', undefined],
  ['updates.canSelfUpdate', () => ports.updates.canSelfUpdate(), 'can_self_update', undefined],
  ['updates.restartApp', () => ports.updates.restartApp(), 'restart_app', undefined],
];

describe('tauriEnginePorts', () => {
  it.each(cases)('%s invokes the matching command', async (_name, call, cmd, args) => {
    await call();
    if (args === undefined) expect(invokeMock).toHaveBeenCalledWith(cmd);
    else expect(invokeMock).toHaveBeenCalledWith(cmd, args);
  });

  it('pdf.exportPdfNative forwards the print args', async () => {
    const args = {
      htmlContent: '<p>x</p>', outputPath: '/o.pdf',
      page: { widthMm: 1, heightMm: 2, pageCount: 3, pageWidthPx: 4, pageHeightPx: 5 },
    };
    await ports.pdf.exportPdfNative(args);
    expect(invokeMock).toHaveBeenCalledWith('export_pdf_native', expect.objectContaining(args));
  });

  it('updates.check delegates to the updater plugin', async () => {
    checkMock.mockResolvedValue(null);
    expect(await ports.updates.check({ timeout: 15_000 })).toBeNull();
    expect(checkMock).toHaveBeenCalledWith({ timeout: 15_000 });
  });

  it('toAssetUrl uses convertFileSrc', () => {
    expect(toAssetUrl('/a b.png')).toBe('asset://localhost/%2Fa%20b.png');
  });

  it('installTauriEnginePorts makes them the engine default', () => {
    const before = enginePorts();
    installTauriEnginePorts();
    expect(enginePorts()).toBe(ports);
    installEnginePorts(before);
  });
});
