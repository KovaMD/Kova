// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const openUrlMock = vi.fn(() => Promise.resolve());
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }));

const { urlLinkDecoration, urlAt, handleUrlMousedown } = await import('../urlLinkDecoration');
const { isMac } = await import('../../../engine/keybindings');

function linkTexts(doc: string): string[] {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: urlLinkDecoration }) });
  const texts = Array.from(view.dom.querySelectorAll('.cm-url-link')).map((el) => el.textContent ?? '');
  view.destroy();
  return texts;
}

function makeView(doc: string): EditorView {
  return new EditorView({ state: EditorState.create({ doc, extensions: urlLinkDecoration }) });
}

function fakeEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    metaKey: true,
    ctrlKey: true,
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent;
}

describe('urlLinkDecoration', () => {
  beforeEach(() => { openUrlMock.mockClear(); });

  it('decorates a bare https URL', () => {
    expect(linkTexts('Visit https://example.com/page for details')).toEqual(['https://example.com/page']);
  });

  it('trims trailing sentence punctuation out of the decorated span', () => {
    expect(linkTexts('See https://example.com/page.')).toEqual(['https://example.com/page']);
    expect(linkTexts('Really? https://example.com/page!')).toEqual(['https://example.com/page']);
  });

  it('keeps a closing paren that balances one earlier in the URL', () => {
    expect(linkTexts('See https://en.wikipedia.org/wiki/Cat_(disambiguation)')).toEqual([
      'https://en.wikipedia.org/wiki/Cat_(disambiguation)',
    ]);
  });

  it('drops a closing paren that is just surrounding prose, not part of the URL', () => {
    expect(linkTexts('(see https://example.com/page)')).toEqual(['https://example.com/page']);
  });

  it('decorates a URL wrapped in markdown italics', () => {
    expect(linkTexts('_https://example.com/page_')).toEqual(['https://example.com/page']);
  });

  it('decorates a URL wrapped in markdown bold without swallowing the asterisks', () => {
    expect(linkTexts('**https://example.com/page**')).toEqual(['https://example.com/page']);
  });

  it('decorates a URL wrapped in an inline code span without swallowing the backticks', () => {
    expect(linkTexts('`https://example.com/page`')).toEqual(['https://example.com/page']);
  });

  it('keeps a legitimate underscore inside the URL itself', () => {
    expect(linkTexts('See https://en.wikipedia.org/wiki/Some_Article')).toEqual([
      'https://en.wikipedia.org/wiki/Some_Article',
    ]);
  });

  it('decorates multiple URLs independently', () => {
    expect(linkTexts('https://a.example.com and https://b.example.com')).toEqual([
      'https://a.example.com', 'https://b.example.com',
    ]);
  });

  it('does not decorate plain text with no URL', () => {
    expect(linkTexts('Just a paragraph about nothing in particular.')).toEqual([]);
  });

  it('urlAt finds the URL spanning a given position', () => {
    const view = makeView('Visit https://example.com/page today');
    // "Visit " is 6 chars; the URL starts at offset 6.
    expect(urlAt(view, 10)).toBe('https://example.com/page');
    expect(urlAt(view, 0)).toBeNull();
    view.destroy();
  });

  it('modifier+click on a URL opens it and prevents default', () => {
    const view = makeView('Visit https://example.com/page today');
    // jsdom does no real layout, so posAtCoords can't resolve pixel
    // coordinates to a doc position — stub it to the offset inside the URL
    // ("Visit " is 6 chars) rather than assert on the coordinate math itself.
    vi.spyOn(view, 'posAtCoords').mockReturnValue(10);
    const event = fakeEvent();
    const handled = handleUrlMousedown(event, view);
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/page');
    view.destroy();
  });

  it('a plain click (no modifier) does not open the URL', () => {
    const view = makeView('Visit https://example.com/page today');
    const event = fakeEvent({ metaKey: false, ctrlKey: false });
    const handled = handleUrlMousedown(event, view);
    expect(handled).toBe(false);
    expect(openUrlMock).not.toHaveBeenCalled();
    view.destroy();
  });

  it('modifier+click away from any URL does not open anything', () => {
    const view = makeView('Just a paragraph about nothing in particular.');
    vi.spyOn(view, 'posAtCoords').mockReturnValue(5);
    const event = fakeEvent();
    const handled = handleUrlMousedown(event, view);
    expect(handled).toBe(false);
    expect(openUrlMock).not.toHaveBeenCalled();
    view.destroy();
  });

  it('clears the stuck modifier-hover class on window blur', () => {
    const view = makeView('Visit https://example.com/page today');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: isMac ? 'Meta' : 'Control' }));
    expect(view.dom.classList.contains('cm-mod-active')).toBe(true);
    // Simulates an OS shortcut (e.g. Cmd+Tab) consuming the keyup before the
    // webview sees it — only a blur remains to signal the modifier let go.
    window.dispatchEvent(new Event('blur'));
    expect(view.dom.classList.contains('cm-mod-active')).toBe(false);
    view.destroy();
  });

  it('a non-primary mouse button does not open the URL (posAtCoords never consulted)', () => {
    const view = makeView('Visit https://example.com/page today');
    const event = fakeEvent({ button: 2 });
    const handled = handleUrlMousedown(event, view);
    expect(handled).toBe(false);
    expect(openUrlMock).not.toHaveBeenCalled();
    view.destroy();
  });
});
