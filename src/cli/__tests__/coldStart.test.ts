import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BUILT_IN_THEMES, parseThemeYaml } from '../../engine/theme';
import type { Slide, SlideElement } from '../../engine/types';
import type { PendingCli, PendingExport, PendingImport } from '../../types/cli';

// ── Fake IPC ─────────────────────────────────────────────────────────────────
// Every call lands in `log` as [command, ...args] so tests can assert the
// exact terminal output (cli_stdout text, cli_exit code/message) and order.

const fake = vi.hoisted(() => ({
  log: [] as unknown[][],
  files: new Map<string, string>(),
  customThemes: null as [string, Array<[string, string]>] | null,
  existing: new Set<string>(),
  urls: new Map<string, string>(),
  pendingCli: null as unknown,
}));

const ipc = vi.hoisted(() => {
  const rec = (name: string, ...args: unknown[]) => { fake.log.push([name, ...args]); };
  return {
    cliExit: vi.fn(async (code: number, message?: string) => {
      if (message === undefined) rec('cli_exit', code); else rec('cli_exit', code, message);
    }),
    cliStdout: vi.fn(async (text: string) => { rec('cli_stdout', text); }),
    readFile: vi.fn(async (path: string) => {
      rec('read_file', path);
      const text = fake.files.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    }),
    writeFile: vi.fn(async (path: string, content: string) => { rec('write_file', path, content); }),
    writeFileBytes: vi.fn(async (path: string, data: string) => { rec('write_file_bytes', path, data); }),
    loadCustomThemes: vi.fn(async () => {
      if (!fake.customThemes) throw new Error('no config dir');
      return fake.customThemes;
    }),
    pathExists: vi.fn(async (path: string) => fake.existing.has(path)),
    probeUrl: vi.fn(async () => {}),
    fetchUrlText: vi.fn(async (url: string) => {
      rec('fetch_url_text', url);
      const text = fake.urls.get(url);
      if (text === undefined) throw new Error('HTTP 404');
      return text;
    }),
    stopWatching: vi.fn(async () => { rec('stop_watching'); }),
    takePendingCli: vi.fn(async () => fake.pendingCli),
  };
});
vi.mock('../../platform/ipc', () => ipc);

const pptx = vi.hoisted(() => ({
  parsePptx: vi.fn(),
  pptxToMarkdown: vi.fn(() => '# From PowerPoint\n'),
  exportToPptx: vi.fn(),
}));
vi.mock('../../engine/import/parsePptx', () => ({ parsePptx: pptx.parsePptx }));
vi.mock('../../engine/import/pptxToMarkdown', () => ({ pptxToMarkdown: pptx.pptxToMarkdown }));
vi.mock('../../engine/export/pptx', () => ({ exportToPptx: pptx.exportToPptx }));

import {
  getPendingCli,
  hasPendingLocalMedia,
  resolveCliTheme,
  runCliImport,
  runColdExport,
  runColdLoad,
  type ColdExportContext,
  type ColdLoadPorts,
} from '../coldStart';

/** Terminal-facing calls only (cli_stdout / cli_exit), in order. */
const terminal = () => fake.log.filter(([n]) => n === 'cli_stdout' || n === 'cli_exit');
const writes = () => fake.log.filter(([n]) => n === 'write_file' || n === 'write_file_bytes');

const GOOD_DECK = '---\ntitle: Deck\n---\n\n# Hello\n\nWorld\n';
// An unknown layout is a --check error (not just a warning).
const BAD_DECK = '# Hello\n\n<!-- layout: no-such-layout -->\n';

beforeEach(() => {
  fake.log = [];
  fake.files.clear();
  fake.customThemes = null;
  fake.existing.clear();
  fake.urls.clear();
  fake.pendingCli = null;
  vi.clearAllMocks();
});

// ── resolveCliTheme ──────────────────────────────────────────────────────────

