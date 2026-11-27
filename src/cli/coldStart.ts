// CLI cold start: everything Kova does when launched as `kova --present`,
// `--check`, `--import` or `--export` (docs/plans/kova-cli.md). These run
// before (or entirely instead of) the editor, report to the launching
// terminal via cli_stdout / cli_exit, and never show a GUI dialog: the
// window is still hidden at this point, so a dialog could be invisible, and
// stdout/stderr are the CLI user's surface anyway.
//
// The React wiring lives in src/hooks/useColdStart.ts; this module holds the
// logic so it can be exercised against a fake IPC layer.
import {
  cliExit,
  cliStdout,
  fetchUrlText,
  loadCustomThemes,
  pathExists,
  probeUrl,
  readFile,
  stopWatching,
  takePendingCli,
  writeFile,
  writeFileBytes,
} from '../platform/ipc';
import { importMarp } from '../engine/import/marp';
import { parsePptx } from '../engine/import/parsePptx';
import { pptxToMarkdown } from '../engine/import/pptxToMarkdown';
import { toRawUrl } from '../engine/import/toRawUrl';
import { isAssetUrl, htmlHasAssetSrc } from '../engine/assetUrl';
import { basename, dirname, toForwardSlashes } from '../engine/paths';
import { collectDiagnostics, formatCheckReport, type CheckContext } from '../engine/parser/diagnostics';
import { evaluateImportCheck } from '../engine/cli/importCheckGate';
import { exportToPptx } from '../engine/export/pptx';
import {
  BUILT_IN_THEMES,
  parseThemeYaml,
  resolveCustomThemeLibrary,
  type Theme,
  type ThemeLibrary,
} from '../engine/theme';
import type { Frontmatter, ListItem, Slide } from '../engine/types';
import type { PdfExportOpts } from '../engine/export/pdfLayout';
import type { PdfExportOutcome } from '../hooks/useExports';
import type { PendingCli, CliThemeArg, PendingImport, PendingExport } from '../types/cli';
import { bestEffort } from '../platform/bestEffort';

// take_pending_cli drains once on the Rust side (Option::take), so cache the
// promise at module level: StrictMode's double-mount and dep-driven effect
// re-runs all observe the same value instead of the second call's null.
let pendingCliPromise: Promise<PendingCli | null> | null = null;
export function getPendingCli(): Promise<PendingCli | null> {
  pendingCliPromise ??= takePendingCli().catch(() => null);
  return pendingCliPromise;
}

// Resolve a --theme argument to a Theme, or report to the terminal and exit 1
// (returning null while the process shuts down). Named themes check built-ins
// first, then the installed community themes — loaded directly here rather
// than through the allThemes state, which may not have populated yet when the
// cold-start path runs. Path themes get a `cli:`-prefixed id so a file named
// light.yaml can never collide with (and silently lose to) a built-in id.
export async function resolveCliTheme(arg: CliThemeArg): Promise<Theme | null> {
  const fail = async (message: string) => {
    await bestEffort(cliExit(1, message), 'cliExit');
    return null;
  };
  if (arg.type === 'path') {
    let text: string;
    try {
      text = await readFile(arg.path);
    } catch {
      return fail(`cannot read theme '${arg.path}'`);
    }
    const normalisedPath = toForwardSlashes(arg.path);
    const base = basename(normalisedPath);
    const dir = dirname(normalisedPath, undefined);
    // Load the installed library too so this file's own `extends:` can name
    // an installed custom theme, not just a built-in (issue #249) — matching
    // the `arg.type === 'name'` path below.
    let library: ThemeLibrary | undefined;
    try {
      const [libDir, entries] = await loadCustomThemes();
      library = { entries, dir: libDir };
    } catch { /* no installed themes available — extends still falls back to built-ins */ }
    const parsed = parseThemeYaml(`cli:${base.replace(/\.ya?ml$/i, '')}`, text, dir, undefined, library);
    if (!parsed.ok) return fail(`invalid theme '${arg.path}': ${parsed.error}`);
    return parsed.theme;
  }
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === arg.name);
  if (builtIn) return builtIn;
  try {
    const [dir, entries] = await loadCustomThemes();
    const idx = entries.findIndex(([id]) => id === arg.name);
    if (idx !== -1) {
      // Resolve the whole installed library together so extends: can target
      // another installed theme, not just a built-in (issue #249).
      const { results } = resolveCustomThemeLibrary(entries, dir);
      const parsed = results[idx];
      if (parsed.ok) return parsed.theme;
      return fail(`invalid theme '${arg.name}': ${parsed.error}`);
    }
  } catch { /* fall through to unknown */ }
  return fail(`unknown theme '${arg.name}'`);
}

