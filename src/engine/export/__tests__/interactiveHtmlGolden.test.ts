// @vitest-environment jsdom
//
// Golden (characterisation) tests for the interactive HTML export, refactor
// card P0-06. These pin the *structure* of buildInteractiveDocument's output
// (DOM outline, chrome CSS, navigation script), not pixels, so later refactors
// can move code around while proving the exported file is unchanged. Volatile
// payloads (base64 blobs) are replaced by a short content hash and length.
// Any change to these snapshots must be explained in its PR.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// Deterministic Tauri IPC: every local file reads as the same bytes, every
// remote fetch returns a fixed PNG payload.
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === 'read_file_b64') return Buffer.from(`file:${String(args?.path)}`).toString('base64');
  if (cmd === 'fetch_url_b64') return [Buffer.from(`url:${String(args?.url)}`).toString('base64'), 'image/png'];
  throw new Error(`unexpected invoke: ${cmd}`);
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [string, Record<string, unknown>])),
}));

import { buildInteractiveDocument } from '../exportPdfNative';
import { mermaidSvgCache } from '../mermaidSvgCache';
import type { Slide } from '../../types';

// ── Normalisation helpers ────────────────────────────────────────────────────

const DATA_URI_RE = /data:([^;,"')\s]+);base64,([A-Za-z0-9+/=]+)/g;

/** Replace base64 payloads with a stable short hash so snapshots stay small. */
function normalise(s: string): string {
  return s.replace(DATA_URI_RE, (_m, mime: string, b64: string) => {
    const h = createHash('sha256').update(b64).digest('hex').slice(0, 10);
    return `data:${mime};base64,<sha256:${h} len:${b64.length}>`;
  });
}

const OUTLINE_ATTRS = [
  'id', 'role', 'aria-label', 'aria-hidden', 'aria-live', 'data-index', 'data-step',
  'data-mermaid-src', 'src', 'controls', 'preload', 'playsinline', 'preserveAspectRatio', 'viewBox', 'width', 'height',
];

/** Indented tag/class/attribute outline of an element tree, plus short text. */
function outline(el: Element, depth = 0, out: string[] = []): string[] {
  const pad = '  '.repeat(depth);
  const cls = el.getAttribute('class');
  const attrs = OUTLINE_ATTRS
    .filter((a) => el.hasAttribute(a))
    .map((a) => `${a}=${JSON.stringify(normalise(el.getAttribute(a) ?? ''))}`);
  const style = el.getAttribute('style');
  if (style) attrs.push(`style=${JSON.stringify(style)}`);
  out.push(`${pad}<${el.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1) {
      const child = node as Element;
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') {
        out.push(`${pad}  <${child.tagName.toLowerCase()}> (${child.textContent?.length ?? 0} chars)`);
      } else {
        outline(child, depth + 1, out);
      }
    } else if (node.nodeType === 3) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim();
      if (text) out.push(`${pad}  "${text}"`);
    }
  }
  return out;
}

interface Parsed {
  doctype: string;
  head: string[];
  body: string[];
  css: string;
  script: string;
}

function parse(html: string): Parsed {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const style = doc.querySelector('head style')?.textContent ?? '';
  const script = doc.querySelector('body script')?.textContent ?? '';
  return {
    doctype: html.slice(0, html.indexOf('\n')),
    head: Array.from(doc.head.children)
      .filter((c) => c.tagName !== 'STYLE')
      .map((c) => c.outerHTML),
    body: outline(doc.body),
    css: normalise(style),
    script,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PAGE_CSS = `
@font-face { font-family: "Kova Icons"; src: url("data:font/woff2;base64,QUJDREVGRw==") format("woff2"); }
.slide-frame { color: #222; }
.sl-step-item--pending { opacity: 0; }
`;

function slide(stepValues: number[] = []): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0, speakerNotes: '', references: [],
    layout: 'content', hidden: false,
    elements: stepValues.map((step) => ({ type: 'paragraph', text: '', step })),
  } as unknown as Slide;
}

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html.trim();
  return host.firstElementChild as HTMLElement;
}

const SLIDE_A = `
<div class="slide-wrap">
  <div class="slide-frame" style="--sl-bg: #102030;">
    <h1 class="sl-title">Golden deck</h1>
    <img class="sl-image" src="asset://localhost/home/user/deck/pic.png" alt="local">
    <img class="sl-image" src="https://example.com/remote.png" alt="remote">
  </div>
</div>`;

const SLIDE_B = `
<div class="slide-wrap">
  <div class="slide-frame">
    <ul class="sl-list">
      <li data-step="1">First</li>
      <li data-step="3">Second</li>
    </ul>
    <div class="sl-video">
      <div class="sl-video__placeholder" data-video-src="asset://localhost/home/user/deck/clip.mp4">Play</div>
    </div>
  </div>
</div>`;

const MERMAID_SRC = 'graph TD; A-->B';
const SLIDE_C = `
<div class="slide-wrap">
  <div class="slide-frame">
    <div class="sl-mermaid-pending" data-mermaid-src="${MERMAID_SRC}"></div>
  </div>
</div>`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildInteractiveDocument golden structure (P0-06)', () => {
  let styleEl: HTMLStyleElement;

  beforeEach(() => {
    styleEl = document.createElement('style');
    styleEl.textContent = PAGE_CSS;
    document.head.appendChild(styleEl);
    mermaidSvgCache.set(MERMAID_SRC, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" style="max-width: 200px;" viewBox="0 0 200 100"><g><text>A</text></g></svg>');
    invoke.mockClear();
  });

  afterEach(() => {
    styleEl.remove();
    mermaidSvgCache.clear();
  });

  async function build(ar = { w: 16, h: 9 }): Promise<string> {
    return buildInteractiveDocument(
      [el(SLIDE_A), el(SLIDE_B), el(SLIDE_C)],
      ar,
      [slide(), slide([3, 1]), slide()],
    );
  }

  it('produces a byte-identical document on repeated runs', async () => {
    expect(await build()).toBe(await build());
  });

  it('matches the golden document structure (16:9)', async () => {
    const parsed = parse(await build());
    expect(parsed.doctype).toBe('<!DOCTYPE html>');
    expect(parsed.head).toMatchSnapshot('head');
    expect(parsed.body.join('\n')).toMatchSnapshot('body outline');
  });

  it('matches the golden chrome CSS (16:9)', async () => {
    const { css } = parse(await build());
    // Caller (document) CSS is inlined first, then the deck chrome.
    expect(css.indexOf('.slide-frame')).toBeLessThan(css.indexOf('.kova-deck {'));
    expect(css).toMatchSnapshot('css');
  });

  it('matches the golden navigation script (16:9)', async () => {
    const { script } = parse(await build());
    expect(script).toMatchSnapshot('script');
  });

  it('only the slide size changes for a 4:3 deck', async () => {
    const wide = parse(await build({ w: 16, h: 9 }));
    const std = parse(await build({ w: 4, h: 3 }));
    expect(std.body).toEqual(wide.body);
    expect(std.css).toBe(wide.css.replace(/height: 540px/g, 'height: 720px'));
    expect(std.script).toBe(wide.script.replace('var slideH = 540;', 'var slideH = 720;'));
  });

  it('requests exactly the expected asset reads over IPC', async () => {
    await build();
    const calls = invoke.mock.calls.map(([cmd, args]) => [cmd, args]);
    calls.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(calls).toMatchSnapshot('ipc calls');
  });

  it('falls back to the default background with no slide frame', async () => {
    const html = await buildInteractiveDocument([el('<div class="slide-wrap"><p>Bare</p></div>')], { w: 16, h: 9 }, [slide()]);
    const { body, css, script } = parse(html);
    expect(body.join('\n')).toMatchSnapshot('bare body outline');
    expect(css).toContain('background: #111 !important;');
    expect(script).toContain('var slideSteps = [[]];');
  });
});
