import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { ICONS } from '../../engine/icons';
import { registerBundledFonts } from '../../engine/bundledFonts';
import type { Translator } from '../../i18n';
import type { MessageKey } from '../../i18n/types';

// Autocomplete for Kova's own syntax (issue #275): `!directive` lines and
// `:icon:` shortcodes. basicSetup already enables CodeMirror's autocompletion,
// so these are registered as language-data sources rather than a second
// autocompletion() with an override.

// Every directive must start its line (the parser matches them on the trimmed
// line), so the source only fires there. `${}` is an empty snippet field —
// Tab moves between them.
const DIRECTIVES: Array<{ label: string; template: string; key: MessageKey }> = [
  { label: '!caption',  template: '!caption[${}]',       key: 'editor.directiveCaption' },
  { label: '!ref',      template: '!ref[${}]',           key: 'editor.directiveRef' },
  { label: '!toc',      template: '!toc',                key: 'editor.directiveToc' },
  { label: '!youtube',  template: '!youtube[${}](${})',  key: 'editor.directiveYoutube' },
  { label: '!video',    template: '!video[${}](${})',    key: 'editor.directiveVideo' },
  { label: '!poll',     template: '!poll[${}](${})',     key: 'editor.directivePoll' },
  { label: '!progress', template: '!progress[${}](${})', key: 'editor.directiveProgress' },
  { label: '!sheet',    template: '!sheet',              key: 'editor.directiveSheet' },
  { label: '!let',      template: '!let ${} = ${}',      key: 'editor.directiveLet' },
];

// Markdown nodes whose text is literal, not Kova syntax. Nested languages in
// fenced blocks (Mermaid, YAML, ...) sit under FencedCode, so walking up the
// parents covers them too.
const LITERAL_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'HTMLBlock', 'Comment', 'CommentBlock']);

function inLiteral(state: EditorState, pos: number): boolean {
  for (let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent as typeof node) {
    if (LITERAL_NODES.has(node.name)) return true;
  }
  return false;
}

/** True when `pos` is inside a leading `---` front matter block. */
function inFrontmatter(state: EditorState, pos: number): boolean {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return false;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trim() === '---' || line.text.trim() === '...') return pos <= line.to;
  }
  return true;
}

function suppressed(ctx: CompletionContext): boolean {
  return inLiteral(ctx.state, ctx.pos) || inFrontmatter(ctx.state, ctx.pos);
}

export function directiveSource(getT: () => Translator): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    // At least one letter after `!` unless invoked explicitly, so typing an
    // image (`![alt](src)`) never flashes the popup.
    const m = /^\s*(!([a-z]*))$/.exec(before);
    if (!m || (!m[2] && !ctx.explicit) || suppressed(ctx)) return null;
    const t = getT();
    return {
      from: ctx.pos - m[1].length,
      options: DIRECTIVES.map((d) => snippetCompletion(d.template, { label: d.label, detail: t(d.key) })),
      validFor: /^![a-z]*$/,
    };
  };
}

interface IconCompletion extends Completion { glyph: string }

let iconOptions: IconCompletion[] | null = null;

export function iconSource(ctx: CompletionContext): CompletionResult | null {
  // Two letters after the colon before offering anything: prose is full of
  // colons, and a shorter trigger would turn Enter at "...:a" into an icon.
  const m = ctx.matchBefore(/:[a-z][a-z0-9-]*$/);
  if (!m || (m.to - m.from < 3 && !ctx.explicit)) return null;
  // The colon must open a word: not `key:value`, `a:hover`, `10:30` or `::`.
  const prev = m.from > 0 ? ctx.state.sliceDoc(m.from - 1, m.from) : '';
  if (/[\w:]/.test(prev) || suppressed(ctx)) return null;
  iconOptions ??= Object.entries(ICONS).map(([name, code]) => ({
    label: `:${name}:`,
    glyph: String.fromCodePoint(parseInt(code, 16)),
  }));
  return { from: m.from, options: iconOptions, validFor: /^:[a-z0-9-]*$/ };
}

export function kovaCompletions(getT: () => Translator): Extension {
  // The popup draws each icon's glyph, so the font must be loaded even when
  // the active theme (e.g. a community one) doesn't declare it.
  registerBundledFonts(['Kova Icons']);
  // Built once: autocompletion tracks sources by identity, and this callback
  // runs on every lookup — a fresh closure each time would orphan every
  // in-flight query, leaving the popup stuck pending.
  const directives = directiveSource(getT);
  return [
    EditorState.languageData.of(() => [{ autocomplete: directives }, { autocomplete: iconSource }]),
    autocompletion({
      addToOptions: [{
        position: 30,
        render: (completion) => {
          const glyph = (completion as Partial<IconCompletion>).glyph;
          if (!glyph) return null;
          const span = document.createElement('span');
          span.className = 'cm-kova-icon-glyph';
          span.textContent = glyph;
          return span;
        },
      }],
    }),
  ];
}
