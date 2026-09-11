import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isMac } from '../../engine/keybindings';

// Bare http(s) URLs typed or pasted directly into the source — not
// [text](url) markdown links, which already render clickable in the live
// preview via SlideRenderer's own <a> handling.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

// A URL ending in sentence punctuation almost always has that punctuation as
// prose, not part of the address ("see https://x.com."); a closing paren or
// bracket is kept when it balances one earlier in the URL itself (e.g. a
// Wikipedia link with a parenthetical disambiguator).
function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '[';
      const opens = url.slice(0, end).split(open).length - 1;
      const closes = url.slice(0, end).split(ch).length - 1;
      if (closes > opens) { end--; continue; }
      break;
    }
    if ('.,;:!?'.includes(ch)) { end--; continue; }
    break;
  }
  return url.slice(0, end);
}

// Not run through the i18n system — this module sits outside the React tree
// the translator context lives in, and a hover tooltip is a small enough
// supplement to the (already-localized) editor UI that hardcoding it isn't
// worth wiring a locale dependency into a CodeMirror extension for.
const linkDeco = Decoration.mark({
  class: 'cm-url-link',
  attributes: { title: `${isMac ? 'Cmd' : 'Ctrl'}+click to open in browser` },
});

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text))) {
    const trimmed = trimTrailingPunctuation(m[0]);
    if (trimmed) b.add(m.index, m.index + trimmed.length, linkDeco);
  }
  return b.finish();
}

// Tracks whether the activating modifier (Cmd on macOS, Ctrl elsewhere — Ctrl
// is already the secondary-click/context-menu modifier on macOS) is
// currently held, toggling a class on the editor root so a URL only looks
// clickable (pointer cursor + underline) while it actually is — a plain
// hover must not suggest a click would do anything, since a plain click
// still just places the cursor.
class UrlLinkPluginValue {
  decorations: DecorationSet;
  private onKeyChange = (e: KeyboardEvent) => {
    const isModKey = isMac ? e.key === 'Meta' : e.key === 'Control';
    if (!isModKey) return;
    this.view.dom.classList.toggle('cm-mod-active', e.type === 'keydown');
  };

  constructor(private view: EditorView) {
    this.decorations = build(view);
    document.addEventListener('keydown', this.onKeyChange);
    document.addEventListener('keyup', this.onKeyChange);
  }

  update(u: ViewUpdate) {
    if (u.docChanged) this.decorations = build(u.view);
  }

  destroy() {
    document.removeEventListener('keydown', this.onKeyChange);
    document.removeEventListener('keyup', this.onKeyChange);
    this.view.dom.classList.remove('cm-mod-active');
  }
}

const urlLinkPlugin = ViewPlugin.fromClass(UrlLinkPluginValue, {
  decorations: (p) => p.decorations,
});

/** The decorated URL text spanning `pos`, if any. Exported for testing. */
export function urlAt(view: EditorView, pos: number): string | null {
  const plugin = view.plugin(urlLinkPlugin);
  if (!plugin) return null;
  let found: string | null = null;
  plugin.decorations.between(pos, pos, (from, to) => {
    found = view.state.doc.sliceString(from, to);
    return false;
  });
  return found;
}

/** Exported separately from the `domEventHandlers` extension so tests can
 *  call it directly with a stubbed event/view rather than simulate real
 *  mouse coordinates, which jsdom can't resolve through CodeMirror's layout. */
export function handleUrlMousedown(event: MouseEvent, view: EditorView): boolean {
  const wantsMod = isMac ? event.metaKey : event.ctrlKey;
  if (!wantsMod || event.button !== 0) return false;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return false;
  const url = urlAt(view, pos);
  if (!url) return false;
  event.preventDefault();
  openUrl(url).catch(() => {});
  return true;
}

export const urlLinkDecoration = [
  EditorView.baseTheme({
    '&.cm-mod-active .cm-url-link:hover': { cursor: 'pointer', textDecoration: 'underline' },
  }),
  urlLinkPlugin,
  EditorView.domEventHandlers({ mousedown: handleUrlMousedown }),
];