describe('resolveCliTheme', () => {
  it('returns a built-in theme by name without touching IPC', async () => {
    const theme = await resolveCliTheme({ type: 'named', name: 'dark' });
    expect(theme).toBe(BUILT_IN_THEMES.find((t) => t.id === 'dark'));
    expect(ipc.loadCustomThemes).not.toHaveBeenCalled();
    expect(terminal()).toEqual([]);
  });

  it('resolves an installed community theme by name', async () => {
    fake.customThemes = ['/cfg/themes', [['ocean', 'name: Ocean\ncolors:\n  primary: "#003366"\n']]];
    const theme = await resolveCliTheme({ type: 'named', name: 'ocean' });
    expect(theme?.id).toBe('ocean');
    expect(theme?.name).toBe('Ocean');
    expect(theme?.colors.primary).toBe('#003366');
  });

  it('exits 1 with "unknown theme" for an unknown name', async () => {
    fake.customThemes = ['/cfg/themes', []];
    expect(await resolveCliTheme({ type: 'named', name: 'nope' })).toBeNull();
    expect(terminal()).toEqual([['cli_exit', 1, "unknown theme 'nope'"]]);
  });

  it('exits 1 with "unknown theme" when installed themes cannot be loaded', async () => {
    expect(await resolveCliTheme({ type: 'named', name: 'nope' })).toBeNull();
    expect(terminal()).toEqual([['cli_exit', 1, "unknown theme 'nope'"]]);
  });

  it('exits 1 with "invalid theme" for a broken installed theme', async () => {
    const yaml = 'name: [unterminated\n';
    fake.customThemes = ['/cfg/themes', [['broken', yaml]]];
    const expected = parseThemeYaml('broken', yaml);
    expect(expected.ok).toBe(false);
    if (expected.ok) return;
    expect(await resolveCliTheme({ type: 'named', name: 'broken' })).toBeNull();
    expect(terminal()).toEqual([['cli_exit', 1, `invalid theme 'broken': ${expected.error}`]]);
  });

  it('gives a path theme a cli:-prefixed id from its file name', async () => {
    fake.files.set('/themes/light.yaml', 'name: My Light\n');
    const theme = await resolveCliTheme({ type: 'path', path: '/themes/light.yaml' });
    expect(theme?.id).toBe('cli:light');
    expect(theme?.name).toBe('My Light');
  });

  it('strips .yml case-insensitively and normalises Windows separators', async () => {
    fake.files.set('C:\\themes\\Brand.YML', 'name: Brand\n');
    const theme = await resolveCliTheme({ type: 'path', path: 'C:\\themes\\Brand.YML' });
    expect(theme?.id).toBe('cli:Brand');
  });

  it('lets a path theme extend an installed theme (issue #249)', async () => {
    fake.customThemes = ['/cfg/themes', [['ocean', 'name: Ocean\ncolors:\n  primary: "#003366"\n']]];
    fake.files.set('/t/mine.yaml', 'name: Mine\nextends: ocean\n');
    const theme = await resolveCliTheme({ type: 'path', path: '/t/mine.yaml' });
    expect(theme?.id).toBe('cli:mine');
    expect(theme?.colors.primary).toBe('#003366');
  });

  it('exits 1 with "cannot read theme" for an unreadable path', async () => {
    expect(await resolveCliTheme({ type: 'path', path: '/missing.yaml' })).toBeNull();
    expect(terminal()).toEqual([['cli_exit', 1, "cannot read theme '/missing.yaml'"]]);
  });

  it('exits 1 with "invalid theme" for an unparsable path theme', async () => {
    const yaml = 'name: [unterminated\n';
    fake.files.set('/t/bad.yaml', yaml);
    const expected = parseThemeYaml('cli:bad', yaml);
    if (expected.ok) throw new Error('fixture should not parse');
    expect(await resolveCliTheme({ type: 'path', path: '/t/bad.yaml' })).toBeNull();
    expect(terminal()).toEqual([['cli_exit', 1, `invalid theme '/t/bad.yaml': ${expected.error}`]]);
  });
});

// ── runCliImport ─────────────────────────────────────────────────────────────

const imp = (over: Partial<PendingImport>): PendingImport =>
  ({ format: 'marp', input: '/in/deck.md', output: '/out/deck.md', force: false, ...over });

