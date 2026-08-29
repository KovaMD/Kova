import { fitMermaidViewBox } from './mermaidViewBox';

/**
 * Converts a raw Mermaid SVG string to a PNG data URL.
 *
 * Uses innerHTML (HTML parser) rather than DOMParser so that non-XML-valid
 * content inside <foreignObject> nodes is handled gracefully. Each
 * <foreignObject> is replaced with a native SVG <text>/<tspan> block before
 * serialisation, which is the only reliable way to avoid the WebKit canvas
 * SecurityError and the "disappearing text" problem during canvas capture.
 */
export async function svgToPngDataUrl(
  svgString: string,
  bgColor: string,
): Promise<{ dataUrl: string; aspectRatio: number }> {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;width:1200px;height:900px;';
  container.innerHTML = svgString;
  document.body.appendChild(container);

  const svgEl = container.querySelector('svg');
  let correctedSvg = svgString;
  if (svgEl) {
    const ns = 'http://www.w3.org/2000/svg';
    for (const fo of Array.from(svgEl.querySelectorAll('foreignObject'))) {
      const foX = parseFloat(fo.getAttribute('x') || '0');
      const foY = parseFloat(fo.getAttribute('y') || '0');
      const foW = parseFloat(fo.getAttribute('width') || '100');
      const foH = parseFloat(fo.getAttribute('height') || '20');
      const cx  = foX + foW / 2;

      const lines: string[] = [];
      let cur = '';
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) { cur += node.textContent ?? ''; }
        else if ((node as Element).tagName?.toLowerCase() === 'br') { lines.push(cur); cur = ''; }
        else { node.childNodes.forEach(walk); }
      };
      fo.childNodes.forEach(walk);
      if (cur) lines.push(cur);
      const nonEmpty = lines.map(l => l.trim()).filter(Boolean);

      if (nonEmpty.length === 0) { fo.remove(); continue; }

      // Read the *actual* computed font rather than guessing — the container is
      // already attached to document.body at this point, so Mermaid's own
      // embedded <style> block (populated from the theme's fontFamily via
      // buildExportMermaidInit, shared by the live preview and export) is
      // already cascading onto this element. Falls back to the previous
      // hardcoded values only if there's no child element to measure
      // (foreignObject with a bare text node, etc.).
      const refEl   = fo.querySelector('*');
      const computed = refEl ? window.getComputedStyle(refEl) : null;
      const fontSize   = (computed && parseFloat(computed.fontSize)) || 14;
      const fontFamily = (computed && computed.fontFamily) || 'Arial, sans-serif';
      const lineHeight = fontSize * 1.35;
      const blockH     = nonEmpty.length * lineHeight;
      const startY     = foY + (foH - blockH) / 2 + fontSize * 0.85;

      const textEl = document.createElementNS(ns, 'text');
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('font-size', String(fontSize));
      textEl.setAttribute('font-family', fontFamily);
      nonEmpty.forEach((line, i) => {
        const tspan = document.createElementNS(ns, 'tspan');
        tspan.setAttribute('x', String(cx));
        tspan.setAttribute('y', String(startY + i * lineHeight));
        tspan.textContent = line;
        textEl.appendChild(tspan);
      });
      fo.replaceWith(textEl);
    }

    fitMermaidViewBox(svgEl, 12);
    correctedSvg = new XMLSerializer().serializeToString(svgEl);
  }
  document.body.removeChild(container);

  const viewBoxMatch = correctedSvg.match(/\bviewBox="([^"]*)"/i);
  let renderW = 1200;
  let renderH = 900;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      const scale = 1200 / Math.max(parts[2], parts[3]);
      renderW = Math.round(parts[2] * scale);
      renderH = Math.round(parts[3] * scale);
    }
  }

  const sized = correctedSvg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let a = attrs
      .replace(/\bwidth="[^"]*"/, `width="${renderW}"`)
      .replace(/\bheight="[^"]*"/, `height="${renderH}"`)
      .replace(/\bstyle="[^"]*max-width[^"]*"/, '');
    if (!/\bwidth=/.test(a))  a += ` width="${renderW}"`;
    if (!/\bheight=/.test(a)) a += ` height="${renderH}"`;
    return `<svg${a}>`;
  });

  const aspectRatio = renderW / renderH;

  return new Promise((resolve, reject) => {
    const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = renderW;
        canvas.height = renderH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Canvas 2D context unavailable')); return; }
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, renderW, renderH);
        ctx.drawImage(img, 0, 0, renderW, renderH);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: canvas.toDataURL('image/png'), aspectRatio });
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
    img.src = url;
  });
}
