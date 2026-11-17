// Typed wrappers for every Tauri command registered in
// `tauri::generate_handler![...]` (src-tauri/src/lib.rs). Each wrapper is a
// thin `invoke` with exactly the argument object existing callers send, so
// migrating a call site to it is behaviour-neutral.
//
// Argument names: Tauri converts snake_case Rust parameter names to camelCase
// on the JS side (no command here sets `rename_all`), so `dest_dir` is passed
// as `destDir`. Serde-serialised return structs keep their Rust field names
// (see PendingCli in src/types/cli.ts).
//
// The `commands` map is keyed by the Rust command name;
// src/platform/__tests__/ipcCommandList.test.ts checks its keys against the
// generate_handler! list, so keep the two in step.
import { invoke } from '@tauri-apps/api/core';
import type { PendingCli } from '../types/cli';

// ── Payload types ────────────────────────────────────────────────────────────

export interface PathArgs { path: string }
export interface UrlArgs { url: string }
export interface ThemeIdArgs { id: string }

export interface WriteFileArgs { path: string; content: string }
export interface RenameFileArgs { oldPath: string; newPath: string }
export interface WriteFileBytesArgs {
  path: string;
  /** Base64-encoded file contents. */
  data: string;
}
export interface WriteAssetBytesArgs {
  /** Base64-encoded file contents. */
  data: string;
  /** Suggested file name; Rust may adjust it to avoid collisions. */
  filename: string;
  /** Directory of the document; the file lands in `<destDir>/assets/`. */
  destDir: string;
}
export interface CopyImageToAssetsArgs { src: string; destDir: string }
export interface CopyFileWithAssetsArgs {
  srcPath: string;
  content: string;
  destPath: string;
  assetRefs: string[];
}
export interface SetupAudienceWindowArgs {
  /** Logical coordinates of the target monitor. */
  x: number;
  y: number;
  /** Physical coordinates (Rust `_physical_x` / `_physical_y`). */
  physicalX: number;
  physicalY: number;
}
export interface SaveThemeArgs { id: string; yaml: string }
export interface DownloadAndCacheFontArgs { url: string; sha256: string }
export interface SetWakeLockArgs { active: boolean }
export interface CliExitArgs { message?: string; code: number }
export interface CliStdoutArgs { text: string }
export interface ExportPdfNativeArgs {
  htmlContent: string;
  outputPath: string;
  widthMm: number;
  heightMm: number;
  pageCount: number;
  pageWidthPx: number;
  pageHeightPx: number;
}

// ── Result types ─────────────────────────────────────────────────────────────

/** `[configFilePath, yamlContent]` from load_keybindings. */
export type KeybindingsFile = [path: string, content: string];
/** `[themesDir, [fileName, yaml][]]` from load_custom_themes. */
export type CustomThemesResult = [dir: string, entries: Array<[name: string, yaml: string]>];
/** `[base64, mimeType]` from fetch_url_b64. */
export type FetchedB64 = [b64: string, mime: string];

// ── Wrappers ─────────────────────────────────────────────────────────────────

// file.rs
export const readFile = (path: string) => invoke<string>('read_file', { path } satisfies PathArgs);
export const writeFile = (path: string, content: string) =>
  invoke<void>('write_file', { path, content } satisfies WriteFileArgs);
export const startWatching = (path: string) => invoke<void>('start_watching', { path } satisfies PathArgs);
export const renameFile = (oldPath: string, newPath: string) =>
  invoke<void>('rename_file', { oldPath, newPath } satisfies RenameFileArgs);
export const stopWatching = () => invoke<void>('stop_watching');
export const pathExists = (path: string) => invoke<boolean>('path_exists', { path } satisfies PathArgs);
export const takePendingOpen = () => invoke<string[]>('take_pending_open');
export const takePendingCli = () => invoke<PendingCli | null>('take_pending_cli');

// config.rs
export const loadKeybindings = () => invoke<KeybindingsFile>('load_keybindings');
export const loadCustomThemes = () => invoke<CustomThemesResult>('load_custom_themes');
export const startWatchingThemes = () => invoke<void>('start_watching_themes');
export const saveTheme = (id: string, yaml: string) =>
  invoke<void>('save_theme', { id, yaml } satisfies SaveThemeArgs);
export const deleteTheme = (id: string) => invoke<void>('delete_theme', { id } satisfies ThemeIdArgs);
export const downloadAndCacheFont = (url: string, sha256: string) =>
  invoke<string>('download_and_cache_font', { url, sha256 } satisfies DownloadAndCacheFontArgs);

