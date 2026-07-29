# Contributing to Kova

Thanks for taking an interest in Kova. This guide covers how to get set up, how
Kova's Markdown syntax is organised, and what to think about when proposing a
new syntax extension.

## Questions

For quick questions — "is this a bug or intended?", "would a PR for X be
welcome?", general chat with the dev team — join
[#kova-md:matrix.org](https://matrix.to/#/#kova-md:matrix.org) rather than
opening an issue. Issues are still the right place for bug reports and feature
proposals that need to be tracked.

## Getting Set Up

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/)
(stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your platform.

```bash
git clone https://github.com/<your-username>/Kova.git
cd Kova
npm install
npm run tauri dev      # development — hot-reload
```

Nix users can skip the prerequisites — `nix develop` drops you in a shell with
Rust, Node, and Tauri ready.

Before opening a PR:

```bash
npm run test           # vitest
npm run build          # tsc + vite build
```

Commit messages follow `type(scope): summary` (`fix(toc): …`, `feat: …`) — see
`git log` for examples. Keep the summary focused on *why*, not *what*.

## Markdown Syntax Conventions

This is the part that matters most for contributors adding a feature, since
it's easy to accumulate one-off ad hoc syntax over time. Kova currently uses
four distinct forms, each with a specific job. If you're adding a new
directive, find which category it belongs to below rather than inventing a
fifth form.

All of this is parsed in `src/engine/parser/` — mainly
[`markdownToSlides.ts`](src/engine/parser/markdownToSlides.ts).

### 1. Frontmatter (document-level metadata)

A YAML block at the very top of the file, applies once to the whole deck:
`title`, `author`, `theme`, `theme_overrides`, `aspect_ratio`, `date`, `logo`,
`footer`. See the `Frontmatter` type in
[`src/engine/types.ts`](src/engine/types.ts).

Use this for anything that describes the *document*, not an individual slide.

### 2. Slide separator and structural markers (bare tokens)

A small, closed set of bare tokens, each alone on its own line:

| Token | Meaning |
|---|---|
| `---` | slide separator |
| `???` | everything after this becomes speaker notes ([`speakerNotes.ts`](src/engine/parser/speakerNotes.ts)) |
| `\|\|\|` | column break within a slide |

**This set is intentionally closed.** Bare tokens have no room for parameters,
are easy to collide with legitimate Markdown a user is typing (a table row
using `|||`, a line of dashes), and are hard to discover. Don't add new ones —
use an HTML comment or a bang-directive instead (below).

### 3. Slide-level flags/overrides (HTML comments)

`<!-- hidden -->` and `<!-- layout: NAME -->`, each alone on its own line
within a slide. These:

- carry no visible content of their own (they're stripped before rendering),
- toggle something about how the *slide itself* is treated,
- degrade gracefully — a plain Markdown viewer just sees a comment.

This is the pattern from [issue #79](https://github.com/KovaMD/Kova/issues/79):
`<!-- key -->` for a flag, `<!-- key: value -->` for a flag with a value.
**Prefer this form for new slide-level steering information** (e.g. a future
per-slide transition, a slide ID for intra-deck links) rather than inventing
new bare tokens or frontmatter-like blocks mid-document.

**Element-level extension:** `<!-- step -->` / `<!-- step: N -->` (build-reveal
order, [issue #92](https://github.com/KovaMD/Kova/issues/92)) uses this same
comment syntax but attaches to a single *element* rather than the whole slide —
trailing on the same line for a paragraph or list item, or on its own line
immediately after a block element (image, code fence, table, math, mermaid,
blockquote, or a whole list), mirroring how `!caption` already attaches to
"whichever element it directly follows." This is a deliberate, narrow
extension of the category-3 pattern to element scope, not a new category:
still a plain HTML comment, still stripped before rendering, still degrades
gracefully in a plain Markdown viewer. Reach for this same attach-to-the-
preceding-element mechanism before inventing a different one if you're adding
another element-scoped (rather than slide-scoped) flag.

### 4. Content directives (bang syntax)

`!name[label](target)`, each alone on its own line, for things that *render
visible content* in place: `!youtube[label](url)`, `!video[label](path.mp4)`,
`!poll[label](url)`, `!progress[label](value)`, `!ref[Author, Year. Title]`,
and the parameter-less `!toc`.

Use this form when the directive produces an actual slide element (an embed,
a chart, a reference footnote) — as opposed to category 3, which only changes
slide *behaviour*.

`!caption[text]` is a variant of this form that never becomes its own slide
element: it attaches to whichever image, Mermaid diagram, or math block it
directly follows, merged in by the parser, and renders centered underneath
that element. A `!caption` with no such element immediately above it (or
following anything else) is a compile error, same as a misplaced `!sheet`.

### 5. Template variables

`{title}`, `{author}`, `{date}`, `{slide_number}`, `{total}` — text substitution inside
header/footer strings only (`theme_overrides.header.text`,
`.footer.text`, or a theme's YAML). Resolved in
[`src/engine/theme.ts`](src/engine/theme.ts) (`resolveTemplate`). Not valid
inside slide body content.

### Adding a new directive — checklist

1. Decide which of the four categories above it belongs to (there's no fifth).
2. Add parsing to `preprocess()` or the relevant extractor in
   `src/engine/parser/`.
3. Strip the raw marker from rendered content — don't let it leak into the
   slide body.
4. Add cases to
   [`src/engine/__tests__/parser.test.ts`](src/engine/__tests__/parser.test.ts).
5. Document the syntax in the README's Features list and, if it's a
   significant one, add an editor snippet
   (see [`EditorPanel.tsx`](src/components/layout/EditorPanel.tsx)).

## UI changes and localisation

Kova uses a custom i18n layer (`useT()` hook) rather than an external library.
`src/i18n/en.ts` is the source of truth for all user-facing strings. If your
change introduces a new UI element with visible text (a button, menu item,
dialog, tooltip, etc.), add the corresponding key(s) to `en.ts` and use
`useT()` to render it rather than hardcoding the string — don't leave it to be
backfilled later.

## Reporting issues / proposing features

Open an issue on GitHub describing the use case, not just the syntax you have
in mind — for syntax proposals in particular, tell us which category above you
think it fits, since that shapes the design more than the exact spelling does.
