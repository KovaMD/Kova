---
title: Callouts & admonition boxes
author: Kova
---

# Callouts & admonition boxes

Start a blockquote with `[!type]` to turn it into a colour-coded admonition box — Obsidian and GitHub style — instead of a plain pull quote.

Kova supports **5 canonical styles** (`note`, `info`, `tip`, `warning`, `danger`) and **21 aliases** that map onto them. Type `> [!` in the editor for autocomplete.

---

## The five canonical styles

> [!note]
> Neutral reference notes, background context, and summaries.

> [!info]
> Helpful context, questions, or FAQ items worth highlighting.

> [!tip]
> Best practices, shortcuts, and positive takeaways.

|||

> [!warning]
> Important caveats or things the audience should watch out for.

> [!danger]
> Errors, bugs, breaking changes, and things to avoid.

---

## Titles, casing, and fallbacks

Markers are case-insensitive (`[!tip]`, `[!TIP]`). Omit the title to capitalise the marker name, or write a custom title after `[!type]`:

```markdown
> [!tip] Pro move
> Optional custom title after the marker.

> [!caution]
> No custom title? Kova capitalises "Caution".

> [!custom]
> Unknown types fall back to the `note` style.
```

|||

> [!tip] Pro move
> Optional custom title after the marker.

> [!caution]
> No custom title? Kova capitalises `"Caution"`.

> [!custom]
> Unknown types fall back to the `note` style.

---

## Rich content inside a callout

Callouts support **bold**, *italics*, `inline code`, links, multiple paragraphs, and nested lists:

> [!info] What fits inside a callout?
> Keep callouts focused so they scan well on a slide:
>
> - Short explanations with `inline code` or **emphasis**
> - Nested checklists or step-by-step reminders
>   - Sub-items work just like regular Markdown lists

A plain `>` blockquote without `[!type]` remains a quote — and on a slide with no title, only plain quotes expand into the full-slide `quote` layout.

---

## All 21 aliases at a glance

| Canonical style | Accepted aliases |
|---|---|
| `note` | `abstract`, `summary`, `tldr`, `quote`, `cite`, `example` |
| `info` | `question`, `help`, `faq` |
| `tip` | `hint`, `important`, `success`, `check`, `done` |
| `warning` | `caution`, `attention` |
| `danger` | `error`, `failure`, `fail`, `bug`, `missing` |

---

## Reveal a callout on click

Just like other block elements, place `<!-- step -->` on the line right underneath to reveal a callout during a build (see `examples/animations-demo.md`):

```markdown
> [!warning] Don't forget
> This box appears on the next click in Presentation mode.
<!-- step -->
```

|||

> [!warning] Don't forget
> This box appears on the next click in Presentation mode.
<!-- step -->

---

## What just happened

- `> [!type]` turns a blockquote into a colour-coded callout box (case-insensitive)
- Five canonical styles (`note`, `info`, `tip`, `warning`, `danger`) plus **21 aliases**
- Omit the title to use the capitalised marker name, or add a custom title after `[!type]`
- Unknown markers fall back to the `note` style instead of breaking
- Type `> [!` in the editor to pick any style or alias from autocomplete
- Exports cleanly to **PowerPoint**, **PDF**, and standalone **HTML**