// fonts.rs
export const listSystemFonts = () => invoke<string[]>('list_system_fonts');

// assets.rs
export const writeFileBytes = (path: string, data: string) =>
  invoke<void>('write_file_bytes', { path, data } satisfies WriteFileBytesArgs);
export const readFileB64 = (path: string) => invoke<string>('read_file_b64', { path } satisfies PathArgs);
/** Resolves to the file name actually written inside `<destDir>/assets/`. */
export const writeAssetBytes = (args: WriteAssetBytesArgs) =>
  invoke<string>('write_asset_bytes', { ...args });
/** Resolves to the file name actually written inside `<destDir>/assets/`. */
export const copyImageToAssets = (src: string, destDir: string) =>
  invoke<string>('copy_image_to_assets', { src, destDir } satisfies CopyImageToAssetsArgs);
export const copyFileWithAssets = (args: CopyFileWithAssetsArgs) =>
  invoke<void>('copy_file_with_assets', { ...args });

// window.rs
export const setupAudienceWindow = (args: SetupAudienceWindowArgs) =>
  invoke<void>('setup_audience_window', { ...args });
export const setWakeLock = (active: boolean) =>
  invoke<void>('set_wake_lock', { active } satisfies SetWakeLockArgs);

// lifecycle.rs
export const canSelfUpdate = () => invoke<boolean>('can_self_update');
export const restartApp = () => invoke<void>('restart_app');
export const confirmExit = () => invoke<void>('confirm_exit');
/**
 * Exits the process with `code`, printing `message` to stderr if given.
 * Omits `message` from the payload when undefined, as current callers do.
 */
export const cliExit = (code: number, message?: string) =>
  invoke<void>('cli_exit', (message === undefined ? { code } : { message, code }) satisfies CliExitArgs);
export const cliStdout = (text: string) => invoke<void>('cli_stdout', { text } satisfies CliStdoutArgs);
/** Resolves to the directory the `kova` symlink was installed into. */
export const installCliSymlink = () => invoke<string>('install_cli_symlink');

// clipboard.rs
/** Resolves to base64-encoded PNG data. */
export const readClipboardImage = () => invoke<string>('read_clipboard_image');
export const readClipboardText = () => invoke<string>('read_clipboard_text');

// network.rs
export const fetchUrlB64 = (url: string) => invoke<FetchedB64>('fetch_url_b64', { url } satisfies UrlArgs);
export const fetchUrlText = (url: string) => invoke<string>('fetch_url_text', { url } satisfies UrlArgs);
export const probeUrl = (url: string) => invoke<void>('probe_url', { url } satisfies UrlArgs);

// pdf.rs
export const exportPdfNative = (args: ExportPdfNativeArgs) =>
  invoke<void>('export_pdf_native', { ...args });

// ── Command map ──────────────────────────────────────────────────────────────

/** Every wrapper, keyed by its Rust command name. */
export const commands = {
  read_file: readFile,
  write_file: writeFile,
  start_watching: startWatching,
  rename_file: renameFile,
  stop_watching: stopWatching,
  load_keybindings: loadKeybindings,
  load_custom_themes: loadCustomThemes,
  start_watching_themes: startWatchingThemes,
  list_system_fonts: listSystemFonts,
  write_file_bytes: writeFileBytes,
  read_file_b64: readFileB64,
  write_asset_bytes: writeAssetBytes,
  copy_image_to_assets: copyImageToAssets,
  copy_file_with_assets: copyFileWithAssets,
  setup_audience_window: setupAudienceWindow,
  can_self_update: canSelfUpdate,
  restart_app: restartApp,
  save_theme: saveTheme,
  delete_theme: deleteTheme,
  download_and_cache_font: downloadAndCacheFont,
  set_wake_lock: setWakeLock,
  read_clipboard_image: readClipboardImage,
  read_clipboard_text: readClipboardText,
  fetch_url_b64: fetchUrlB64,
  fetch_url_text: fetchUrlText,
  probe_url: probeUrl,
  confirm_exit: confirmExit,
  cli_exit: cliExit,
  cli_stdout: cliStdout,
  install_cli_symlink: installCliSymlink,
  path_exists: pathExists,
  take_pending_open: takePendingOpen,
  take_pending_cli: takePendingCli,
  export_pdf_native: exportPdfNative,
} as const;

export type CommandName = keyof typeof commands;