describe('runCliImport', () => {
  it('marp: converts, writes and reports simplified directives, exit 0', async () => {
    fake.files.set('/in/deck.md', '---\nmarp: true\npaginate: true\n---\n\n# A\n\n---\n\n# B\n');
    await runCliImport(imp({}), false);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toBe('/out/deck.md');
    const out = terminal();
    expect(out).toHaveLength(2);
    expect(out[0][0]).toBe('cli_stdout');
    expect(out[0][1]).toMatch(/^wrote '\/out\/deck\.md'( \(simplified: .+\))?$/);
    expect(out[1]).toEqual(['cli_exit', 0]);
  });

  it('marp: reports an unreadable input as exit 1 with the raw error', async () => {
    await runCliImport(imp({}), false);
    expect(writes()).toEqual([]);
    expect(terminal()).toEqual([['cli_exit', 1, 'no such file: /in/deck.md']]);
  });

  it('marp --check: errors print the report, skip the write and exit 1', async () => {
    fake.files.set('/in/deck.md', BAD_DECK);
    await runCliImport(imp({}), true);
    expect(writes()).toEqual([]);
    const out = terminal();
    expect(out).toHaveLength(2);
    expect(out[0][0]).toBe('cli_stdout');
    expect(out[0][1]).toBe("/in/deck.md:3: error: unknown layout 'no-such-layout'\n1 error(s), 0 warning(s)");
    expect(out[1]).toEqual(['cli_exit', 1]);
  });

  it('marp --check: a clean deck prints the report, then writes and exits 0', async () => {
    fake.files.set('/in/deck.md', GOOD_DECK);
    await runCliImport(imp({}), true);
    expect(writes()).toHaveLength(1);
    const out = terminal();
    expect(out).toHaveLength(3);
    expect(out[0][0]).toBe('cli_stdout');
    expect(out[1]).toEqual(['cli_stdout', "wrote '/out/deck.md'"]);
    expect(out[2]).toEqual(['cli_exit', 0]);
  });

  it('pptx: writes the converted deck, reports slide count and warnings', async () => {
    pptx.parsePptx.mockResolvedValue({
      slides: [{ blocks: [], notes: '' }, { blocks: [], notes: '' }],
      warnings: ['dropped a chart', 'font substituted'],
    });
    await runCliImport(imp({ format: 'pptx', input: '/in/deck.pptx' }), false);
    expect(pptx.parsePptx).toHaveBeenCalledWith('/in/deck.pptx', '/out');
    expect(writes()).toEqual([['write_file', '/out/deck.md', '# From PowerPoint\n']]);
    expect(terminal()).toEqual([
      ['cli_stdout', "wrote '/out/deck.md' (2 slides)\nwarning: dropped a chart\nwarning: font substituted"],
      ['cli_exit', 0],
    ]);
  });

  it('pptx: a password/encrypted error gets the friendly message', async () => {
    pptx.parsePptx.mockRejectedValue(new Error('File is Encrypted'));
    await runCliImport(imp({ format: 'pptx', input: '/in/deck.pptx' }), false);
    expect(terminal()).toEqual([
      ['cli_exit', 1, 'PPTX file is password-protected; remove protection before importing'],
    ]);
  });

  it('pptx: other errors pass through verbatim', async () => {
    pptx.parsePptx.mockRejectedValue('not a zip');
    await runCliImport(imp({ format: 'pptx', input: '/in/deck.pptx' }), false);
    expect(terminal()).toEqual([['cli_exit', 1, 'not a zip']]);
  });

  it('url: fetches the raw URL for a GitHub blob link and writes it verbatim', async () => {
    fake.urls.set('https://raw.githubusercontent.com/o/r/main/deck.md', GOOD_DECK);
    await runCliImport(imp({ format: 'url', input: 'https://github.com/o/r/blob/main/deck.md' }), false);
    expect(fake.log).toContainEqual(['fetch_url_text', 'https://raw.githubusercontent.com/o/r/main/deck.md']);
    expect(writes()).toEqual([['write_file', '/out/deck.md', GOOD_DECK]]);
    expect(terminal()).toEqual([['cli_stdout', "wrote '/out/deck.md'"], ['cli_exit', 0]]);
  });

  it('url --check: errors label the report with the output path and exit 1', async () => {
    fake.urls.set('https://example.com/deck.md', BAD_DECK);
    await runCliImport(imp({ format: 'url', input: 'https://example.com/deck.md' }), true);
    expect(writes()).toEqual([]);
    const out = terminal();
    expect(out[0][1]).toContain('/out/deck.md');
    expect(out[1]).toEqual(['cli_exit', 1]);
  });

  it('url: fetch failures exit 1 with the error message', async () => {
    await runCliImport(imp({ format: 'url', input: 'https://example.com/x.md' }), false);
    expect(terminal()).toEqual([['cli_exit', 1, 'HTTP 404']]);
  });
});

// ── runColdLoad (present / check / export load) ─────────────────────────────

const cliReq = (over: Partial<PendingCli>): PendingCli =>
  ({ present: null, theme: null, check: false, check_only: null, import: null, export: null, ...over });

