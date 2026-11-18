// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { parseDocument } from '../../parser/markdownToSlides';
import { BUILT_IN_THEMES, DEFAULT_THEME, sanitiseThemeOverrides, type Theme } from '../../theme';

// Golden XML snapshot suite (refactor card P0-05). Characterises the current
// PPTX export end to end: each fixture deck in ./fixtures is parsed exactly as
// the app parses it, exported, unzipped, and its slide XML (plus
// presentation.xml and notes) compared against committed golden files under
// ./__snapshots__/pptxGolden/<fixture>/. Later refactor cards move code around
// exportPptx.ts and must keep every golden file byte-identical.
//
// These snapshots pin *current* behaviour, bugs included. If a deliberate
// behaviour change alters the output (as the B1 fix did for
// fixtures/07-aspect-16x10.md), regenerate with `npx vitest run -u
// src/engine/export/__tests__/pptxGolden.test.ts` and review the XML diff.

// No Tauri backend in tests: every IPC call fails, which is what the export
// code already tolerates (it falls back to the original src).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.reject(new Error('no Tauri backend in tests'))),
  convertFileSrc: (p: string) => p,
}));

// jsdom's Image never decodes pixel data, so onload never fires and the export
// would hang measuring aspect ratios. Load synchronously with fixed, non-square
// dimensions so image placement maths is exercised with a realistic ratio.
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 160;
  naturalHeight = 90;
  width = 160;
  height = 90;
  set src(_v: string) { this.onload?.(); }
}
let OriginalImage: typeof Image;
beforeAll(() => { OriginalImage = global.Image; (global as unknown as { Image: unknown }).Image = StubImage; });
afterAll(() => { (global as unknown as { Image: unknown }).Image = OriginalImage; });

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, 'fixtures');
const FIXTURES = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md')).sort();

// Mirrors App.tsx's activeTheme memo: base theme picked by frontmatter
// `theme:`, then the sanitised `theme_overrides` merged on top. A data: logo
// passes through unchanged there too (only local paths go via IPC).
function resolveTheme(frontmatter: Record<string, unknown>): Theme {
  const base = BUILT_IN_THEMES.find((t) => t.id === frontmatter.theme) ?? DEFAULT_THEME;
  const overrides = sanitiseThemeOverrides((frontmatter.theme_overrides as Record<string, unknown>) ?? {});
  const logo = 'logo' in overrides ? overrides.logo ?? undefined : base.logo;
  return {
    ...base, ...overrides,
    logo,
    colors: { ...base.colors, ...(overrides.colors ?? {}) },
    fonts: { ...base.fonts, ...(overrides.fonts ?? {}) },
    header: { ...base.header, ...(overrides.header ?? {}) },
    footer: { ...base.footer, ...(overrides.footer ?? {}) },
    toc: { ...base.toc, ...(overrides.toc ?? {}) },
  };
}

// Strip anything that can legitimately differ between two identical exports.
function normalise(xml: string): string {
  return xml
    // Timestamps (docProps-style W3CDTF), should any leak into these parts.
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TIMESTAMP>')
    // GUIDs / UUIDs (pptxgenjs uses them for some extension ids).
    .replace(/\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?/g, '<GUID>')
    // One element per line so golden diffs stay readable. Only splits between
    // adjacent tags, so text content and its whitespace are untouched.
    .replace(/></g, '>\n<');
}

function partOrder(name: string): number {
  return Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

async function exportFixture(file: string) {
  const md = readFileSync(join(FIXTURE_DIR, file), 'utf8');
  const { slides, frontmatter } = parseDocument(md);
  const visible = slides.filter((s) => !s.hidden);
  const theme = resolveTheme(frontmatter);
  const res = await exportToPptx(visible, frontmatter, theme, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const pick = (re: RegExp) => names.filter((n) => re.test(n)).sort((a, b) => partOrder(a) - partOrder(b));
  const parts = [
    'ppt/presentation.xml',
    ...pick(/^ppt\/slides\/slide\d+\.xml$/),
    ...pick(/^ppt\/notesSlides\/notesSlide\d+\.xml$/),
  ];
  const xml: Record<string, string> = {};
  for (const p of parts) xml[p] = normalise(await zip.file(p)!.async('string'));
  return {
    summary: {
      layouts: visible.map((s) => s.layout),
      warnings: res.warnings,
      entries: names,
    },
    xml,
  };
}

describe('PPTX golden XML snapshots', () => {
  it('has fixtures to run', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of FIXTURES) {
    const name = file.replace(/\.md$/, '');

    it(`${name}: export matches the golden XML`, async () => {
      const { summary, xml } = await exportFixture(file);
      const dir = `./__snapshots__/pptxGolden/${name}`;
      await expect(JSON.stringify(summary, null, 2) + '\n').toMatchFileSnapshot(`${dir}/summary.json`);
      for (const [part, content] of Object.entries(xml)) {
        await expect(content).toMatchFileSnapshot(`${dir}/${part.replace(/^ppt\//, '')}`);
      }
    });

    it(`${name}: export is deterministic across runs`, async () => {
      const a = await exportFixture(file);
      const b = await exportFixture(file);
      expect(b).toEqual(a);
    });
  }
});
