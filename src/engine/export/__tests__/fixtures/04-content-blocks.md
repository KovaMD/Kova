---
title: Content Blocks
author: Golden Fixture
date: "2026-01-01"
---

## Callout Types

> [!note]
> A note callout.

> [!warning] Custom Warning Title
> Careful with this.

---

## More Callouts

> [!tip]
> A tip.

> [!important]
> Important body.

> [!caution]
> Caution body.

---

## Code With Highlighting

```python
def fib(n):
    # comment
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

Explanation underneath the code.

---

## Plain Code

```
no language here
  indented line
```

---

## Table With Alignment

| Left | Centre | Right |
|:-----|:------:|------:|
| a & b | **bold** | 1 |
| `code` | *em* | 22 |
| x < y | ~~old~~ | 333 |

!caption[Quarterly figures]

---

## Inline Extras

Inline math $a^2 + b^2 = c^2$ in a sentence.

Icons :rocket: and :check: inline.

!progress[Completion](65)

!progress[Testing](30)

---

## Blockquote With Attribution

> Simplicity is prerequisite for reliability.
>
> -- Edsger Dijkstra

Some trailing text.
