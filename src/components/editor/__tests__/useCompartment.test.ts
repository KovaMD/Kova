// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { Compartment, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCompartment } from '../useCompartment';

// A dispatch-only stand-in: the hook never touches anything else on the view.
function fakeViewRef() {
  const dispatch = vi.fn();
  const ref = { current: { dispatch } as unknown as EditorView } as RefObject<EditorView | null>;
  return { ref, dispatch };
}

const compartment = new Compartment();
const toExtension = (on: boolean): Extension => (on ? [compartment.of([])] : []);

describe('useCompartment', () => {
  it('reconfigures the compartment on mount with the built extension', () => {
    const { ref, dispatch } = fakeViewRef();
    renderHook(() => useCompartment(ref, compartment, true, toExtension));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const effects = dispatch.mock.calls[0][0].effects;
    expect(effects.is(compartment.reconfigure([]).type)).toBe(true);
  });

  it('reconfigures again only when the input value changes', () => {
    const { ref, dispatch } = fakeViewRef();
    const { rerender } = renderHook(
      ({ value }) => useCompartment(ref, compartment, value, toExtension),
      { initialProps: { value: false } },
    );
    expect(dispatch).toHaveBeenCalledTimes(1);

    rerender({ value: false }); // unrelated re-render, same input
    rerender({ value: false });
    expect(dispatch).toHaveBeenCalledTimes(1);

    rerender({ value: true });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('passes the current input to the extension builder', () => {
    const { ref } = fakeViewRef();
    const build = vi.fn((v: string): Extension => (v ? [] : []));
    const { rerender } = renderHook(
      ({ value }) => useCompartment(ref, compartment, value, build),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    expect(build.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('does nothing while the view has not been created yet', () => {
    const ref = { current: null } as RefObject<EditorView | null>;
    const build = vi.fn(toExtension);
    expect(() =>
      renderHook(() => useCompartment(ref, compartment, true, build)),
    ).not.toThrow();
    expect(build).not.toHaveBeenCalled();
  });
});
