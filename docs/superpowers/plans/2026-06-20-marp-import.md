# Marp Import (Tier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Marp markdown deck be imported into Kova as editable Kova markdown that looks right.

**Architecture:** One pure module (`src/engine/import/marp.ts`) translates Marp source → Kova markdown via ordered text passes, returning the markdown plus a list of simplified-feature labels. A generic `InfoBanner` surfaces an auto-detect "convert?" prompt and a post-import loss count. App + macMenu wire a File > Import menu item and detect Marp decks on open. No engine/render-path change.

**Tech Stack:** TypeScript, React 19, Vite, Tauri 2, vitest. Markdown engine = remark (unchanged).

**Spec:** `docs/superpowers/specs/2026-06-20-marp-import-design.md`

---

## File Structure

- **Create** `src/engine/import/marp.ts` — `isMarp(src)` + `importMarp(src)`. Pure, no Tauri/React deps. Sole responsibility: Marp→Kova text translation.
- **Create** `src/engine/import/__tests__/marp.test.ts` — vitest unit tests for the module.
- **Create** `src/components/InfoBanner.tsx` — generic dismissible bottom banner with optional action buttons. Reused for the convert-prompt and the loss-count.
- **Modify** `src/macMenu.ts` — add `importMarp` to `MacMenuHandlers` + a File-submenu item.
- **Modify** `src/App.tsx` — import handler, auto-detect on `applyFileContent`, two banner states, render, menu-handler wiring, non-mac toolbar dropdown item.

---

## Task 1: Core module — `isMarp` + `importMarp`

**Files:**
- Create: `src/engine/import/marp.ts`
- Test: `src/engine/import/__tests__/marp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/engine/import/__tests__/marp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isMarp, importMarp } from '../marp';

describe('isMarp', () => {
  it('detects marp:true frontmatter only', () => {
    expect(isMarp('---\nmarp: true\n---\n# Hi')).toBe(true);
    expect(isMarp('---\ntitle: x\n---\n# Hi')).toBe(false);
    expect(isMarp('# Hi')).toBe(false);
  });
});

describe('importMarp', () => {
  it('maps ![bg] to full-bleed and strips marp:true', () => {
    const { markdown } = importMarp('---\nmarp: true\n---\n![bg](a.jpg)');
    expect(markdown).toContain('<!-- layout:full-bleed -->');
    expect(markdown).toContain('![](a.jpg)');
    expect(markdown).not.toContain('marp: true');
  });

  it('maps ![bg left] to split', () => {
    const { markdown } = importMarp('---\nmarp: true\n---\n![bg left](a.jpg)\n\n# Title');
    expect(markdown).toContain('<!-- layout:split -->');
  });

  it('maps frontmatter size and paginate', () => {
    const { markdown } = importMarp('---\nmarp: true\nsize: 4:3\npaginate: true\n---\n# X');
    expect(markdown).toContain('aspect_ratio: "4:3"');
    expect(markdown).toContain('show_slide_number: true');
  });

  it('preserves passthrough frontmatter (title)', () => {
    const { markdown } = importMarp('---\nmarp: true\ntitle: My Deck\n---\n# X');
    expect(markdown).toContain('title: My Deck');
  });

  it('maps _class:lead to layout:title', () => {
    const { markdown } = importMarp('---\nmarp: true\n---\n<!-- _class: lead -->\n# Hi');
    expect(markdown).toContain('<!-- layout:title -->');
  });

  it('logs dropped theme and leaves an inline comment', () => {
    const { markdown, dropped } = importMarp('---\nmarp: true\ntheme: gaudy\n---\n# X');
    expect(dropped).toContain('theme:gaudy');
    expect(markdown).toContain('<!-- marp: dropped theme:gaudy -->');
  });

  it('turns a non-directive comment into a speaker note', () => {
    const { markdown } = importMarp('---\nmarp: true\n---\n# Slide\n\n<!-- remember to smile -->');
    expect(markdown).toContain('???');
    expect(markdown).toContain('remember to smile');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run src/engine/import/__tests__/marp.test.ts`
Expected: FAIL — `Failed to resolve import "../marp"`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/import/marp.ts`:

```ts
// ponytail: Tier 1 Marp import — maps the common-deck constructs onto Kova's
// existing layout/theme primitives via text passes. Per-slide colors, real
// image sizing, theme fidelity, and multi-bg tiling are deliberately dropped
// (Tier 2). Add those only when a real deck needs them.

