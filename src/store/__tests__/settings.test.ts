import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSettings, saveSettings } from '../settings';

// vitest runs in a node environment with no browser localStorage — stub it the
// same way recentFiles.test.ts does.
function stubLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
}

describe('settings: Pele as the default diagram renderer', () => {
  beforeEach(stubLocalStorage);
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to Pele on a fresh install', () => {
    expect(loadSettings().diagramRenderer).toBe('pele');
  });

  it('moves a saved v1 Mermaid setting to Pele once', () => {
    localStorage.setItem('kova:settings', JSON.stringify({ settingsVersion: 1, diagramRenderer: 'mermaid', autosave: false }));
    const s = loadSettings();
    expect(s.diagramRenderer).toBe('pele');
    expect(s.settingsVersion).toBe(2);
    expect(s.autosave).toBe(false);
  });

  it('treats unversioned saved settings as v1', () => {
    localStorage.setItem('kova:settings', JSON.stringify({ diagramRenderer: 'mermaid' }));
    expect(loadSettings().diagramRenderer).toBe('pele');
  });

  it('keeps Mermaid once chosen after the migration', () => {
    localStorage.setItem('kova:settings', JSON.stringify({ settingsVersion: 1, diagramRenderer: 'mermaid' }));
    saveSettings({ ...loadSettings(), diagramRenderer: 'mermaid' });
    expect(loadSettings().diagramRenderer).toBe('mermaid');
  });
});
