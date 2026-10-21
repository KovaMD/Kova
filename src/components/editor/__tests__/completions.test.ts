// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { directiveSource, iconSource, kovaCompletions } from '../completions';
import { createTranslator } from '../../../i18n/translate';

// `|` marks the cursor.
function ctx(docWithCursor: string, explicit = false): CompletionContext {
  const pos = docWithCursor.indexOf('|');
  const state = EditorState.create({ doc: docWithCursor.replace('|', ''), extensions: [markdown()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return new CompletionContext(state, pos, explicit);
}

const directives = directiveSource(() => createTranslator(null, 'en'));
const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label) ?? [];

describe('directive completions', () => {
  it('offers directives for `!` plus a letter at the start of a line', () => {
    const r = directives(ctx('Intro\n\n!ca|')) as CompletionResult | null;
    expect(labels(r)).toContain('!caption');
    expect(r!.from).toBe('Intro\n\n'.length);
  });

  it('allows leading indentation', () => {
    expect(labels(directives(ctx('  !to|')) as CompletionResult | null)).toContain('!toc');
  });

  it('stays quiet for a bare `!` (an image is usually coming) unless invoked', () => {
    expect(directives(ctx('!|'))).toBeNull();
    expect(labels(directives(ctx('!|', true)) as CompletionResult | null)).toContain('!sheet');
  });

  it('ignores `!` mid-line', () => {
    expect(directives(ctx('Wow !ca|'))).toBeNull();
  });

  it('ignores fenced code blocks', () => {
    expect(directives(ctx('```\n!ca|\n```'))).toBeNull();
  });

  it('describes each directive in the current locale', () => {
    const r = directives(ctx('!ca|')) as CompletionResult;
    expect(r.options.find((o) => o.label === '!caption')!.detail).toBe('Caption for the element above');
  });
});

describe('icon completions', () => {
  it('offers icons after `:` plus two letters', () => {
    const r = iconSource(ctx('Ship it :ro|'));
    expect(labels(r)).toContain(':rocket:');
    expect(r!.from).toBe('Ship it '.length);
  });

  it('needs two letters unless invoked explicitly', () => {
    expect(iconSource(ctx('Ship it :r|'))).toBeNull();
    expect(iconSource(ctx('Ship it :r|', true))).not.toBeNull();
  });

  it('ignores colons that do not open a word', () => {
    expect(iconSource(ctx('key:val|'))).toBeNull();
    expect(iconSource(ctx('a::ho|'))).toBeNull();
    expect(iconSource(ctx('at 10:30|'))).toBeNull();
  });

  it('ignores code and front matter', () => {
    expect(iconSource(ctx('Use `:ro|` here'))).toBeNull();
    expect(iconSource(ctx('```css\na :ho|\n```'))).toBeNull();
    expect(iconSource(ctx('---\ntitle: :ro|\n---\n\n# Hi'))).toBeNull();
  });

  it('works after front matter has closed', () => {
    expect(labels(iconSource(ctx('---\ntitle: X\n---\n\n# Hi :ro|')))).toContain(':rocket:');
  });

  it('carries the glyph for the popup', () => {
    const r = iconSource(ctx(':be|'))!;
    const bell = r.options.find((o) => o.label === ':bell:') as unknown as { glyph: string };
    expect(bell.glyph).toBe(String.fromCodePoint(0xf0f3));
  });
});

describe('kovaCompletions', () => {
  // autocompletion matches results to sources by identity; a source rebuilt on
  // every lookup orphaned each query and the directive popup never appeared.
  it('hands autocompletion the same source objects on every lookup', () => {
    const state = EditorState.create({ doc: '!ca', extensions: [markdown(), kovaCompletions(() => createTranslator(null, 'en'))] });
    const a = state.languageDataAt<unknown>('autocomplete', 3);
    const b = state.languageDataAt<unknown>('autocomplete', 3);
    expect(a.length).toBeGreaterThanOrEqual(2);
    a.forEach((src, i) => expect(src).toBe(b[i]));
  });
});
