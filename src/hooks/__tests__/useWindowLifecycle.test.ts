// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const calls = vi.hoisted(() => [] as string[]);
const ipc = vi.hoisted(() => ({
  setWakeLock: vi.fn(async (active: boolean) => { calls.push(`setWakeLock(${active})`); }),
  confirmExit: vi.fn(async () => { calls.push('confirmExit'); }),
}));
vi.mock('../../platform/ipc', () => ipc);

const hooks = vi.hoisted(() => ({
  closeRequested: null as null | ((e: { preventDefault: () => void }) => void),
  exitRequested: null as null | (() => void),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (h: (e: { preventDefault: () => void }) => void) => {
      hooks.closeRequested = h;
      return () => { hooks.closeRequested = null; };
    },
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: () => void) => {
    if (name === 'app-exit-requested') hooks.exitRequested = h;
    return () => { hooks.exitRequested = null; };
  },
}));

import { useWindowLifecycle } from '../useWindowLifecycle';

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); });

describe('useWindowLifecycle', () => {
  it('quitApp releases the wake lock before confirming exit, even if the first call fails', async () => {
    ipc.setWakeLock.mockRejectedValueOnce(new Error('no lock'));
    const { result } = renderHook(() => useWindowLifecycle({ guardDirty: (go) => go() }));
    await act(() => result.current.quitApp());
    expect(ipc.setWakeLock).toHaveBeenCalledWith(false);
    expect(ipc.confirmExit).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['confirmExit']); // the rejected setWakeLock never recorded
  });

  it('routes the OS window close and the app quit through guardDirty', async () => {
    const guardDirty = vi.fn();
    renderHook(() => useWindowLifecycle({ guardDirty }));
    await act(async () => {});
    const preventDefault = vi.fn();
    hooks.closeRequested!({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    hooks.exitRequested!();
    expect(guardDirty).toHaveBeenCalledTimes(2);
    expect(ipc.confirmExit).not.toHaveBeenCalled();
    // Proceeding from the guard quits.
    await act(async () => { await guardDirty.mock.calls[0][0](); });
    expect(calls).toEqual(['setWakeLock(false)', 'confirmExit']);
  });
});
