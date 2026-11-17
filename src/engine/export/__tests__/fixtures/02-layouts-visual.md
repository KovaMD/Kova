---
title: Visual Layouts
author: Golden Fixture
date: "2026-01-01"
---

## Title and Image

![A placeholder](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)

---

## Split Layout

Some text that sits beside the picture.

- Point one
- Point two

![Side image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)

---

![Full bleed image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)

---

## Grid Layout
<!-- layout: grid -->

First paragraph cell.

```js
const x = 1;
```

| A | B |
|---|---|
| 1 | 2 |

> [!note]
> A note in a grid cell.

---

## BSP Layout
<!-- layout: bsp -->

Primary pane text.

- Item one
- Item two

```python
print("hi")
```

---

## Code Layout

```typescript
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

---

## Math Layout

$$
E = mc^2
$$

---

## Media Layout

!youtube[Intro video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

---

## Poll Slide

!poll[Vote now](https://example.com/poll)

---

![bg](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)

## Background Image

Text over a full-slide background.

---

## Diagram Fallback

```mermaid
flowchart LR
  A --> B
```
