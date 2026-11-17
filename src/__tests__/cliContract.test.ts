// Contract test: the Rust PendingCli (src-tauri/src/cli.rs) against the TS
// mirror (src/types/cli.ts). The fixture is written by the Rust test
// `cli::contract_tests::pending_cli_matches_fixture`, which fails if Rust's
// output drifts from it; this test fails if the fixture drifts from the TS
// field lists, which tsc keeps in step with the TS interfaces. To regenerate
// after an intentional change, run in src-tauri:
//   UPDATE_FIXTURES=1 cargo test pending_cli_matches_fixture
import fixture from './fixtures/pending-cli.json';
import {
  CLI_EXPORT_FORMATS,
  CLI_IMPORT_FORMATS,
  CLI_THEME_ARG_FIELDS,
  PENDING_CLI_FIELDS,
  PENDING_EXPORT_FIELDS,
  PENDING_IMPORT_FIELDS,
  type CliFieldKind,
  type PendingCli,
} from '../types/cli';

type Json = Record<string, unknown>;

function checkValue(path: string, value: unknown, kind: CliFieldKind): void {
  if (value === null) {
    expect(kind.endsWith('?'), `${path} is null but the TS type is not nullable`).toBe(true);
    return;
  }
  expect(typeof value, `${path} has the wrong type`).toBe(kind.replace('?', ''));
}

function checkFields(path: string, obj: unknown, fields: Record<string, CliFieldKind>): void {
  expect(obj, `${path} should be an object`).toBeTypeOf('object');
  const actual = Object.keys(obj as Json).sort();
  const expected = Object.keys(fields).sort();
  expect(actual, `${path} keys differ between Rust (fixture) and TS`).toEqual(expected);
  for (const key of expected) {
    checkValue(`${path}.${key}`, (obj as Json)[key], fields[key]);
  }
}

const samples = Object.entries(fixture as Record<string, unknown>);

describe('PendingCli contract (Rust fixture vs TS types)', () => {
  it('has samples', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it.each(samples)('%s matches the TS PendingCli shape', (name, raw) => {
    checkFields(name, raw, PENDING_CLI_FIELDS);
    const cli = raw as PendingCli;

    if (cli.theme) {
      const variants = CLI_THEME_ARG_FIELDS as Record<string, Record<string, CliFieldKind>>;
      expect(Object.keys(variants), `${name}.theme.type unknown to TS`).toContain(cli.theme.type);
      checkFields(`${name}.theme`, cli.theme, { type: 'string', ...variants[cli.theme.type] });
    }
    if (cli.import) {
      checkFields(`${name}.import`, cli.import, PENDING_IMPORT_FIELDS);
      expect(Object.keys(CLI_IMPORT_FORMATS)).toContain(cli.import.format);
    }
    if (cli.export) {
      checkFields(`${name}.export`, cli.export, PENDING_EXPORT_FIELDS);
      expect(Object.keys(CLI_EXPORT_FORMATS)).toContain(cli.export.format);
    }
  });

  // Every TS variant must appear in the fixture, so a variant removed on the
  // Rust side (or added only on the TS side) is caught too.
  it('covers every TS variant', () => {
    const clis = samples.map(([, v]) => v as PendingCli);
    const themes = new Set(clis.map((c) => c.theme?.type).filter(Boolean));
    const imports = new Set(clis.map((c) => c.import?.format).filter(Boolean));
    const exports = new Set(clis.map((c) => c.export?.format).filter(Boolean));
    expect([...themes].sort()).toEqual(Object.keys(CLI_THEME_ARG_FIELDS).sort());
    expect([...imports].sort()).toEqual(Object.keys(CLI_IMPORT_FORMATS).sort());
    expect([...exports].sort()).toEqual(Object.keys(CLI_EXPORT_FORMATS).sort());
  });
});
