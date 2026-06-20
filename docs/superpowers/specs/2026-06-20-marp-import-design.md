# Tier 1 Marp Import — Design

**Date:** 2026-06-20
**Status:** Approved, pre-implementation
**Branch:** `feat/marp-import`

## Goal

Let a Marp markdown deck open in Kova and look right. Tier 1 = "the 80% deck imports
to Kova's existing layout/theme primitives." Not full Marp fidelity.

One-time **import**: the Marp source is translated once into editable Kova markdown.
The user owns and edits the result. No render-path or engine change.

## Non-goals (Tier 2+, explicitly out of scope)

- Per-slide colors / backgrounds (`_color`, `_backgroundColor`, global `backgroundImage`)
- Real image sizing (`![w:200 h:100]`)
- Marp theme fidelity (`default`/`gaudy`/`uncover` → Kova theme mapping)
- Multi-background tiling (Marp tiles several `![bg]`; Kova has no tiling)
- Marp CSS themes (`/* @theme */`) — different product, never in scope

## Architecture

### Core module — `src/engine/import/marp.ts` (new)

One pure module, no Tauri/React deps, fully unit-testable.

```ts
export function isMarp(src: string): boolean
// true iff frontmatter contains `marp: true`

export function importMarp(src: string): { markdown: string; dropped: string[] }
// markdown: translated Kova markdown, with `<!-- marp: dropped X -->` injected at drop sites
// dropped:  human labels of simplified features, e.g. ["theme:gaudy", "_color"], for the count banner
```

Implementation = ordered regex/text passes over the raw source **before** it ever
reaches `markdownToSlides`. Sequence:

1. **Frontmatter rewrite**
   - `size: 16:9 | 4:3` → `aspect_ratio: "16:9"`
   - `paginate: true` → `theme_overrides.footer.show_slide_number: true`
   - `footer: "x"` → `theme_overrides.footer.text: "x"` + `show: true`
   - `marp: true` → drop (detect flag only)
   - `theme:`, `header:`, `backgroundColor`, `color`, `backgroundImage` → drop + log
2. **Background images** (highest value)
   - `![bg](url)` → `<!-- layout:full-bleed -->` + `![](url)`
   - `![bg left](url)` → `<!-- layout:split -->` + image (image left)
   - `![bg right](url)` → `<!-- layout:split -->` + image (image right)
   - `![bg fit|cover|50%|left:40%]` → same layout, **drop** sizing/fraction + log
   - multiple `![bg]` on one slide → keep first, **drop** rest + log
3. **Per-slide directives**
   - `<!-- _class: lead -->` → `<!-- layout:title -->`
   - other `_class` values → drop + log
   - `<!-- _paginate -->`, `<!-- _color -->`, `<!-- _backgroundColor -->` → drop + log
4. **Image sizing** — strip `w:`/`h:` keywords from `![w:200 h:100](url)`, plain image + log
5. **Speaker notes (the gotcha)** — Marp treats every HTML comment that is NOT a
   recognized directive as a presenter note. So after passes 1–4 consume known
   directives, any leftover `<!-- ... -->` → append as a `???` note for that slide.
6. **Drop logging** — each drop in passes 1–4 also injects `<!-- marp: dropped X -->`
   at its site AND pushes label `X` to `dropped[]`.

Order matters: directive-comments must be matched/consumed (passes 1,3) before the
leftover-comment→notes pass (5), else directives become notes.

### Wiring — `src/App.tsx`

- New handler `importMarp`: file picker (md/markdown) → `read_file` →
  `importMarp(text)` → `applyFileContent(markdown, '')` (new untitled buffer, mirrors
  existing `handleImportFromUrl`) → show count banner if `dropped.length > 0`.
- **Auto-detect on Open:** in the open/`handleMarkdownDrop` path, if `isMarp(text)`,
  show a banner "Marp deck — convert? [Convert] [Open as-is]". Convert runs the same
  translation; Open as-is loads raw text unchanged.

### Wiring — `src/macMenu.ts`

- Add `importMarp: () => void` to `MacMenuHandlers`.
- Add `File > Import > Import from Marp…` next to PowerPoint/URL.

### Loss report banner

No toast library exists in the repo. The "toast count" is realized as a transient,
dismissible **info banner** reusing `MissingThemeBanner` styling — NOT a new toast
dependency. Message: `Imported. N Marp features simplified.` Inline
`<!-- marp: dropped X -->` comments carry the per-site detail.

## Testing

`src/engine/import/__tests__/marp.test.ts` (vitest). ~7 asserts:

- `![bg](url)` → contains `<!-- layout:full-bleed -->`
- `![bg left](url)` → contains `<!-- layout:split -->`
- frontmatter `size: 4:3` → `aspect_ratio: "4:3"`; `paginate: true` → footer slide-number
- `<!-- _class: lead -->` → `<!-- layout:title -->`
- a dropped feature (e.g. `theme: gaudy`) → present in `dropped[]` AND an inline
  `<!-- marp: dropped theme:gaudy -->`
- a non-directive `<!-- speaker text -->` → becomes `???` note, NOT a dropped comment
- `isMarp` true for `marp: true` frontmatter, false otherwise

## Files

- `src/engine/import/marp.ts` (new)
- `src/engine/import/__tests__/marp.test.ts` (new)
- `src/App.tsx` (edit: handler + auto-detect banner)
- `src/macMenu.ts` (edit: handler field + menu item)
- minor banner reuse (no new component if `MissingThemeBanner` flexes)

No engine/render-path change.
