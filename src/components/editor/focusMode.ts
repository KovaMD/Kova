import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Compartment, RangeSetBuilder, Text } from '@codemirror/state';

export const focusModeCompartment = new Compartment();

/** CSS injected once for the dim effect */
const focusModeBaseTheme = EditorView.baseTheme({
  '.cm-slide-dimmed': { opacity: '0.28', transition: 'opacity 0.15s' },
});

/** ViewPlugin that dims all editor lines outside the active slide. */
const dimPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDimDecos(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildDimDecos(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function buildDimDecos(view: EditorView): DecorationSet {
  const { doc, selection } = view.state;
  const cursor = selection.main.head;

  // Locate active slide range
  const { activeFrom, activeTo } = findActiveSlide(doc, cursor);

  const builder = new RangeSetBuilder<Decoration>();
  const dimLine = Decoration.line({ class: 'cm-slide-dimmed' });

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    // Dim if outside the active slide range
    if (line.to < activeFrom || line.from > activeTo) {
      builder.add(line.from, line.from, dimLine);
    }
  }

  return builder.finish();
}

interface SlideRange { activeFrom: number; activeTo: number }

function findActiveSlide(doc: Text, cursor: number): SlideRange {
  const length = doc.length;

  // Collect positions of '---' slide-delimiter lines (skip frontmatter block)
  const delimiters: number[] = [];
  let inFrontmatter = false;
  let afterFrontmatter = false;
  let frontmatterEndPos = 0; // character position immediately after frontmatter's closing ---

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text.trim();

    if (n === 1 && text === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter && text === '---') {
      inFrontmatter = false;
      afterFrontmatter = true;
      frontmatterEndPos = line.to + 1; // position after the newline that follows ---
      continue;
    }
    if (!inFrontmatter && text === '---') delimiters.push(line.from);
  }

  // Build [from, to] ranges for each slide
  const starts: number[] = [afterFrontmatter ? frontmatterEndPos : 0];

  for (const delimFrom of delimiters) {
    const delimLine = doc.lineAt(delimFrom);
    starts.push(delimLine.to + 1);
  }

  // Find which slide contains the cursor
  let activeFrom = 0;
  let activeTo = length;

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length
      ? (doc.lineAt(delimiters[i]).from - 1)
      : length;

    if (cursor >= from && cursor <= to) {
      activeFrom = from;
      activeTo = to;
      break;
    }
  }

  return { activeFrom, activeTo };
}

/** Returns the inner extensions to pass to focusModeCompartment.reconfigure(). */
export function focusModeExtension(enabled: boolean) {
  return enabled ? [focusModeBaseTheme, dimPlugin] : [];
}
