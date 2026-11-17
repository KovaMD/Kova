// Pins the typed IPC wrappers in src/platform/ipc.ts to the commands the Rust
// side registers in `tauri::generate_handler![...]` (src-tauri/src/lib.rs).
// Adding, removing or renaming a Rust command without updating ipc.ts (or the
// reverse) fails here, so a rename is no longer a grep exercise.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commands } from '../ipc';

const LIB_RS = fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url));

/** Command names inside the first `generate_handler![ ... ]` block, in order. */
function parseGenerateHandler(source: string): string[] {
  const match = /generate_handler!\s*\[([\s\S]*?)\]/.exec(source);
  if (!match) throw new Error('generate_handler! block not found');
  return match[1]
    .replace(/\/\/[^\n]*/g, '') // line comments
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((path) => path.split('::').pop() as string);
}

const sorted = (names: string[]): string[] => [...names].sort();

describe('IPC command list', () => {
  const rustSource = readFileSync(LIB_RS, 'utf8');
  const rustCommands = parseGenerateHandler(rustSource);

  it('parses a non-empty, duplicate-free list from lib.rs', () => {
    expect(rustCommands.length).toBeGreaterThan(0);
    expect(new Set(rustCommands).size).toBe(rustCommands.length);
  });

  it('matches the generate_handler! list in lib.rs exactly', () => {
    expect(sorted(Object.keys(commands))).toEqual(sorted(rustCommands));
  });

  it('detects a command added on the Rust side', () => {
    const edited = rustSource.replace(
      'generate_handler![',
      'generate_handler![\n            commands::brand_new_command,',
    );
    expect(sorted(Object.keys(commands))).not.toEqual(sorted(parseGenerateHandler(edited)));
  });

  it('detects a command removed on the Rust side', () => {
    const edited = rustSource.replace(/\s*commands::read_file_b64,/, '');
    expect(parseGenerateHandler(edited)).not.toContain('read_file_b64');
    expect(sorted(Object.keys(commands))).not.toEqual(sorted(parseGenerateHandler(edited)));
  });

  it('ignores comments inside the handler block', () => {
    const src = 'generate_handler![\n a::one, // trailing\n // b::gone,\n a::two,\n]';
    expect(parseGenerateHandler(src)).toEqual(['one', 'two']);
  });
});
