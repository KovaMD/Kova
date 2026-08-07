import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { matchStepMarker, createStepAssigner, STEP_MARKER_PATTERN } from '../../engine/parser/stepMarkers';
import { extractFrontmatter } from '../../engine/parser/frontmatter';

// A `<!-- step -->` / `<!-- step: N -->` marker at the end of a line, either
// trailing other content (a bullet/paragraph) or alone on its own line (the
// own-line-after form used for images/tables/etc.) — both land at end-of-line,
// so one regex covers both attachment forms.
const LINE_STEP_RE = new RegExp(`${STEP_MARKER_PATTERN}\\s*$`);

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
  // Reuses the parser's own frontmatter detection exactly (rather than a
  // per-line open/close toggle keyed off "--- on line 1") so a document that
  // *starts* with an unclosed `---` — a real, if unusual, leading slide
  // separator, not frontmatter — can't get this stuck treating the rest of
  // the file as frontmatter forever. Only pays for materialising the whole
  // document as a string (which extractFrontmatter needs) when line 1 could
  // plausibly be an opening fence at all — real frontmatter always starts on
  // line 1, so every other keystroke skips straight to firstBodyLine = 1
  // without that cost. extractFrontmatter returns `body` as a suffix of
  // `content`, so the length difference is body's start offset.
  const firstBodyLine = doc.line(1).text.trim() === '---'
    ? (() => {
        const content = doc.toString();
        const { body } = extractFrontmatter(content);
        return doc.lineAt(content.length - body.length).number;
      })()
    : 1;

  const b = new RangeSetBuilder<Decoration>();
  let fence = false; // inside ``` or ~~~ code block
  let assignStep = createStepAssigner();

  for (let n = firstBodyLine; n <= doc.lines; n++) {
    const l = doc.line(n);
    const trimmed = l.text.trim();

    if (/^(`{3,}|~{3,})/.test(trimmed)) { fence = !fence; continue; }
    if (fence) continue;

    if (trimmed === '---') {
      assignStep = createStepAssigner(); // slide separator — steps reset per slide
      continue;
    }

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
