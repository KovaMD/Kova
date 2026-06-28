import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/** Thin rule under each `---` slide separator (skips the frontmatter block). */
const line = Decoration.line({ class: 'cm-slide-divider' });

function build(view: EditorView) {
  const { doc } = view.state;
  const b = new RangeSetBuilder<Decoration>();
  let fm = false; // inside frontmatter
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    if (l.text.trim() !== '---') continue;
    if (n === 1) fm = true;        // opening fence
    else if (fm) fm = false;       // closing fence — not a slide break
    else b.add(l.from, l.from, line);
  }
  return b.finish();
}

export const slideDivider = [
  EditorView.baseTheme({ '.cm-slide-divider': { borderBottom: '1px solid var(--border, #888)' } }),
  ViewPlugin.define((v) => ({ decorations: build(v), update(u) { if (u.docChanged) this.decorations = build(u.view); } }), {
    decorations: (p) => p.decorations,
  }),
];
