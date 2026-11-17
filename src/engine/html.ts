/**
 * Escape text for safe insertion into HTML, either as a text node or inside a
 * double-quoted attribute value. `&` is replaced first so the entities this
 * function emits are never escaped twice, and `"` is escaped so the result can
 * never break out of an attribute such as `alt="…"`.
 *
 * Single quotes are deliberately left alone: every attribute built with this
 * helper is double-quoted. Do not use the result inside a single-quoted
 * attribute.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
