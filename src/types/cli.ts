// Mirrors PendingCli / ThemeArg in src-tauri/src/cli.rs (serde-serialised,
// drained once via the take_pending_cli command). Keep the two in sync.

export type CliThemeArg =
  | { type: 'named'; name: string }
  | { type: 'path'; path: string };

export type CliImportFormat = 'marp' | 'pptx' | 'url';

export interface PendingImport {
  format: CliImportFormat;
  /** Canonicalised path for marp/pptx; the raw URL, unchanged, for url. */
  input: string;
  /** Absolute path — not required to exist yet, it's the file being written. */
  output: string;
  /** `--force`: allow overwriting an existing output file. */
  force: boolean;
}

export type CliExportFormat = 'pptx' | 'pdf' | 'html';

export interface PendingExport {
  format: CliExportFormat;
  /** Canonicalised path — must already exist, unlike import's url case. */
  input: string;
  /** Absolute path — not required to exist yet, it's the file being written. */
  output: string;
  /** `--notes`: speaker-notes handout (PDF only). */
  notes: boolean;
  /** `--per-page` 1|2|4|6 (PDF only). */
  per_page: number | null;
  /** `--paper` a4|letter|slide (PDF only). */
  paper: string | null;
}

export interface PendingCli {
  /** Canonicalised absolute path to present (`kova --present FILE`). */
  present: string | null;
  /** `--theme` override; applied in place of the deck's frontmatter theme. */
  theme: CliThemeArg | null;
  /** `--check` given as a modifier: validate before running the action. */
  check: boolean;
  /** Canonicalised absolute path for standalone `kova --check FILE`. */
  check_only: string | null;
  /** `kova --import marp|pptx|url IN OUT`. */
  import: PendingImport | null;
  /** `kova --export pptx|pdf IN OUT`. */
  export: PendingExport | null;
}

// Field lists for the contract test (src/__tests__/cliContract.test.ts),
// which checks them against a fixture serialised by the Rust side. They live
// here rather than in the test because tsconfig excludes *.test.ts from
// `tsc`: typing each as Record<keyof T, ...> makes tsc fail when a field is
// added to or removed from the interface without updating the list.
// A trailing '?' means the value may also be null.
export type CliFieldKind = 'string' | 'string?' | 'number?' | 'boolean' | 'object?';

export const PENDING_CLI_FIELDS: Record<keyof PendingCli, CliFieldKind> = {
  present: 'string?',
  theme: 'object?',
  check: 'boolean',
  check_only: 'string?',
  import: 'object?',
  export: 'object?',
};

export const PENDING_IMPORT_FIELDS: Record<keyof PendingImport, CliFieldKind> = {
  format: 'string',
  input: 'string',
  output: 'string',
  force: 'boolean',
};

export const PENDING_EXPORT_FIELDS: Record<keyof PendingExport, CliFieldKind> = {
  format: 'string',
  input: 'string',
  output: 'string',
  notes: 'boolean',
  per_page: 'number?',
  paper: 'string?',
};

type ThemeVariantFields = {
  [V in CliThemeArg as V['type']]: Record<Exclude<keyof V, 'type'>, CliFieldKind>;
};

export const CLI_THEME_ARG_FIELDS: ThemeVariantFields = {
  named: { name: 'string' },
  path: { path: 'string' },
};

export const CLI_IMPORT_FORMATS: Record<CliImportFormat, true> = { marp: true, pptx: true, url: true };
export const CLI_EXPORT_FORMATS: Record<CliExportFormat, true> = { pptx: true, pdf: true, html: true };
