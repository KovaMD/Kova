import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  matchShortcut,
  formatCombo,
  getCombo,
  loadKeybindings,
  DEFAULT_COMBOS,
} from '../keybindings';
import type { KeybindingsStore } from '../ports';

// In-memory KeybindingsStore fake, passed straight to loadKeybindings.
const mockedInvoke = vi.fn<KeybindingsStore['loadKeybindings']>();
const store: KeybindingsStore = { loadKeybindings: mockedInvoke };

beforeEach(() => {
  mockedInvoke.mockReset();
});

// ── matchShortcut ─────────────────────────────────────────────────────────────

function mockEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    key: '',
    ...overrides,
  } as KeyboardEvent;
}

describe('matchShortcut', () => {
  it('matches ctrl+s', () => {
    const e = mockEvent({ ctrlKey: true, key: 's' });
    expect(matchShortcut(e, 'ctrl+s')).toBe(true);
  });

  it('matches ctrl+shift+s', () => {
    const e = mockEvent({ ctrlKey: true, shiftKey: true, key: 'S' });
    expect(matchShortcut(e, 'ctrl+shift+s')).toBe(true);
  });

  it('does not match when ctrl is required but missing', () => {
    const e = mockEvent({ key: 's' });
    expect(matchShortcut(e, 'ctrl+s')).toBe(false);
  });

  it('does not match when shift is required but missing', () => {
    const e = mockEvent({ ctrlKey: true, key: 'S' });
    expect(matchShortcut(e, 'ctrl+shift+s')).toBe(false);
  });

  it('does not match wrong key', () => {
    const e = mockEvent({ ctrlKey: true, key: 'o' });
    expect(matchShortcut(e, 'ctrl+s')).toBe(false);
  });

  it('matches meta key as ctrl equivalent', () => {
    // On Mac, metaKey is the Command key — treated as equivalent to ctrl
    const e = mockEvent({ metaKey: true, key: 's' });
    expect(matchShortcut(e, 'ctrl+s')).toBe(true);
  });

  it('returns false for empty combo string', () => {
    const e = mockEvent({ ctrlKey: true, key: 's' });
    expect(matchShortcut(e, '')).toBe(false);
  });

  it('matches alt modifier', () => {
    const e = mockEvent({ altKey: true, key: 'p' });
    expect(matchShortcut(e, 'alt+p')).toBe(true);
  });

  it('does not match when extra modifier is held', () => {
    const e = mockEvent({ ctrlKey: true, altKey: true, key: 's' });
    expect(matchShortcut(e, 'ctrl+s')).toBe(false);
  });

  it('matches a modifier-less single-key combo', () => {
    const e = mockEvent({ key: 'a' });
    expect(matchShortcut(e, 'a')).toBe(true);
  });

  it('matches a modifier-less combo case-insensitively', () => {
    const e = mockEvent({ key: 'A' });
    expect(matchShortcut(e, 'a')).toBe(true);
  });

  it('rejects a modifier-less combo when ctrl is held', () => {
    const e = mockEvent({ ctrlKey: true, key: 'a' });
    expect(matchShortcut(e, 'a')).toBe(false);
  });

  it('rejects a modifier-less combo when shift is held', () => {
    const e = mockEvent({ shiftKey: true, key: 'a' });
    expect(matchShortcut(e, 'a')).toBe(false);
  });
});

// ── formatCombo ───────────────────────────────────────────────────────────────

