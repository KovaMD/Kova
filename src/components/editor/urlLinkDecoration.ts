import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isMac } from '../../engine/keybindings';

// Bare http(s) URLs typed or pasted directly into the source — not
// [text](url) markdown links, which already render clickable in the live
// preview via SlideRenderer's own <a> handling. A lookbehind (not `\b`) guards
// the start: `\b` treats `_` as a word character, so it fails to match a URL
// wrapped in markdown italics (`_https://x.com_`) since there's no boundary
// between the `_` and `h`. Requiring the preceding character to not be
// alphanumeric still blocks matching "https" mid-token (e.g. "xhttps://")
// while allowing any punctuation — including markdown emphasis — before it.
const URL_RE = /(?<![A-Za-z0-9])https?:\/\/[^\s<>"']+/g;

// `[label](url)` markdown links — decorates the label text (not the brackets)
// so clicking the visible link text opens it, same as a rendered link would.
// The negative lookbehind excludes image syntax (`![alt](url)`); only http(s)
// targets are treated as clickable, matching the bare-URL behavior above.
const LINK_LABEL_RE = /(?<!!)\[([^\]\n]+)\]\(([^)\s]+)\)/g;

// A URL ending in sentence punctuation almost always has that punctuation as
// prose, not part of the address ("see https://x.com."); a closing paren or
// bracket is kept when it balances one earlier in the URL itself (e.g. a
// Wikipedia link with a parenthetical disambiguator). Markdown emphasis/code
// wrappers (`**bold**`, `_italic_`, `` `code` ``) aren't excluded from the
// match itself — they're valid-ish URL characters — so trailing ones are
// trimmed here the same way, on the same "almost always prose, not the URL"
// reasoning.
export function trimTrailingPunctuation(url: string): string {
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
    if ('.,;:!?*_`'.includes(ch)) { end--; continue; }
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

interface LinkRange { from: number; to: number; url: string }

// The decorated span's text doesn't always equal its target URL (a markdown
// link's label span is the visible text, not the address) — ranges carry the
// URL explicitly instead of relying on `doc.sliceString(from, to)`.
function findLinkRanges(text: string): LinkRange[] {
  const ranges: LinkRange[] = [];

  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text))) {
    const trimmed = trimTrailingPunctuation(m[0]);
    if (trimmed) ranges.push({ from: m.index, to: m.index + trimmed.length, url: trimmed });
  }

  LINK_LABEL_RE.lastIndex = 0;
  while ((m = LINK_LABEL_RE.exec(text))) {
    const [, label, url] = m;
    if (!/^https?:\/\//.test(url)) continue;
    const labelFrom = m.index + 1; // skip the opening '['
    ranges.push({ from: labelFrom, to: labelFrom + label.length, url });
  }

  ranges.sort((a, b) => a.from - b.from);
  return ranges;
}

function build(ranges: LinkRange[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const r of ranges) b.add(r.from, r.to, linkDeco);
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
  ranges: LinkRange[];
  private onKeyChange = (e: KeyboardEvent) => {
    const isModKey = isMac ? e.key === 'Meta' : e.key === 'Control';
    if (!isModKey) return;
    this.view.dom.classList.toggle('cm-mod-active', e.type === 'keydown');
  };
  // An OS-level shortcut built on the modifier (e.g. Cmd+Tab to switch apps)
  // can consume the keydown without the webview ever seeing a matching keyup
  // — clear the class whenever the window loses focus so the hover styling
  // doesn't stay stuck on until some unrelated keypress happens to fire one.
  private onBlur = () => this.view.dom.classList.remove('cm-mod-active');

  constructor(private view: EditorView) {
    this.ranges = findLinkRanges(view.state.doc.toString());
    this.decorations = build(this.ranges);
    document.addEventListener('keydown', this.onKeyChange);
    document.addEventListener('keyup', this.onKeyChange);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  update(u: ViewUpdate) {
    if (u.docChanged) {
      this.ranges = findLinkRanges(u.state.doc.toString());
      this.decorations = build(this.ranges);
    }
  }

  destroy() {
    document.removeEventListener('keydown', this.onKeyChange);
    document.removeEventListener('keyup', this.onKeyChange);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.view.dom.classList.remove('cm-mod-active');
  }
}

const urlLinkPlugin = ViewPlugin.fromClass(UrlLinkPluginValue, {
  decorations: (p) => p.decorations,
});

/** The target URL of the decorated link span containing `pos`, if any
 *  (a bare URL or a markdown link's label). Exported for testing. */
export function urlAt(view: EditorView, pos: number): string | null {
  const plugin = view.plugin(urlLinkPlugin);
  if (!plugin) return null;
  const r = plugin.ranges.find((r) => r.from <= pos && pos <= r.to);
  return r?.url ?? null;
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
