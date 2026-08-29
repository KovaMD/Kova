/**
 * Tighten an already-rendered Mermaid `<svg>`'s viewBox to the bounding box of
 * what it actually drew. Mermaid occasionally declares a viewBox that crops a
 * legend or a long node label; `getBBox()` measures the real extent so the
 * diagram fills its container without clipping.
 *
 * A Gantt "today" marker is excluded from the measurement. It is drawn at the
 * real current date, so a chart whose tasks all sit in the past (or future)
 * parks it thousands of units off-canvas, and fitting the viewBox to it
 * collapses the whole diagram to an unreadable sliver (issue #195). The marker
 * itself is left untouched — it still renders in place when it does fall inside
 * the chart.
 *
 * Shared by the live preview (MermaidDiagram) and the PPTX/PNG exporter
 * (svgToPng), which both need the same fit against a mounted SVG.
 */
export function fitMermaidViewBox(svgEl: SVGSVGElement, pad = 8): void {
  // Mermaid's Gantt renderer emits `<g class="today"><line class="today"/></g>`;
  // the wrapping <g> has no geometry of its own, so hiding the <line> is enough
  // to keep the marker out of the measurement. Matching `line.today` (rather
  // than a bare `.today`) also avoids colliding with a flowchart node that
  // carries a user `class ... today`.
  const todayMarkers = svgEl.querySelectorAll<SVGElement>('line.today');
  todayMarkers.forEach((el) => { el.style.display = 'none'; });
  try {
    const { x, y, width, height } = svgEl.getBBox();
    if (width > 0 && height > 0) {
      svgEl.setAttribute('viewBox', `${x - pad} ${y - pad} ${width + pad * 2} ${height + pad * 2}`);
    }
  } catch {
    // getBBox unavailable (detached node, non-rendered context, etc.)
  } finally {
    todayMarkers.forEach((el) => { el.style.display = ''; });
  }
}
