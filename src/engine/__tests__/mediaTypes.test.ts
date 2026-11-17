import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, MEDIA_EXTENSIONS,
  IMAGE_DIALOG_FILTER, MEDIA_DIALOG_FILTER, extensionRegex,
} from '../mediaTypes';
import { MEDIA_EXT_RE, VIDEO_EXT_RE } from '../resolveMediaPath';
import { MEDIA_EXT } from '../../components/editor/mediaSnippet';

describe('mediaTypes', () => {
  it('media list is images followed by videos, with no duplicates', () => {
    expect([...MEDIA_EXTENSIONS]).toEqual([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
    expect(new Set(MEDIA_EXTENSIONS).size).toBe(MEDIA_EXTENSIONS.length);
  });

  it('dialog filters are derived from the lists', () => {
    expect(IMAGE_DIALOG_FILTER.extensions).toEqual([...IMAGE_EXTENSIONS]);
    expect(MEDIA_DIALOG_FILTER.extensions).toEqual([...MEDIA_EXTENSIONS]);
    expect(IMAGE_DIALOG_FILTER.extensions).toContain('webp');
  });

  it('every listed extension matches the derived regexes, in any case', () => {
    for (const ext of MEDIA_EXTENSIONS) {
      expect(MEDIA_EXT_RE.test(`a/b.${ext}`)).toBe(true);
      expect(MEDIA_EXT_RE.test(`a/b.${ext.toUpperCase()}?v=1`)).toBe(true);
      expect(MEDIA_EXT.test(`a/b.${ext}`)).toBe(true);
    }
    for (const ext of VIDEO_EXTENSIONS) expect(VIDEO_EXT_RE.test(`clip.${ext}#t=2`)).toBe(true);
    for (const ext of IMAGE_EXTENSIONS) expect(VIDEO_EXT_RE.test(`pic.${ext}`)).toBe(false);
  });

  it('regexes reject unlisted extensions', () => {
    expect(MEDIA_EXT_RE.test('notes.md')).toBe(false);
    expect(MEDIA_EXT.test('deck.pptx')).toBe(false);
    expect(MEDIA_EXT.test('photo.png?x')).toBe(false);
    expect(extensionRegex(['png']).test('a.pngx')).toBe(false);
  });

  it('Rust read_file_b64 allow-list matches the TS list (plus pptx)', () => {
    const src = readFileSync(resolve(__dirname, '../../../src-tauri/src/commands/assets.rs'), 'utf8');
    const block = src.match(/fn read_file_b64[\s\S]*?matches!\(([\s\S]*?)\);/);
    expect(block).not.toBeNull();
    const rustExts = [...block![1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
    expect(new Set(rustExts)).toEqual(new Set([...MEDIA_EXTENSIONS, 'pptx']));
  });
});
