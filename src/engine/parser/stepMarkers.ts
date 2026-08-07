// Auto-incrementing `<!-- step -->` / grouped `<!-- step: N -->` build-reveal
// marker. Shared by the parser and the editor's CodeMirror decoration so the
// numbers shown while editing can never drift from what the parser assigns.

// The marker's actual syntax, unanchored — the one place it's spelled out.
// Consumers that need it anchored differently (mid-line, end-of-line with
// leading whitespace, etc. — see stepMarkerDecoration.ts and
// contextMenuActions.ts) build their own RegExp from this string rather than
// re-deriving the pattern, so a future syntax tweak can't update one copy
// and silently miss another.
export const STEP_MARKER_PATTERN = '<!--\\s*step(?:\\s*:\\s*(\\d+))?\\s*-->';

export const STEP_MARKER_RE = new RegExp(`^${STEP_MARKER_PATTERN}$`);

/**
 * Matches a (trimmed) raw string as a step marker.
 * Returns `undefined` when it isn't a step marker at all, `null` for a bare
 * `<!-- step -->`, or the explicit group number for `<!-- step: N -->`.
 */
export function matchStepMarker(raw: string): number | null | undefined {
  const m = raw.trim().match(STEP_MARKER_RE);
  if (!m) return undefined;
  return m[1] !== undefined ? parseInt(m[1], 10) : null;
}

export type StepAssigner = (explicit: number | null) => number;

/**
 * One assigner per slide — steps are slide-scoped and never carry across a
 * slide separator. An explicit number groups elements into the same click and
 * also advances the auto-increment cursor past itself, so a bare marker
 * written after an explicit one continues from there rather than colliding
 * with it or going backwards.
 */
export function createStepAssigner(): StepAssigner {
  let nextAuto = 1;
  return (explicit) => {
    if (explicit === null) return nextAuto++;
    nextAuto = Math.max(nextAuto, explicit + 1);
    return explicit;
  };
}
