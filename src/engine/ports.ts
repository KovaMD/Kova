// Engine ports (refactor card P3-04, PRD section 5.6 / P3.3).
//
// The engine never talks to Tauri or src/platform directly. Instead it
// depends on the small interfaces below, and the app's composition root
// (src/main.tsx, via src/platform/enginePorts.ts) installs the Tauri-backed
// implementations at startup. Engine functions that tests care about also
// take the relevant port as an optional parameter, so a test can hand in an
// in-memory fake instead of mocking modules.
//
// An ESLint rule (eslint.config.js) stops src/engine from importing
// @tauri-apps/* or src/platform/*, which keeps this boundary honest.

/** Reads local files and remote URLs as base64 (images, videos, fonts). */
export interface AssetLoader {
  /** Read a local file and return its bytes as base64. */
  readFileB64(path: string): Promise<string>;
  /** Fetch a remote URL natively and return `[base64, mimeType]`. */
  fetchUrlB64(url: string): Promise<[b64: string, mime: string]>;
}

export interface WriteAssetArgs {
  /** Base64-encoded file contents. */
  data: string;
  /** Suggested file name; the platform may adjust it to avoid collisions. */
  filename: string;
  /** Directory of the document; the file lands in `<destDir>/assets/`. */
  destDir: string;
}

/** File access the PPTX importer needs: read the deck, write extracted media. */
export interface FileSystem {
  readFileB64(path: string): Promise<string>;
  /** Write bytes into the document's assets folder; resolves to the saved file name. */
  writeAssetBytes(args: WriteAssetArgs): Promise<string>;
}

export interface PdfPageSpec {
  widthMm: number;
  heightMm: number;
  pageCount: number;
  pageWidthPx: number;
  pageHeightPx: number;
}

export interface PrintPdfArgs {
  htmlContent: string;
  outputPath: string;
  page: PdfPageSpec;
}

/** Renders a self-contained HTML document to a PDF file natively. */
export interface PdfPrinter {
  exportPdfNative(args: PrintPdfArgs): Promise<void>;
}

/** Reads the user's keybindings file (created from defaults if absent). */
export interface KeybindingsStore {
  /** Resolves to `[configFilePath, yamlContent]`. */
  loadKeybindings(): Promise<[path: string, content: string]>;
}

/** Download progress events, mirroring the updater plugin's shape. */
export type UpdateDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

/** A pending update as reported by the platform updater. */
export interface PendingUpdate {
  version: string;
  downloadAndInstall(
    onEvent: (event: UpdateDownloadEvent) => void,
    options: { timeout: number },
  ): Promise<void>;
}

/** Self-update support. */
export interface UpdateService {
  /** Check for an update; resolves to null when already up to date. */
  check(options: { timeout: number }): Promise<PendingUpdate | null>;
  canSelfUpdate(): Promise<boolean>;
  restartApp(): Promise<void>;
}

export interface EnginePorts {
  assets: AssetLoader;
  files: FileSystem;
  pdf: PdfPrinter;
  keybindings: KeybindingsStore;
  updates: UpdateService;
}

function notInstalled(): never {
  throw new Error('Engine ports not installed: call installEnginePorts() from the composition root');
}

const unavailable = async (): Promise<never> => notInstalled();

/**
 * Placeholder used until the composition root installs real ports. Every
 * call rejects, which the export code already tolerates (it falls back to
 * the original src), so a forgotten install fails loudly but safely.
 */
export const UNINSTALLED_PORTS: EnginePorts = {
  assets: { readFileB64: unavailable, fetchUrlB64: unavailable },
  files: { readFileB64: unavailable, writeAssetBytes: unavailable },
  pdf: { exportPdfNative: unavailable },
  keybindings: { loadKeybindings: unavailable },
  updates: { check: unavailable, canSelfUpdate: unavailable, restartApp: unavailable },
};

let installed: EnginePorts = UNINSTALLED_PORTS;

/** Install the platform implementations. Called once by the composition root. */
export function installEnginePorts(ports: EnginePorts): void {
  installed = ports;
}

/** The currently installed ports (read at call time, never cached by callers). */
export function enginePorts(): EnginePorts {
  return installed;
}
