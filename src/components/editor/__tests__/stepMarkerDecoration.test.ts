// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { stepMarkerDecoration } from '../stepMarkerDecoration';

function badgeNumbers(doc: string): string[] {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: stepMarkerDecoration }) });
  const badges = Array.from(view.dom.querySelectorAll('.cm-step-badge')).map((el) => el.textContent ?? '');
  view.destroy();
  return badges;
}

describe('stepMarkerDecoration', () => {
  it('numbers markers in document order, matching the parser default', () => {
    expect(badgeNumbers('- A\n- B <!-- step -->\n- C <!-- step -->')).toEqual(['· 1', '· 2']);
  });

  it('resolves an explicit group number the same way the parser does (auto continues past it)', () => {
    // step, step, step:2, step -> 1, 2, 2, 3 (see stepMarkers.test coverage in the parser)
    const doc = '- A <!-- step -->\n- B <!-- step -->\n- C <!-- step: 2 -->\n- D <!-- step -->';
    expect(badgeNumbers(doc)).toEqual(['· 1', '· 2', '· 2', '· 3']);
  });

  it('resets numbering on a real slide separator, but not on frontmatter fences', () => {
    const doc = '---\ntitle: T\n---\n\n- A <!-- step -->\n\n---\n\n- B <!-- step -->';
    expect(badgeNumbers(doc)).toEqual(['· 1', '· 1']);
  });

  it('treats a leading unclosed --- as a real slide separator, not a stuck-open frontmatter fence', () => {
    // Regression: a per-line open/close toggle keyed off "--- on line 1"
    // would see this leading `---` as opening frontmatter and never find a
    // matching close, silently suppressing badges for the rest of the file.
    // extractFrontmatter (used by the real parser too) correctly treats an
    // unclosed leading `---` as not frontmatter at all.
    const doc = '---\n\n- A <!-- step -->';
    expect(badgeNumbers(doc)).toEqual(['· 1']);
  });

  it('ignores a step-shaped marker inside a fenced code block', () => {
    expect(badgeNumbers('```\n<!-- step -->\n```')).toEqual([]);
  });

  it('renders no badges for a document with no markers', () => {
    expect(badgeNumbers('# Title\n\nJust a paragraph.')).toEqual([]);
  });
});
