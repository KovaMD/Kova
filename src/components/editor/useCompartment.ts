import { useEffect, type RefObject } from 'react';
import type { Compartment, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Keeps a CodeMirror compartment in step with a React value.
 *
 * Reconfigures `compartment` with `toExtension(value)` on mount and whenever
 * `value` changes. It keys on the plain input rather than on the built
 * extension, because builders such as `EditorView.theme(...)` return a fresh
 * object each call, which would otherwise reconfigure on every render.
 *
 * `toExtension` must be stable (a module-level function), and `value` should
 * be a primitive, so unrelated re-renders do not dispatch. While the view does
 * not exist yet (`viewRef.current` is null) nothing is built or dispatched.
 */
export function useCompartment<T>(
  viewRef: RefObject<EditorView | null>,
  compartment: Compartment,
  value: T,
  toExtension: (value: T) => Extension,
): void {
  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartment.reconfigure(toExtension(value)) });
  }, [viewRef, compartment, value, toExtension]);
}