// Theme ids --check validates frontmatter `theme:` against — built-ins plus
// whatever community themes are installed in the config dir.
async function knownThemeIds(): Promise<string[]> {
  const ids = BUILT_IN_THEMES.map((t) => t.id);
  try {
    const [, entries] = await loadCustomThemes();
    return [...ids, ...entries.map(([id]) => id)];
  } catch {
    return ids;
  }
}

/** The IPC-backed context --check validates a deck against. */
async function cliCheckContext(docDir: string): Promise<CheckContext> {
  return {
    docDir,
    themeIds: await knownThemeIds(),
    fileExists: (p: string) =>
      pathExists(p).then(Boolean).catch(() => false),
    urlReachable: (url: string) =>
      probeUrl(url)
        .then(() => null)
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          return msg.replace(/^Error invoking command '[^']+':\s*/i, '');
        }),
  };
}

// kova --import marp|pptx|url IN OUT. Headless like standalone --check: the
// window is never shown (lib.rs keeps it hidden for any CLI action), this
// runs entirely outside React state, and the process exits from here.
// Mirrors the exact conversion each in-app import flow uses (ImportPptxModal,
// ImportUrlModal, the Marp-detection prompt) so CLI output matches the GUI's.
// When `--check` is also set, validate markdown before writing (issue #178).
export async function runCliImport(imp: PendingImport, check: boolean): Promise<void> {
  const finish = async (report: string) => {
    await bestEffort(cliStdout(report), 'cliStdout');
    await bestEffort(cliExit(0), 'cliExit');
  };
  const fail = async (message: string) => {
    await bestEffort(cliExit(1, message), 'cliExit');
  };
  /** Run --check on markdown; returns false when the write must be skipped. */
  const gate = async (markdown: string, label: string, docDir: string): Promise<boolean> => {
    const result = await evaluateImportCheck(check, markdown, label, await cliCheckContext(docDir));
    if (!result.enabled) return true;
    await bestEffort(cliStdout(result.report), 'cliStdout');
    if (result.errors > 0) {
      await bestEffort(cliExit(1), 'cliExit');
      return false;
    }
    return true;
  };

  try {
    if (imp.format === 'marp') {
      const text: string = await readFile(imp.input);
      // Check the import input before converting / writing (issue #178).
      if (!(await gate(text, imp.input, dirname(imp.input)))) return;
      const { markdown, dropped } = importMarp(text);
      await writeFile(imp.output, markdown);
      const suffix = dropped.length > 0 ? ` (simplified: ${dropped.join(', ')})` : '';
      await finish(`wrote '${imp.output}'${suffix}`);
      return;
    }
    if (imp.format === 'pptx') {
      // Media referenced by the deck is extracted alongside the output file,
      // same as the in-app import modal. PPTX itself isn't Markdown — check
      // the converted deck before writing so --check still gates the output.
      const parsed = await parsePptx(imp.input, dirname(imp.output));
      const markdown = pptxToMarkdown(parsed);
      if (!(await gate(markdown, imp.output, dirname(imp.output)))) return;
      await writeFile(imp.output, markdown);
      const lines = [`wrote '${imp.output}' (${parsed.slides.length} slides)`];
      for (const w of parsed.warnings) lines.push(`warning: ${w}`);
      await finish(lines.join('\n'));
      return;
    }
    // url — rewrite GitHub/GitLab/Bitbucket blob URLs to raw (same as ImportUrlModal).
    // Marp detection still happens on open, not on fetch.
    const text: string = await fetchUrlText(toRawUrl(imp.input));
    if (!(await gate(text, imp.output, dirname(imp.output)))) return;
    await writeFile(imp.output, text);
    await finish(`wrote '${imp.output}'`);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Mirrors ImportPptxModal's special-case message for this common failure.
    const msg = imp.format === 'pptx' && /password|encrypted/i.test(raw)
      ? 'PPTX file is password-protected; remove protection before importing'
      : raw;
    await fail(msg);
  }
}