describe('formatCombo', () => {
  it('capitalises ctrl', () => {
    expect(formatCombo('ctrl+s')).toBe('Ctrl+S');
  });

  it('capitalises shift', () => {
    expect(formatCombo('ctrl+shift+s')).toBe('Ctrl+Shift+S');
  });

  it('capitalises alt', () => {
    expect(formatCombo('alt+f')).toBe('Alt+F');
  });

  it('capitalises meta as Cmd', () => {
    expect(formatCombo('meta+s')).toBe('Cmd+S');
  });

  it('handles single-character keys', () => {
    expect(formatCombo('ctrl+n')).toBe('Ctrl+N');
  });

  it('handles multi-character keys', () => {
    expect(formatCombo('ctrl+escape')).toBe('Ctrl+Escape');
  });

  it('formats a ctrl+alt composite combo', () => {
    expect(formatCombo('ctrl+alt+f')).toBe('Ctrl+Alt+F');
  });

  it('formats a meta composite combo as Cmd alongside another modifier', () => {
    expect(formatCombo('meta+shift+k')).toBe('Cmd+Shift+K');
  });

  it('capitalises every segment of a three-part combo with a multi-char key', () => {
    expect(formatCombo('ctrl+shift+arrowup')).toBe('Ctrl+Shift+Arrowup');
  });
});

// ── getCombo ──────────────────────────────────────────────────────────────────

describe('getCombo', () => {
  it('returns user-defined combo when present', () => {
    const combos = { save: 'ctrl+d' };
    expect(getCombo(combos, 'save')).toBe('ctrl+d');
  });

  it('falls back to default combo when user has not customised', () => {
    expect(getCombo({}, 'save')).toBe(DEFAULT_COMBOS.save);
    expect(getCombo({}, 'hideSlide')).toBe('ctrl+shift+h');
  });

  it('falls back to empty string for unknown action', () => {
    expect(getCombo({}, 'nonExistentAction')).toBe('');
  });

  it('user-defined combo takes priority over default', () => {
    const combos = { newFile: 'ctrl+alt+n' };
    expect(getCombo(combos, 'newFile')).toBe('ctrl+alt+n');
  });
});

// ── DEFAULT_COMBOS integrity ──────────────────────────────────────────────────

describe('DEFAULT_COMBOS', () => {
  it('defines all expected actions', () => {
    const expected = ['newFile', 'openFile', 'save', 'saveAs', 'focusMode', 'hideSlide'];
    for (const action of expected) {
      expect(DEFAULT_COMBOS[action], action).toBeTruthy();
    }
  });

  it('all defaults start with ctrl', () => {
    for (const [action, combo] of Object.entries(DEFAULT_COMBOS)) {
      expect(combo, action).toMatch(/^ctrl\+/);
    }
  });
});

// ── loadKeybindings (YAML parse via ipc) ──────────────────────────────────────

describe('loadKeybindings', () => {
  it('returns the config path from load_keybindings', async () => {
    mockedInvoke.mockResolvedValueOnce(['/config/kova.yaml', 'save: ctrl+s\n']);
    const { path } = await loadKeybindings(store);
    expect(path).toBe('/config/kova.yaml');
  });

  it('maps snake_case YAML keys to camelCase action ids', async () => {
    mockedInvoke.mockResolvedValueOnce([
      '/config/kova.yaml',
      'save: ctrl+d\nopen_file: ctrl+shift+o\nfocus_mode: ctrl+alt+f\n',
    ]);
    const { combos } = await loadKeybindings(store);
    expect(combos).toEqual({
      save: 'ctrl+d',
      openFile: 'ctrl+shift+o',
      focusMode: 'ctrl+alt+f',
    });
  });

  it('lowercases and trims combo strings', async () => {
    mockedInvoke.mockResolvedValueOnce(['/p', 'save:   CTRL+S   \n']);
    const { combos } = await loadKeybindings(store);
    expect(combos.save).toBe('ctrl+s');
  });

  it('ignores unknown keys and non-string values', async () => {
    mockedInvoke.mockResolvedValueOnce(['/p', 'custom_action: ctrl+x\nsave: true\n']);
    const { combos } = await loadKeybindings(store);
    expect(combos).toEqual({});
  });

  it('returns empty combos for malformed YAML', async () => {
    mockedInvoke.mockResolvedValueOnce(['/p', ': bad: yaml:\n']);
    const { combos } = await loadKeybindings(store);
    expect(combos).toEqual({});
  });
});
