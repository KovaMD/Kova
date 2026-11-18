// Plain-text helpers for the markdown-generated HTML the PPTX exporter reads.

// KaTeX emits both MathML (accessible) and HTML layers. Walking both text
// nodes concatenates duplicated runs (e.g. "x2x^2x2") — issue #170. Prefer
// the TeX source from the MathML annotation when present.
export function katexTexSource(el: Element): string | null {
  if (!el.classList?.contains('katex')) return null;
  const ann = el.querySelector('annotation[encoding="application/x-tex"]');
  const tex = ann?.textContent?.trim();
  return tex || null;
}

export function stripHtml(html: string): string {
  const withAltText = html.replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, '$1');
  // Use the DOM (as htmlToInlineRuns/hljsHtmlToRuns already do in
  // elements/textRuns.ts and elements/code.ts) rather than a tag-stripping
  // regex followed by hand-rolled entity decoding — inlineToHtml() escapes & < > into entities, and
  // textContent decodes them back correctly (including numeric entities),
  // instead of leaving e.g. "AT&amp;T" as literal text in the exported pptx.
  // Walk with the same KaTeX helper as htmlToInlineRuns so table cells don't
  // reintroduce the MathML+HTML duplication (issue #170 / PR #174 review).
  const div = document.createElement('div');
  div.innerHTML = withAltText;
  return flattenHtmlText(div);
}

/** Plain-text flatten that collapses KaTeX roots to a single TeX fragment. */
export function flattenHtmlText(root: Node): string {
  let out = '';
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tex = katexTexSource(el);
    if (tex !== null) {
      out += tex;
      return;
    }
    if (el.classList?.contains('katex')) {
      el.querySelector('.katex-mathml')?.remove();
    }
    for (const child of node.childNodes) walk(child);
  }
  walk(root);
  return out;
}
