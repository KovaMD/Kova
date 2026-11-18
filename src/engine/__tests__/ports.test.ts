import { describe, it, expect, afterEach } from 'vitest';
import { enginePorts, installEnginePorts, UNINSTALLED_PORTS, type EnginePorts } from '../ports';

describe('engine ports registry', () => {
  const before = enginePorts();
  afterEach(() => installEnginePorts(before));

  it('rejects every call until real ports are installed', async () => {
    installEnginePorts(UNINSTALLED_PORTS);
    const p = enginePorts();
    await expect(p.assets.readFileB64('/x.png')).rejects.toThrow(/not installed/);
    await expect(p.assets.fetchUrlB64('https://x')).rejects.toThrow(/not installed/);
    await expect(p.files.writeAssetBytes({ data: '', filename: 'a', destDir: '/' })).rejects.toThrow(/not installed/);
    await expect(p.pdf.exportPdfNative({
      htmlContent: '', outputPath: '',
      page: { widthMm: 0, heightMm: 0, pageCount: 0, pageWidthPx: 0, pageHeightPx: 0 },
    })).rejects.toThrow(/not installed/);
    await expect(p.keybindings.loadKeybindings()).rejects.toThrow(/not installed/);
    await expect(p.updates.check({ timeout: 1 })).rejects.toThrow(/not installed/);
  });

  it('returns whatever the composition root installed', async () => {
    const fake: EnginePorts = {
      ...UNINSTALLED_PORTS,
      assets: { readFileB64: async (p) => `b64:${p}`, fetchUrlB64: async (u) => [`b64:${u}`, 'image/png'] },
    };
    installEnginePorts(fake);
    expect(enginePorts()).toBe(fake);
    expect(await enginePorts().assets.readFileB64('/a')).toBe('b64:/a');
  });
});
