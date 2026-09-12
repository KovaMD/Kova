/** The small accent dot marking a theme property as overridden in this
 *  document's frontmatter — shared by ColorControls, FontControls, and
 *  LogoControls so its styling stays in one place. */
export function OverrideDot({ show, hint }: { show: boolean; hint: string }) {
  if (!show) return null;
  return <span title={hint} style={{ color: 'var(--accent)', fontSize: 8, lineHeight: 1 }}>●</span>;
}