export interface MarpImportResult {
  markdown: string;
  /** Human labels of simplified features, for the post-import count banner. */
  dropped: string[];
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// A background-image line, e.g. `![bg left:40%](path.jpg)`. Captures the
// modifier string and the URL (first whitespace-delimited token inside `()`).
const BG_LINE = /^!\[bg([^\]]*)\]\(\s*([^)\s]+)[^)]*\)\s*$/;
const SIZE_KW = /\b[wh]:\d+%?/g;
const COMMENT = /<!--([\s\S]*?)-->/g;
// Frontmatter keys Marp owns that we translate or drop; everything else
// (title/author/date/...) passes through unchanged.
const HANDLED_FM = new Set([
  'marp', 'size', 'paginate', 'footer',
  'theme', 'header', 'backgroundColor', 'color', 'backgroundImage',
]);

export function isMarp(src: string): boolean {
  const m = src.match(FM_RE);
  return !!m && /^\s*marp\s*:\s*true\s*$/m.test(m[1]);
}

export function importMarp(src: string): MarpImportResult {
  const dropped: string[] = [];
  const dropTag = (label: string): string => {
    dropped.push(label);
    return `<!-- marp: dropped ${label} -->`;
  };

  // ── Frontmatter ────────────────────────────────────────────────────
  let body = src;
  const passFm: string[] = [];        // frontmatter lines copied verbatim
  const fmDropComments: string[] = []; // inline drop markers for dropped fm keys
  let aspect: string | null = null;
  const footer: { show_slide_number?: boolean; text?: string } = {};

  const fm = src.match(FM_RE);
  if (fm) {
    body = src.slice(fm[0].length);
    for (const raw of fm[1].split(/\r?\n/)) {
      const kv = raw.trim().match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const val = kv[2].replace(/^["']|["']$/g, '').trim();
      switch (key) {
        case 'marp': break; // detect flag only
        case 'size': aspect = val === '4:3' ? '4:3' : '16:9'; break;
        case 'paginate': if (val === 'true') footer.show_slide_number = true; break;
        case 'footer': footer.text = val; break;
        case 'theme': case 'header':
        case 'backgroundColor': case 'color': case 'backgroundImage':
          fmDropComments.push(dropTag(`${key}:${val}`)); break;
        default:
          if (!HANDLED_FM.has(key)) passFm.push(`${key}: ${kv[2]}`);
      }
    }
  }

  const fmLines = [...passFm];
  if (aspect) fmLines.push(`aspect_ratio: "${aspect}"`);
  if (Object.keys(footer).length) {
    fmLines.push('theme_overrides:', '  footer:', '    show: true');
    if (footer.text != null) fmLines.push(`    text: ${JSON.stringify(footer.text)}`);
    if (footer.show_slide_number) fmLines.push('    show_slide_number: true');
  }
  const kovaFm = fmLines.length ? `---\n${fmLines.join('\n')}\n---\n\n` : '';

  // ── Body / slides ──────────────────────────────────────────────────
  const slides = body.split(/^---$/m).map((s) => transformSlide(s, dropTag));
  const prefix = fmDropComments.length ? fmDropComments.join('\n') + '\n\n' : '';

  return {
    markdown: kovaFm + prefix + slides.join('\n---\n').replace(/^\n+/, ''),
    dropped,
  };
}

function transformSlide(slide: string, dropTag: (l: string) => string): string {
  const notes: string[] = [];
  const out: string[] = [];
  let bgUsed = false;

  // Pass 1: background-image lines → layout directive + plain image.
  for (const line of slide.split(/\r?\n/)) {
    const bg = line.match(BG_LINE);
    if (bg) {
      const mods = bg[1];
      if (/(fit|cover|\d+%|:\s*\d)/.test(mods)) dropTag('bg-sizing');
      if (bgUsed) { out.push(dropTag('bg-extra')); continue; }
      bgUsed = true;
      const layout = /\b(left|right)\b/.test(mods) ? 'split' : 'full-bleed';
      out.push(`<!-- layout:${layout} -->`, `![](${bg[2]})`);
      continue;
    }
    out.push(line);
  }
  let text = out.join('\n');

  // Pass 2: inline image sizing `![w:200 h:100](url)` → strip keywords.
  text = text.replace(/!\[([^\]]*)\]/g, (m, alt: string) => {
    if (!/\b[wh]:\d+%?/.test(alt)) return m;
    dropTag('image-size');
    return `![${alt.replace(SIZE_KW, '').replace(/\s+/g, ' ').trim()}]`;
  });

  // Pass 3: comments. _class:lead → layout:title; other Marp directives
  // dropped; our own/Kova directives kept; anything else = a Marp speaker note.
  text = text.replace(COMMENT, (full, inner: string) => {
    const c = inner.trim();
    const cls = c.match(/^_class\s*:\s*(.+)$/);
    if (cls) {
      if (cls[1].trim() === 'lead') return '<!-- layout:title -->';
      dropTag(`_class:${cls[1].trim()}`);
      return '';
    }
    if (/^_/.test(c) || /^(paginate|theme|header|backgroundColor|color|backgroundImage)\b/.test(c)) {
      dropTag(c.split(/[\s:]/)[0]);
      return '';
    }
    if (/^layout\s*:/.test(c) || c === 'hidden' || /^marp: dropped/.test(c)) return full;
    notes.push(c); // leftover comment = presenter note
    return '';
  });

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (notes.length) text += `\n\n???\n${notes.join('\n')}`;
  return text + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run src/engine/import/__tests__/marp.test.ts`
Expected: PASS (8 assertions across 8 `it` blocks).

- [ ] **Step 5: Typecheck**

Run: `rtk proxy npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/import/marp.ts src/engine/import/__tests__/marp.test.ts
git commit -m "feat: Marp→Kova import translation module"
```

---

## Task 2: Generic `InfoBanner` component

**Files:**
- Create: `src/components/InfoBanner.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/InfoBanner.tsx` (styling mirrors `MissingThemeBanner`):

```tsx
interface Action { label: string; onClick: () => void; }

interface Props {
  message: string;
  actions?: Action[];
  onDismiss: () => void;
}

export function InfoBanner({ message, actions = [], onDismiss }: Props) {
  return (
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-elevated)', border: '1px solid var(--border-alt)',
      borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', zIndex: 3000,
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
      fontSize: 12, color: 'var(--text-secondary)', maxWidth: 560, minWidth: 320,
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          style={{
            flexShrink: 0, padding: '4px 12px', fontSize: 11, borderRadius: 4,
            border: '1px solid var(--accent)', background: 'var(--accent-bg)',
            color: 'var(--accent)', cursor: 'pointer', fontWeight: 500,
          }}
        >
          {a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        style={{
          flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', padding: 4, borderRadius: 4, lineHeight: 1,
          display: 'flex', alignItems: 'center',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `rtk proxy npx tsc --noEmit`
Expected: no errors (component unused yet — fine, it's exported).

- [ ] **Step 3: Commit**

```bash
git add src/components/InfoBanner.tsx
git commit -m "feat: generic InfoBanner component"
```

---

## Task 3: Menu wiring (handler field + items)

**Files:**
- Modify: `src/macMenu.ts:12-27` (interface), `src/macMenu.ts:69-70` (File submenu)

- [ ] **Step 1: Add the handler to the interface**

In `src/macMenu.ts`, in `interface MacMenuHandlers`, add after the `importUrl` line (currently line 20):

```ts
  importMarp: () => void;
```

- [ ] **Step 2: Add the menu item**

In `src/macMenu.ts`, in the File submenu `items`, add after the `Import from URL…` item (currently line 70):

```ts
          { text: 'Import from Marp…', action: () => h.importMarp() },
```

- [ ] **Step 3: Typecheck**

Run: `rtk proxy npx tsc --noEmit`
Expected: ERROR — `App.tsx` objects missing `importMarp`. (Fixed in Task 4.) This confirms the interface change is wired; proceed to Task 4 before committing.

---

## Task 4: App wiring — handler, auto-detect, banners

**Files:**
- Modify: `src/App.tsx` (imports ~19-21, state ~103-104, handler near 817, `applyFileContent` 695-717, menu refs 1085/1101, toolbar dropdown ~1296, banner render ~1551)

- [ ] **Step 1: Add imports**

In `src/App.tsx`, after the `ImportUrlModal` import (line 20), add:

```tsx
import { InfoBanner } from './components/InfoBanner';
import { isMarp, importMarp } from './engine/import/marp';
```

- [ ] **Step 2: Add banner state**

After the `showImportUrl` state line (line 104), add:

```tsx
const [marpPrompt, setMarpPrompt] = useState<{ text: string } | null>(null);
const [marpLoss, setMarpLoss]     = useState<number | null>(null);
```

- [ ] **Step 3: Auto-detect on content load**

In `applyFileContent` (line 695), add this as the final statement inside the callback, after `await invoke('start_watching', ...)` (line 716) and before the closing `}, [allThemes]);`:

```tsx
    setMarpPrompt(isMarp(text) ? { text } : null);
```

Note: converted markdown has `marp: true` stripped, so re-applying it never re-triggers the prompt.

- [ ] **Step 4: Add the import handler**

After `handleImportFromUrl` (ends line 821), add:

```tsx
  const handleImportMarp = useCallback(() => {
    guardDirty(async () => { try {
      const selected = await open({
        filters: [{ name: 'Marp Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      await invoke('stop_watching').catch(() => {});
      const text: string = await invoke('read_file', { path: selected });
      const { markdown, dropped } = importMarp(text);
      await applyFileContent(markdown, '');
      setMarpPrompt(null);
      setMarpLoss(dropped.length);
    } catch (err) { console.error('Marp import failed:', err); } });
  }, [guardDirty, applyFileContent]);
```

- [ ] **Step 5: Wire menu handler refs**

In the `menuHandlersRef` object, after `importUrl:` (line 1086), add:

```tsx
    importMarp: handleImportMarp,
```

In the `stableMenuHandlers` object, after `importUrl:` (line 1102), add:

```tsx
    importMarp: () => menuHandlersRef.current.importMarp(),
```

- [ ] **Step 6: Add non-mac toolbar dropdown item**

In the File dropdown, after the `Import from URL…` button (ends line 1297), add:

```tsx
              <button className="btn-group-menu-item" onClick={() => { setFileMenuOpen(false); handleImportMarp(); }}>
                Import from Marp…
              </button>
```

- [ ] **Step 7: Render the banners**

Immediately before the `<MissingThemeBanner` render block (line 1551), add:

```tsx
        {marpPrompt && (
          <InfoBanner
            message="This looks like a Marp deck."
            actions={[{
              label: 'Convert to Kova',
              onClick: () => {
                const { markdown, dropped } = importMarp(marpPrompt.text);
                setMarpPrompt(null);
                void applyFileContent(markdown, '');
                setMarpLoss(dropped.length);
              },
            }]}
            onDismiss={() => setMarpPrompt(null)}
          />
        )}
        {marpLoss != null && marpLoss > 0 && (
          <InfoBanner
            message={`Imported. ${marpLoss} Marp feature${marpLoss === 1 ? '' : 's'} simplified.`}
            onDismiss={() => setMarpLoss(null)}
          />
        )}
```

(The prompt and loss banners never co-occur: converting clears the prompt in the same tick it sets the loss count.)

- [ ] **Step 8: Typecheck**

Run: `rtk proxy npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Run full test suite**

Run: `rtk proxy npx vitest run`
Expected: all pass (existing + new marp tests).

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/macMenu.ts
git commit -m "feat: wire Marp import menu item + auto-detect banner"
```

---

## Task 5: Manual verification + PR

- [ ] **Step 1: Create a sample Marp deck**

Create `/tmp/sample.marp.md`:

```markdown
---
marp: true
theme: gaudy
size: 4:3
paginate: true
title: Sample Deck
---

<!-- _class: lead -->
# Title Slide

---

![bg left](https://picsum.photos/800)

## Split Slide

Text beside the image.

<!-- speaker note here -->
```

- [ ] **Step 2: Run the app**

Run (background): `rtk proxy npm run tauri dev`
Wait until the window shows.

- [ ] **Step 3: Verify import via menu**

File > Import > Import from Marp… → pick `/tmp/sample.marp.md`. Confirm:
- New untitled buffer with `<!-- layout:title -->`, `<!-- layout:split -->`, `aspect_ratio: "4:3"`, footer slide-number, `title: Sample Deck`, `???` note.
- Loss banner shows "Imported. N Marp features simplified." (theme:gaudy dropped).
- Slides render (title slide centered, split slide with image).

- [ ] **Step 4: Verify auto-detect on Open**

File > Open… → pick `/tmp/sample.marp.md`. Confirm the "This looks like a Marp deck." banner appears; click **Convert to Kova** → same converted result as Step 3.

- [ ] **Step 5: Stop the app**

Stop the background dev process.

- [ ] **Step 6: Push and open PR**

```bash
git push fork feat/marp-import
gh pr create --repo kovamd/kova --base main --head vadika:feat/marp-import \
  --title "feat: Tier 1 Marp import" \
  --body "Imports Marp decks into Kova as editable Kova markdown. Maps background images, frontmatter (size/paginate/footer), \`_class:lead\`, and presenter-note comments onto Kova primitives; per-slide colors / image sizing / theme fidelity are deliberately Tier 2 (dropped, logged inline + counted in a banner). Menu item + auto-detect-on-open. Pure translation module with unit tests; no engine/render change.

See \`docs/superpowers/specs/2026-06-20-marp-import-design.md\`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review notes

- **Spec coverage:** bg images (Task1 passes 1-2), frontmatter size/paginate/footer/passthrough (Task1 pass 3-4), `_class:lead` (Task1 pass 5), drop logging + inline comment (Task1 pass 6), notes gotcha (Task1 pass 7), `isMarp` (Task1), menu item (Task3), auto-detect banner + loss banner (Task4), import-to-new-buffer (Task4 handler). All spec sections mapped.
- **Drop coverage nuance:** `bg-sizing` and `image-size` push to `dropped[]` (drive the count) but do not inject an inline comment, since the image still renders — only content-level drops (`bg-extra`, dropped directives, dropped frontmatter keys) leave inline markers. This is the intended "best-effort detail" from the spec.
- **Type consistency:** `MarpImportResult { markdown, dropped }` used identically in module, App handler, and convert action. `importMarp`/`isMarp` names consistent across all call sites.