function ports() {
  const calls: unknown[][] = [];
  const p: ColdLoadPorts = {
    claim: vi.fn(() => { calls.push(['claim']); }),
    startColdPresent: vi.fn(() => { calls.push(['startColdPresent']); }),
    applyFileContent: vi.fn(async (text: string, path: string) => { calls.push(['applyFileContent', text, path]); }),
    applyCliTheme: vi.fn((theme) => { calls.push(['applyCliTheme', theme.id]); }),
    startColdExport: vi.fn((exp) => { calls.push(['startColdExport', exp.format]); }),
  };
  return { p, calls };
}

const exportReq = (over: Partial<PendingExport> = {}): PendingExport =>
  ({ format: 'pptx', input: '/d/deck.md', output: '/d/deck.pptx', notes: false, per_page: null, paper: null, ...over });

describe('runColdLoad', () => {
  it('does nothing (and does not claim) without a CLI request', async () => {
    const { p, calls } = ports();
    await runColdLoad(null, p);
    await runColdLoad(cliReq({}), p);
    expect(calls).toEqual([]);
    expect(fake.log).toEqual([]);
  });

  it('--import claims and runs the headless import', async () => {
    fake.files.set('/in/deck.md', GOOD_DECK);
    const { p, calls } = ports();
    await runColdLoad(cliReq({ import: imp({}) }), p);
    expect(calls).toEqual([['claim']]);
    expect(terminal().at(-1)).toEqual(['cli_exit', 0]);
  });

  it('--present loads the deck through applyFileContent after stop_watching', async () => {
    fake.files.set('/d/deck.md', GOOD_DECK);
    const { p, calls } = ports();
    await runColdLoad(cliReq({ present: '/d/deck.md' }), p);
    expect(calls).toEqual([['claim'], ['startColdPresent'], ['applyFileContent', GOOD_DECK, '/d/deck.md']]);
    expect(fake.log).toEqual([['read_file', '/d/deck.md'], ['stop_watching']]);
  });

  it('--present --theme applies the resolved theme after loading', async () => {
    fake.files.set('/d/deck.md', GOOD_DECK);
    const { p, calls } = ports();
    await runColdLoad(cliReq({ present: '/d/deck.md', theme: { type: 'named', name: 'dark' } }), p);
    expect(calls).toEqual([
      ['claim'], ['startColdPresent'],
      ['applyFileContent', GOOD_DECK, '/d/deck.md'],
      ['applyCliTheme', 'dark'],
    ]);
  });

  it('--present with a bad --theme exits 1 before reading the deck', async () => {
    fake.customThemes = ['/cfg', []];
    const { p, calls } = ports();
    await runColdLoad(cliReq({ present: '/d/deck.md', theme: { type: 'named', name: 'nope' } }), p);
    expect(calls).toEqual([['claim'], ['startColdPresent']]);
    expect(fake.log).toEqual([['cli_exit', 1, "unknown theme 'nope'"]]);
  });

  it('--theme is ignored for standalone --check', async () => {
    fake.files.set('/d/deck.md', GOOD_DECK);
    const { p } = ports();
    await runColdLoad(cliReq({ check_only: '/d/deck.md', theme: { type: 'named', name: 'nope' } }), p);
    expect(terminal().at(-1)).toEqual(['cli_exit', 0]);
  });

  it('--present on an unreadable file exits 1 with "cannot read"', async () => {
    const { p, calls } = ports();
    await runColdLoad(cliReq({ present: '/d/missing.md' }), p);
    expect(calls).toEqual([['claim'], ['startColdPresent']]);
    expect(terminal()).toEqual([['cli_exit', 1, "cannot read '/d/missing.md'"]]);
  });

  it('standalone --check on a clean deck prints the report and exits 0 without loading', async () => {
    fake.files.set('/d/deck.md', GOOD_DECK);
    const { p, calls } = ports();
    await runColdLoad(cliReq({ check_only: '/d/deck.md' }), p);
    expect(calls).toEqual([['claim']]);
    const out = terminal();
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(['cli_stdout', '0 error(s), 0 warning(s)']);
    expect(out[1]).toEqual(['cli_exit', 0]);
  });

  it('standalone --check with errors exits 1', async () => {
    fake.files.set('/d/deck.md', BAD_DECK);
    const { p } = ports();
    await runColdLoad(cliReq({ check_only: '/d/deck.md' }), p);
    expect(terminal()).toEqual([
      ['cli_stdout', "/d/deck.md:3: error: unknown layout 'no-such-layout'\n1 error(s), 0 warning(s)"],
      ['cli_exit', 1],
    ]);
  });

  it('--check gating --present: errors exit 1 and the deck never loads', async () => {
    fake.files.set('/d/deck.md', BAD_DECK);
    const { p, calls } = ports();
    await runColdLoad(cliReq({ present: '/d/deck.md', check: true }), p);
    expect(calls).toEqual([['claim'], ['startColdPresent']]);
    expect(terminal().at(-1)).toEqual(['cli_exit', 1]);
  });

  it('--check gating --present: a clean deck prints the report and presents', async () => {
    fake.files.set('/d/deck.md', GOOD_DECK);
    const { p, calls } = ports();
    await runColdLoad(cliReq({ present: '/d/deck.md', check: true }), p);
    expect(calls.at(-1)).toEqual(['applyFileContent', GOOD_DECK, '/d/deck.md']);
    expect(terminal().map(([n]) => n)).toEqual(['cli_stdout']);
  });

  it('--check sees installed theme ids and existing media', async () => {
    fake.customThemes = ['/cfg', [['ocean', 'name: Ocean\n']]];
    fake.existing.add('/d/pic.png');
    fake.files.set('/d/deck.md', '---\ntheme: ocean\n---\n\n# A\n\n![x](pic.png)\n');
    const { p } = ports();
    await runColdLoad(cliReq({ check_only: '/d/deck.md' }), p);
    expect(terminal().at(-1)).toEqual(['cli_exit', 0]);
  });

  it('--export loads the input, applies --theme, then hands over the export', async () => {
    fake.files.set('/d/deck.md', GOOD_DECK);
    const { p, calls } = ports();
    const exp = exportReq();
    await runColdLoad(cliReq({ export: exp, theme: { type: 'named', name: 'light' } }), p);
    expect(calls).toEqual([
      ['claim'],
      ['applyFileContent', GOOD_DECK, '/d/deck.md'],
      ['applyCliTheme', 'light'],
      ['startColdExport', 'pptx'],
    ]);
    expect(p.startColdExport).toHaveBeenCalledWith(exp);
  });
});

