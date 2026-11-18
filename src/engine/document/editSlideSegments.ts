import { frontmatterBlockLength } from '../parser/frontmatter';
import { splitIntoRawSlides } from '../parser/markdownToSlides';

// Shared by the slide-editing handlers (hooks/useSlideEditing): pulls the frontmatter block
// off `prev`, splits the body into per-slide segments via the *same*
// fence-aware splitIntoRawSlides the real parser uses (not a hand-rolled
// body.split(/^---$/m), which would mis-split on a literal '---' line
// inside a fenced code sample — segment N would then silently stop matching
// the slide the user actually sees as N), lets `edit` transform the segment
// array, and rejoins. `edit` returning null means "no-op" (e.g. an
// out-of-range index) and `prev` is returned unchanged. Module-level (not a
// hook/closure) since it has no dependency on component state — also makes
// it directly unit-testable without rendering the component.
//
// `rejoin: 'trim'` normalises each segment's surrounding whitespace — for
// operations that already restructure the segment list (reorder/duplicate/
// insert/delete), where exact byte preservation isn't meaningful since
// indices shift anyway.
// `rejoin: 'preserve'` keeps every segment's exact original bytes (only the
// edited segment's own text changes) — for in-place edits (toggle hidden,
// set/clear background), so every *other* segment stays byte-identical and
// the parser's positional cache still hits for them (no thumbnail remount /
// scroll-position loss on an unrelated slide's edit). splitIntoRawSlides
// strips each '---' boundary line rather than leaving it attached to a
// segment, so 'preserve' reinserts it with '\n---\n'.
export function editSlideSegments(
  prev: string,
  edit: (segments: string[]) => string[] | null,
  rejoin: 'trim' | 'preserve',
): string {
  const fmBlock = prev.slice(0, frontmatterBlockLength(prev));
  const body = prev.slice(fmBlock.length);
  const segments = splitIntoRawSlides(body);
  const next = edit(segments);
  if (next === null) return prev;
  return rejoin === 'trim'
    ? fmBlock + next.map((s) => s.trim()).join('\n\n---\n\n') + '\n'
    : fmBlock + next.join('\n---\n');
}