/** What runColdLoad needs from the editor to load and theme the deck. */
export interface ColdLoadPorts {
  /** Marks the cold load as started; called at most once, before any await that follows it. */
  claim: () => void;
  /** Flags the session as `kova --present` (setColdPresent(true)). */
  startColdPresent: () => void;
  /** The normal post-read open sequence (useDocument's applyFileContent). */
  applyFileContent: (text: string, path: string) => Promise<void>;
  /** Replaces the deck's base theme with the --theme one (useThemeState). */
  applyCliTheme: (theme: Theme) => void;
  /** Hands --export to the cold-export effect once the deck has loaded. */
  startColdExport: (exp: PendingExport) => void;
}

// Cold-start load for a drained PendingCli. --import runs fully headless and
// exits; --present / standalone --check / --export load the target file
// through the same post-read sequence as a normal open so docDir, theme sync
// and the watcher all populate identically. Does nothing when no CLI action
// was requested. Errors report to the launching terminal (see file header).
export async function runColdLoad(cli: PendingCli | null, ports: ColdLoadPorts): Promise<void> {
  // kova --import: fully headless, no editor state or window involved —
  // runs and exits before any of the present/check logic below.
  if (cli?.import) {
    ports.claim();
    await runCliImport(cli.import, cli.check);
    return;
  }
  // --present FILE, standalone --check FILE (which never shows a window:
  // the loading branch renders behind a window that lib.rs never shows, and
  // the process exits from here), or --export's input file (the window also
  // stays hidden — export_pdf_native always prints via its own separate
  // hidden window regardless, and PPTX needs no window at all — the
  // cold-export effect picks this up once slides resolve).
  const target = cli?.present ?? cli?.check_only ?? cli?.export?.input;
  if (!cli || !target) return;
  ports.claim();
  if (cli.present) ports.startColdPresent();
  // Resolve --theme before loading the deck: theme errors are fail-fast
  // (stderr + exit 1) like a missing presentation file, and nothing has
  // rendered yet at this point. Applies to present and export — not
  // import, which never renders anything a theme could affect.
  let cliTheme: Theme | null = null;
  if (cli.theme && (cli.present || cli.export)) {
    cliTheme = await resolveCliTheme(cli.theme);
    if (!cliTheme) return; // reported and exiting
  }
  try {
    const text: string = await readFile(target);
    // --check: validate before anything renders. The report goes to
    // stdout (it is data; errors about the invocation itself go to
    // stderr). Standalone check exits either way; as a gate before
    // --present, errors abort with exit 1 and warnings continue into
    // the presentation.
    if (cli.check || cli.check_only) {
      const diags = await collectDiagnostics(text, await cliCheckContext(dirname(target)));
      const { report, errors } = formatCheckReport(target, diags);
      await bestEffort(cliStdout(report), 'cliStdout');
      if (cli.check_only || errors > 0) {
        await bestEffort(cliExit(errors > 0 ? 1 : 0), 'cliExit');
        return;
      }
    }
    await bestEffort(stopWatching(), 'stopWatching');
    await ports.applyFileContent(text, target);
    if (cliTheme) {
      // --theme replaces the deck's *base* theme; the frontmatter
      // theme_overrides still ride on top (they are derived from `content`).
      ports.applyCliTheme(cliTheme);
    }
    if (cli.export) ports.startColdExport(cli.export);
  } catch {
    await bestEffort(cliExit(1, `cannot read '${target}'`), 'cliExit');
  }
}

