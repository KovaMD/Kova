import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { matchStepMarker, createStepAssigner } from '../../engine/parser/stepMarkers';

// A `<!-- step -->` / `<!-- step: N -->` marker at the end of a line, either
// trailing other content (a bullet/paragraph) or alone on its own line (the
// own-line-after form used for images/tables/etc.) — both land at end-of-line,
// so one regex covers both attachment forms.
const LINE_STEP_RE = /<!--\s*step(?:\s*:\s*\d+)?\s*-->\s*$/;

// Small "· N" badge shown right after the marker, resolved via the exact same
// createStepAssigner sequence the parser uses — so the number an author sees
// while editing can never drift from what the presentation actually builds.
class StepBadgeWidget extends WidgetType {
  constructor(private readonly step: number) { super(); }
  eq(other: WidgetType): boolean { return other instanceof StepBadgeWidget && other.step === this.step; }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-step-badge';
    span.textContent = `· ${this.step}`;
    return span;
  }
}

const markerDeco = Decoration.mark({ class: 'cm-step-marker' });

function build(view: EditorView) {
  const { doc } = view.state;
  const b = new RangeSetBuilder<Decoration>();
  let fm = false;    // inside frontmatter
  let fence = false; // inside ``` or ~~~ code block
  let assignStep = createStepAssigner();

  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    const trimmed = l.text.trim();

    if (/^(`{3,}|~{3,})/.test(trimmed)) { fence = !fence; continue; }
    if (fence) continue;

    if (trimmed === '---') {
      if (n === 1) fm = true;         // opening frontmatter fence
      else if (fm) fm = false;        // closing frontmatter fence — not a slide break
      else assignStep = createStepAssigner(); // real slide separator — steps reset per slide
      continue;
    }
    if (fm) continue;

    const m = l.text.match(LINE_STEP_RE);
    if (!m) continue;
    const explicit = matchStepMarker(m[0]);
    if (explicit === undefined) continue;
    const step = assignStep(explicit);

    const from = l.from + m.index!;
    const to = from + m[0].length;
    b.add(from, to, markerDeco);
    b.add(to, to, Decoration.widget({ widget: new StepBadgeWidget(step), side: 1 }));
  }
  return b.finish();
}

export const stepMarkerDecoration = [
  EditorView.baseTheme({
    '.cm-step-marker': { opacity: '0.55' },
    '.cm-step-badge': {
      display: 'inline-block',
      marginLeft: '0.35em',
      padding: '0 0.4em',
      borderRadius: '3px',
      fontSize: '0.85em',
      opacity: '0.75',
      background: 'var(--accent, #D94F00)',
      color: '#fff',
      userSelect: 'none',
      pointerEvents: 'none',
    },
  }),
  ViewPlugin.define((v) => ({ decorations: build(v), update(u) { if (u.docChanged) this.decorations = build(u.view); } }), {
    decorations: (p) => p.decorations,
  }),
];