// ── getPendingCli ────────────────────────────────────────────────────────────

describe('getPendingCli', () => {
  it('drains take_pending_cli once and caches the result', async () => {
    const req = cliReq({ present: '/d/deck.md' });
    fake.pendingCli = req;
    const a = await getPendingCli();
    fake.pendingCli = null;
    const b = await getPendingCli();
    expect(a).toBe(req);
    expect(b).toBe(req);
    expect(ipc.takePendingCli).toHaveBeenCalledTimes(1);
  });
});

// ── runColdExport ────────────────────────────────────────────────────────────

const slide = (over: Partial<Slide> = {}): Slide =>
  ({ elements: [], speakerNotes: '', hidden: false, ...over }) as unknown as Slide;

function exportCtx(over: Partial<ColdExportContext> = {}): ColdExportContext {
  return {
    filePath: '/d/deck.md',
    visibleSlides: [slide({ speakerNotes: 'one' }), slide({ speakerNotes: 'two' })],
    frontmatter: { title: 'Deck' },
    activeTheme: BUILT_IN_THEMES[0],
    locale: 'en',
    pdfPageSize: 'letter',
    runPdfExportCapture: vi.fn(async () => ({ warnings: [], usedFallback: false })),
    runHtmlExportCapture: vi.fn(async () => '<html></html>'),
    ...over,
  };
}

