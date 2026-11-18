// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { StrictMode, createElement, type ReactNode } from 'react';
import type { Slide } from '../../engine/types';
import { useOffscreenCapture } from '../useOffscreenCapture';

const slides = (n: number): Slide[] =>
  Array.from({ length: n }, (_, i) => ({ index: i } as unknown as Slide));

function el(id: string): HTMLElement {
  const d = document.createElement('div');
  d.id = id;
  return d;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useOffscreenCapture', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useOffscreenCapture());
    expect(result.current.context).toBe(null);
    expect(result.current.capturing).toBe(null);
  });

  it('mounts the slides and resolves only after N ready signals', async () => {
    const { result } = renderHook(() => useOffscreenCapture());
    const capture = vi.fn(async (els: HTMLElement[]) => els.map((e) => e.id).join(','));
    let promise!: Promise<string>;
    act(() => { promise = result.current.runCapture(slides(3), capture); });
    expect(result.current.context?.slides).toHaveLength(3);
    expect(result.current.capturing).toBe('export');

    act(() => {
      // Registered out of order: capture must still receive slide order.
      result.current.setSlideRef(2, el('c'));
      result.current.setSlideRef(0, el('a'));
      result.current.setSlideRef(1, el('b'));
      result.current.onSlideReady();
      result.current.onSlideReady();
    });
    await act(async () => { vi.runAllTimers(); });
    expect(capture).not.toHaveBeenCalled();

    act(() => { result.current.onSlideReady(); });
    // Deferred to a task, not run synchronously.
    expect(capture).not.toHaveBeenCalled();
    await act(async () => { vi.runAllTimers(); });

    await expect(promise).resolves.toBe('a,b,c');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(result.current.context).toBe(null);
    expect(result.current.capturing).toBe(null);
  });

  it('skips slides whose element never registered', async () => {
    const { result } = renderHook(() => useOffscreenCapture());
    let promise!: Promise<number>;
    act(() => { promise = result.current.runCapture(slides(2), async (els) => els.length); });
    act(() => {
      result.current.setSlideRef(1, el('b'));
      result.current.onSlideReady();
      result.current.onSlideReady();
    });
    await act(async () => { vi.runAllTimers(); });
    await expect(promise).resolves.toBe(1);
  });

  it('ignores ready signals after the capture has fired', async () => {
    const { result } = renderHook(() => useOffscreenCapture());
    const capture = vi.fn(async () => 'ok');
    let promise!: Promise<string>;
    act(() => { promise = result.current.runCapture(slides(1), capture); });
    act(() => {
      result.current.onSlideReady();
      result.current.onSlideReady();
      result.current.onSlideReady();
    });
    await act(async () => { vi.runAllTimers(); });
    await expect(promise).resolves.toBe('ok');
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('rejects and cleans up when capture throws', async () => {
    const { result } = renderHook(() => useOffscreenCapture());
    let promise!: Promise<unknown>;
    act(() => {
      promise = result.current.runCapture(slides(1), async () => { throw new Error('boom'); });
    });
    act(() => {
      result.current.setSlideRef(0, el('a'));
      result.current.onSlideReady();
    });
    const settled = promise.catch((e: unknown) => e);
    await act(async () => { vi.runAllTimers(); });
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
    expect(result.current.context).toBe(null);
    expect(result.current.capturing).toBe(null);

    // Refs were cleared: a fresh run with no registrations sees no elements.
    let next!: Promise<number>;
    act(() => { next = result.current.runCapture(slides(1), async (els) => els.length); });
    act(() => { result.current.onSlideReady(); });
    await act(async () => { vi.runAllTimers(); });
    await expect(next).resolves.toBe(0);
  });

  it('wraps non-Error throws in an Error', async () => {
    const { result } = renderHook(() => useOffscreenCapture());
    let promise!: Promise<unknown>;
    act(() => {
      promise = result.current.runCapture(slides(1), () => Promise.reject('plain'));
    });
    act(() => { result.current.onSlideReady(); });
    const settled = promise.catch((e: unknown) => e);
    await act(async () => { vi.runAllTimers(); });
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toBe('Error: plain');
  });

  it('tags the in-flight capture with its kind', async () => {
    const { result } = renderHook(() => useOffscreenCapture());
    let promise!: Promise<void>;
    act(() => { promise = result.current.runCapture(slides(1), async () => {}, 'print'); });
    expect(result.current.capturing).toBe('print');
    act(() => { result.current.onSlideReady(); });
    await act(async () => { vi.runAllTimers(); });
    await promise;
    expect(result.current.capturing).toBe(null);
  });

  it('is safe under StrictMode double-mount', async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children);
    const { result } = renderHook(() => useOffscreenCapture(), { wrapper });
    const first = result.current.onSlideReady;
    const capture = vi.fn(async (els: HTMLElement[]) => els.map((e) => e.id).join(','));
    let promise!: Promise<string>;
    act(() => { promise = result.current.runCapture(slides(2), capture); });
    // Callbacks stay stable across the StrictMode re-render.
    expect(result.current.onSlideReady).toBe(first);
    act(() => {
      result.current.setSlideRef(0, el('a'));
      result.current.setSlideRef(1, el('b'));
      // StrictMode detaches then re-attaches ref callbacks.
      result.current.setSlideRef(0, null);
      result.current.setSlideRef(0, el('a2'));
      result.current.onSlideReady();
      result.current.onSlideReady();
    });
    await act(async () => { vi.runAllTimers(); });
    await expect(promise).resolves.toBe('a2,b');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(result.current.context).toBe(null);
  });
});
