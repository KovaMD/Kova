import { describe, it, expect, vi } from 'vitest';

// Mock the Tauri invoke so the module can be imported without a Tauri context
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import {
  matchShortcut,
  formatCombo,
  getCombo,
  DEFAULT_COMBOS,
} from '../keybindings';

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
});

// ── getCombo ──────────────────────────────────────────────────────────────────

describe('getCombo', () => {
  it('returns user-defined combo when present', () => {
    const combos = { save: 'ctrl+d' };
    expect(getCombo(combos, 'save')).toBe('ctrl+d');
  });

  it('falls back to default combo when user has not customised', () => {
    expect(getCombo({}, 'save')).toBe(DEFAULT_COMBOS.save);
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
    const expected = ['newFile', 'openFile', 'save', 'saveAs', 'focusMode'];
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