describe('runColdExport', () => {
  it('exits 1 synchronously when the deck has no visible slides', () => {
    void runColdExport(exportReq(), exportCtx({ visibleSlides: [] }));
    expect(ipc.cliExit).toHaveBeenCalledWith(1, "'/d/deck.md' contains no visible slides");
  });

  it('pptx: writes the bytes and reports warnings', async () => {
    pptx.exportToPptx.mockResolvedValue({ base64: 'QUJD', warnings: ['icon missing'] });
    const ctx = exportCtx();
    await runColdExport(exportReq(), ctx);
    expect(pptx.exportToPptx).toHaveBeenCalledWith(ctx.visibleSlides, ctx.frontmatter, ctx.activeTheme, 'en');
    expect(fake.log).toEqual([
      ['write_file_bytes', '/d/deck.pptx', 'QUJD'],
      ['cli_stdout', "wrote '/d/deck.pptx'\nwarning: icon missing"],
      ['cli_exit', 0],
    ]);
  });

  it('html: writes the captured document', async () => {
    const ctx = exportCtx();
    await runColdExport(exportReq({ format: 'html', output: '/d/deck.html' }), ctx);
    expect(ctx.runHtmlExportCapture).toHaveBeenCalledWith(ctx.visibleSlides);
    expect(fake.log).toEqual([
      ['write_file', '/d/deck.html', '<html></html>'],
      ['cli_stdout', "wrote '/d/deck.html'"],
      ['cli_exit', 0],
    ]);
  });

  it('pdf: falls back to the settings paper, one per page, no notes', async () => {
    const ctx = exportCtx();
    await runColdExport(exportReq({ format: 'pdf', output: '/d/deck.pdf' }), ctx);
    expect(ctx.runPdfExportCapture).toHaveBeenCalledWith(
      ctx.visibleSlides, '/d/deck.pdf', { paper: 'letter', perPage: 1, notes: undefined },
    );
    expect(terminal()).toEqual([['cli_stdout', "wrote '/d/deck.pdf'"], ['cli_exit', 0]]);
  });

  it('pdf: honours --paper and --notes at one per page', async () => {
    const ctx = exportCtx();
    await runColdExport(exportReq({ format: 'pdf', output: '/d/deck.pdf', paper: 'a4', notes: true }), ctx);
    expect(ctx.runPdfExportCapture).toHaveBeenCalledWith(
      ctx.visibleSlides, '/d/deck.pdf', { paper: 'a4', perPage: 1, notes: ['one', 'two'] },
    );
  });

  it('pdf: drops --notes when --per-page is above 1', async () => {
    const ctx = exportCtx();
    await runColdExport(exportReq({ format: 'pdf', output: '/d/deck.pdf', per_page: 4, notes: true }), ctx);
    expect(ctx.runPdfExportCapture).toHaveBeenCalledWith(
      ctx.visibleSlides, '/d/deck.pdf', { paper: 'letter', perPage: 4, notes: undefined },
    );
  });

  it('pdf: reports the raster fallback and warnings', async () => {
    const ctx = exportCtx({
      runPdfExportCapture: vi.fn(async () => ({ warnings: ['w1'], usedFallback: true, fallbackReason: 'no printer' })),
    });
    await runColdExport(exportReq({ format: 'pdf', output: '/d/deck.pdf' }), ctx);
    expect(terminal()).toEqual([
      ['cli_stdout', "wrote '/d/deck.pdf'\nnote: native PDF export failed, used raster fallback (no printer)\nwarning: w1"],
      ['cli_exit', 0],
    ]);
  });

  it('reports a failed export as exit 1 with the error message', async () => {
    const ctx = exportCtx({ runPdfExportCapture: vi.fn(async () => { throw new Error('both failed'); }) });
    await runColdExport(exportReq({ format: 'pdf', output: '/d/deck.pdf' }), ctx);
    expect(terminal()).toEqual([['cli_exit', 1, 'both failed']]);
  });
});

// ── hasPendingLocalMedia ─────────────────────────────────────────────────────

describe('hasPendingLocalMedia', () => {
  const el = (e: Record<string, unknown>) => e as unknown as SlideElement;
  it('detects asset:// and Windows http://asset.localhost placeholders', () => {
    expect(hasPendingLocalMedia([slide({ elements: [el({ type: 'image', src: 'asset://localhost/a.png' })] })])).toBe(true);
    expect(hasPendingLocalMedia([slide({ elements: [el({ type: 'video', src: 'http://asset.localhost/a.mp4' })] })])).toBe(true);
    expect(hasPendingLocalMedia([slide({ backgroundImage: { src: 'asset://localhost/bg.png' } } as Partial<Slide>)])).toBe(true);
    expect(hasPendingLocalMedia([slide({ elements: [el({ type: 'paragraph', html: '<img src="asset://x">' })] })])).toBe(true);
    expect(hasPendingLocalMedia([slide({
      elements: [el({ type: 'list', items: [{ html: 'a', children: [{ html: '<img src="http://asset.localhost/x">', children: [] }] }] })],
    })])).toBe(true);
  });

  it('is false once media is resolved to data: URLs', () => {
    expect(hasPendingLocalMedia([slide({ elements: [el({ type: 'image', src: 'data:image/png;base64,AA' })] })])).toBe(false);
    expect(hasPendingLocalMedia([])).toBe(false);
  });
});
