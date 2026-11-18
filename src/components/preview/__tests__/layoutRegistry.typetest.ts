// Type-level test, checked by `tsc --noEmit` (npm run typecheck), not Vitest:
// tsconfig excludes *.test.ts, so this file is deliberately named .typetest.ts.
//
// The preview layout registry must cover every LayoutType. Each expect-error
// directive below asserts that a registry missing a layout fails to
// type-check; if the constraint ever stopped catching that, the directive
// would be unused and tsc would fail instead.
import type { LayoutType } from '../../../engine/types';
import { previewLayouts, type PreviewLayoutRenderer } from '../layouts';

// The real registry satisfies the full constraint.
export const complete = previewLayouts satisfies Record<LayoutType, PreviewLayoutRenderer>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { title: _title, ...withoutTitle } = previewLayouts;
// @ts-expect-error a registry missing 'title' is a compile error
export const missingTitle = withoutTitle satisfies Record<LayoutType, PreviewLayoutRenderer>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { 'three-column': _three, ...withoutThreeColumn } = previewLayouts;
// @ts-expect-error a registry missing 'three-column' is a compile error
export const missingThreeColumn = withoutThreeColumn satisfies Record<LayoutType, PreviewLayoutRenderer>;
