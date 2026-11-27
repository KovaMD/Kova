// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGlobalShortcuts, type GlobalShortcutActions } from '../useGlobalShortcuts';

function actions(overrides: Partial<GlobalShortcutActions> = {}): GlobalShortcutActions {
  return {
    newFile: vi.fn(), openFile: vi.fn(), save: vi.fn(), saveAs: vi.fn(),
    toggleFocusMode: vi.fn(), toggleHiddenCurrent: vi.fn(), present: vi.fn(),
    ...overrides,
  };
}

function press(init: KeyboardEventInit, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('useGlobalShortcuts', () => {
  it('runs the default combos and F5 / Shift+F5', () => {
    const a = actions();
    renderHook(() => useGlobalShortcuts({}, false, a));
    expect(press({ key: 's', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(a.save).toHaveBeenCalledTimes(1);
    press({ key: 'n', ctrlKey: true });
    expect(a.newFile).toHaveBeenCalledTimes(1);
    press({ key: 'F5' });
    press({ key: 'F5', shiftKey: true });
    expect(a.present).toHaveBeenNthCalledWith(1, false);
    expect(a.present).toHaveBeenNthCalledWith(2, true);
  });

  it('honours user combos', () => {
    const a = actions();
    renderHook(() => useGlobalShortcuts({ save: 'ctrl+shift+w' }, false, a));
    press({ key: 's', ctrlKey: true });
    expect(a.save).not.toHaveBeenCalled();
    press({ key: 'w', ctrlKey: true, shiftKey: true });
    expect(a.save).toHaveBeenCalledTimes(1);
  });

  it('does nothing while presenting or while typing in an input', () => {
    const a = actions();
    const { rerender } = renderHook(({ presenting }) => useGlobalShortcuts({}, presenting, a), {
      initialProps: { presenting: true },
    });
    press({ key: 'F5' });
    expect(a.present).not.toHaveBeenCalled();
    rerender({ presenting: false });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press({ key: 's', ctrlKey: true }, input);
    expect(a.save).not.toHaveBeenCalled();
    input.remove();
  });

  it('calls the latest actions without re-subscribing, and skips hide-slide when not offered', () => {
    const first = actions();
    const second = actions({ toggleHiddenCurrent: undefined });
    const add = vi.spyOn(window, 'addEventListener');
    const combos = { hideSlide: 'ctrl+h' }; // stable, like App's keybindings state
    const { rerender } = renderHook(({ a }) => useGlobalShortcuts(combos, false, a), {
      initialProps: { a: first },
    });
    const subscriptions = add.mock.calls.filter(([type]) => type === 'keydown').length;
    rerender({ a: second });
    expect(add.mock.calls.filter(([type]) => type === 'keydown').length).toBe(subscriptions);
    press({ key: 'o', ctrlKey: true });
    expect(second.openFile).toHaveBeenCalledTimes(1);
    expect(first.openFile).not.toHaveBeenCalled();
    expect(press({ key: 'h', ctrlKey: true }).defaultPrevented).toBe(false);
    add.mockRestore();
  });
});