// useResolvedSlides swaps local media srcs from a placeholder (used while the
// async read_file_b64 load is in flight) to data: URLs once loaded. The
// placeholder is convertFileSrc's asset:// URL on macOS/Linux, but Windows'
// WebView2 can't load custom schemes directly, so Tauri rewrites it there to
// http://asset.localhost/... instead — both forms must be recognised or this
// gate never fires on Windows, the platform the CLI export bug targets. A
// cold-start CLI export can otherwise fire its capture the instant slides
// resolve, racing that load — the button-triggered export never hits this
// because by the time a user clicks it, the deck has been open long enough
// for local media to have already resolved.
export function hasPendingLocalMedia(visibleSlides: readonly Slide[]): boolean {
  const isPending = isAssetUrl;
  const htmlIsPending = htmlHasAssetSrc;
  const itemIsPending = (item: ListItem): boolean =>
    htmlIsPending(item.html) || item.children.some(itemIsPending);
  return visibleSlides.some((slide) => {
    if (slide.backgroundImage && isPending(slide.backgroundImage.src)) return true;
    return slide.elements.some((el) => {
      if (el.type === 'image' || el.type === 'video') return isPending(el.src);
      if (el.type === 'paragraph') return htmlIsPending(el.html);
      if (el.type === 'list') return el.items.some(itemIsPending);
      return false;
    });
  });
}

/** The loaded deck and export paths runColdExport writes from. */
export interface ColdExportContext {
  filePath: string;
  visibleSlides: Slide[];
  frontmatter: Frontmatter;
  activeTheme: Theme;
  locale: string;
  /** Settings paper size, used when --paper was not given. */
  pdfPageSize: 'a4' | 'letter' | 'slide';
  runPdfExportCapture: (visSlides: Slide[], savePath: string, opts: PdfExportOpts) => Promise<PdfExportOutcome>;
  runHtmlExportCapture: (visSlides: Slide[]) => Promise<string>;
}

// kova --export pptx|pdf|html FILE OUT, once the deck has loaded and its
// slides resolved. PPTX needs no rendered DOM (exportToPptx works from slide
// data directly); PDF reuses the exact capture path the Export button uses,
// native print against the hidden dedicated print window (export_pdf_native
// already always creates one, whether launched from the GUI or the CLI) with
// the same raster fallback on failure; HTML reuses the same off-screen
// capture as the Export → HTML button. The empty-deck exit is requested
// synchronously, before the returned promise settles.
export function runColdExport(exp: PendingExport, ctx: ColdExportContext): Promise<void> {
  const { filePath, visibleSlides } = ctx;
  if (visibleSlides.length === 0) {
    void bestEffort(cliExit(1, `'${filePath}' contains no visible slides`), 'cliExit');
    return Promise.resolve();
  }
  const finish = async (report: string) => {
    await bestEffort(cliStdout(report), 'cliStdout');
    await bestEffort(cliExit(0), 'cliExit');
  };
  const fail = async (message: string) => {
    await bestEffort(cliExit(1, message), 'cliExit');
  };
  return (async () => {
    try {
      if (exp.format === 'pptx') {
        const { base64, warnings } = await exportToPptx(visibleSlides, ctx.frontmatter, ctx.activeTheme, ctx.locale);
        await writeFileBytes(exp.output, base64);
        const lines = [`wrote '${exp.output}'`, ...warnings.map((w) => `warning: ${w}`)];
        await finish(lines.join('\n'));
        return;
      }
      if (exp.format === 'html') {
        const html = await ctx.runHtmlExportCapture([...visibleSlides]);
        await writeFile(exp.output, html);
        await finish(`wrote '${exp.output}'`);
        return;
      }
      // Honour CLI --notes / --per-page / --paper; fall back to settings paper (#187 / #200).
      const paper = (exp.paper as 'a4' | 'letter' | 'slide' | null)
        ?? ctx.pdfPageSize;
      const perPage = exp.per_page ?? 1;
      const notes = exp.notes && perPage === 1
        ? visibleSlides.map((s) => s.speakerNotes)
        : undefined;
      const outcome = await ctx.runPdfExportCapture(
        [...visibleSlides],
        exp.output,
        { paper, perPage, notes },
      );
      const lines = [`wrote '${exp.output}'`];
      if (outcome.usedFallback) {
        lines.push(`note: native PDF export failed, used raster fallback (${outcome.fallbackReason})`);
      }
      lines.push(...outcome.warnings.map((w) => `warning: ${w}`));
      await finish(lines.join('\n'));
    } catch (err) {
      await fail(err instanceof Error ? err.message : String(err));
    }
  })();
}
