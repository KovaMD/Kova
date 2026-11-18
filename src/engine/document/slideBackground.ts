import { parseBgLine, formatBgLine } from '../parser/bgImage';

/**
 * Sets (src) or clears (null) the background image of one raw slide segment.
 * The first `![bg ...]` line outside a code fence is rewritten with the new
 * src, keeping its options; any further bg lines are removed. With no bg line
 * yet, a `cover` one is inserted near the top, after leading blanks and any
 * hidden/todo markers. Every other line stays byte-identical.
 */
export function setSlideBackgroundInRaw(raw: string, src: string | null): string {
  // Keep formatting stable: only touch bg lines; keep other lines byte-identical.
  const lines = raw.split('\n');
  const out: string[] = [];
  let inFence = false;
  let handled = false;

  for (const line of lines) {
    const t = line.trim();
    if (/^(`{3,}|~{3,})/.test(t)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence) {
      const parsed = parseBgLine(t);
      if (parsed) {
        if (src && !handled) {
          const indent = line.match(/^\s*/)?.[0] ?? '';
          out.push(`${indent}${formatBgLine({ ...parsed, src })}`);
        }
        handled = true;
        continue; // remove original bg line(s)
      }
    }
    out.push(line);
  }

  if (src && !handled) {
    // Insert near the top, after leading blanks and any `<!-- hidden -->`/`<!-- todo -->` markers.
    let i = 0;
    while (i < out.length && out[i].trim() === '') i++;
    while (/^<!--\s*(?:hidden|todo)\s*-->$/.test(out[i]?.trim() ?? '')) i++;
    out.splice(i, 0, formatBgLine({ src, size: 'cover' }));
    if (out[i + 1] && out[i + 1].trim() !== '') out.splice(i + 1, 0, '');
  }

  return out.join('\n');
}
