import mermaid from 'mermaid';
import { mermaidRenderedSvgCache } from './mermaidSvgCache';

/**
 * Mermaid keeps internal global state and cannot handle concurrent render()
 * calls — calling it again while one is already in flight either hangs or
 * rejects (this is a known constraint; see the comments in SlideRenderer.tsx's
 * MermaidDiagram and exportPptx.ts's mermaidToDataUrl). Several places in the
 * app mount many MermaidDiagram instances at once — the thumbnail panel on
 * file load, and the off-screen PDF/Print export trees that render the entire
 * deck simultaneously — which races exactly that constraint.
 *
 * Every render() call in the app funnels through this queue so they run one
 * at a time instead of racing. A per-call timeout keeps one hung/invalid
 * diagram from wedging every other diagram in the app for the rest of the
 * session — the queue moves on after the timeout regardless of whether the
 * stuck call ever settles.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

// Some diagram types (Gantt, notably) measure their host element's
// offsetWidth *at render time* to decide their internal coordinate scale
// (mermaid's ganttRenderer does `w = elem.parentElement.offsetWidth`).
// mermaid.render() with no explicit container renders into a scratch div it
// appends straight to `document.body`, so that measurement ends up being
// whatever the *current window's* body happens to be at that instant —
// which differs between the main editor window, a freshly-opened
// presenter/audience WebviewWindow (issue #195), and even between
// keystrokes while editing, since every edit re-renders. Rendering into a
// persistent, fixed-width, off-screen host instead makes that measurement
// deterministic everywhere the app renders Mermaid diagrams (preview,
// thumbnails, presenter/audience windows, PDF/PPTX export). The width
// matches the virtual slide canvas used elsewhere (SLIDE_W in
// presentationShared.tsx / ThumbnailPanel.tsx) so diagrams size themselves
// the same way they're actually displayed.
const RENDER_HOST_ID = 'mermaid-render-host';
const RENDER_HOST_WIDTH = 960;
const RENDER_HOST_HEIGHT = 540;

function getRenderHost(): HTMLDivElement {
  let host = document.getElementById(RENDER_HOST_ID) as HTMLDivElement | null;
  if (!host) {
    host = document.createElement('div');
    host.id = RENDER_HOST_ID;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position: fixed; top: 0; left: -99999px; width: ${RENDER_HOST_WIDTH}px; height: ${RENDER_HOST_HEIGHT}px; overflow: hidden; pointer-events: none;`;
    document.body.appendChild(host);
  }
  return host;
}

let tail: Promise<unknown> = Promise.resolve();

// A macrotask hop before each queued render. Chaining renders purely through
// promise callbacks runs them back to back as microtasks, which never give
// WebKit a chance to paint or handle input in between — a deck with dozens of
// diagrams then freezes the whole window until the queue drains.
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function queuedMermaidRender(id: string, src: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ svg: string }> {
  const run = tail.then(yieldToEventLoop).then(() => Promise.race([
    mermaid.render(id, src, getRenderHost()),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Mermaid render timeout')), timeoutMs)),
  ]));
  // Chain `tail` through a rejection-swallowing branch so a failed/timed-out
  // render still releases the queue for the next caller — the real rejection
  // is preserved and still propagates to whoever awaits `run` below.
  tail = run.catch(() => {});
  return run;
}

/**
 * Mermaid scopes everything in its output SVG (the root <svg> id, its <style>
 * selectors, marker/gradient ids and their url(#…) references) under the id
 * it was rendered with. A cached SVG reused in a second place in the DOM has
 * to be re-scoped to a fresh id, otherwise two copies share ids and a marker
 * reference can resolve into the other copy (which may later unmount).
 */
export function retargetMermaidSvgIds(svg: string, newId: string): string {
  const oldId = svg.match(/<svg\b[^>]*\bid="([^"]+)"/i)?.[1];
  if (!oldId || oldId === newId) return svg;
  // The lookahead stops "mermaid-r1-1" also matching inside "mermaid-r1-10".
  const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return svg.replace(new RegExp(`${escaped}(?![0-9])`, 'g'), newId);
}

/** Synchronous cache lookup, re-scoped to `id`; undefined on a miss. */
export function getCachedMermaidSvg(src: string, id: string): string | undefined {
  const hit = mermaidRenderedSvgCache.get(src);
  return hit === undefined ? undefined : retargetMermaidSvgIds(hit, id);
}

// Renders already queued for a given source, so a thumbnail and the main
// preview mounting the same diagram at the same time share one render
// instead of both missing the cache and queueing two.
const inFlight = new Map<string, Promise<string>>();

/**
 * queuedMermaidRender with a cache in front of it: a source already rendered
 * (by any MermaidDiagram, in any view) is reused rather than rendered again.
 * Failures are not cached, so a timed-out diagram gets another attempt on its
 * next mount.
 */
export function cachedMermaidRender(id: string, src: string): Promise<string> {
  const hit = getCachedMermaidSvg(src, id);
  if (hit !== undefined) return Promise.resolve(hit);
  let pending = inFlight.get(src);
  if (!pending) {
    pending = queuedMermaidRender(id, src)
      .then(({ svg }) => { mermaidRenderedSvgCache.set(src, svg); return svg; })
      .finally(() => inFlight.delete(src));
    inFlight.set(src, pending);
  }
  return pending.then((svg) => retargetMermaidSvgIds(svg, id));
}
