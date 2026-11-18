// Tauri-backed implementations of the engine ports (src/engine/ports.ts).
//
// The engine is platform-free: it only knows the port interfaces. This file
// is the one place that binds them to Tauri, and src/main.tsx (the
// composition root) installs it at startup with installTauriEnginePorts().
import { convertFileSrc } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import * as ipc from './ipc';
import { installEnginePorts, type EnginePorts } from '../engine/ports';
import type { ToAssetUrl } from '../engine/resolveMediaPath';

export const tauriEnginePorts: EnginePorts = {
  assets: {
    readFileB64: (path) => ipc.readFileB64(path),
    fetchUrlB64: (url) => ipc.fetchUrlB64(url),
  },
  files: {
    readFileB64: (path) => ipc.readFileB64(path),
    writeAssetBytes: (args) => ipc.writeAssetBytes(args),
  },
  pdf: {
    exportPdfNative: (args) => ipc.exportPdfNative(args),
  },
  keybindings: {
    loadKeybindings: () => ipc.loadKeybindings(),
  },
  updates: {
    check: (options) => check(options),
    canSelfUpdate: () => ipc.canSelfUpdate(),
    restartApp: () => ipc.restartApp(),
  },
};

/** Synchronous path → webview URL conversion, injected into resolveImageSrc. */
export const toAssetUrl: ToAssetUrl = (path) => convertFileSrc(path);

export function installTauriEnginePorts(): void {
  installEnginePorts(tauriEnginePorts);
}
