import { useEffect } from 'react';
import type { RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Translator } from '../../i18n';
import { isMac } from '../../engine/keybindings';
import { encodeMarkdownPath } from './mediaSnippet';

// A whole-string URL match (not "contains a URL somewhere") — pasting text
// that merely mentions a URL alongside other words should still just replace
// the selection normally; only pasting nothing but a bare URL over marked
// text turns it into a link (issue #247), matching GitHub's own paste-to-
// linkify behaviour: https://github.blog/changelog/2021-11-10-linkify-selected-text-on-url-paste/
const BARE_URL_RE = /^https?:\/\/\S+$/;

/** Exported for testing — the rest of this file is DOM/CodeMirror plumbing
 *  around this one decision (linkify vs. plain-replace). */
export function pastedUrl(text: string): string | null {
  const trimmed = text.trim();
  return BARE_URL_RE.test(trimmed) ? trimmed : null;
}

interface UseMediaPasteParams {
  containerRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<EditorView | null>;
  filePathRef: RefObject<string | null | undefined>;
  onWarnRef: RefObject<((msg: string) => void) | undefined>;
  t: Translator;
}

// Handle clipboard image paste.
// macOS (WKWebView): intercept the native 'paste' event. e.clipboardData.items
//   exposes image blobs directly without a permission prompt because the paste
//   event itself is the user's consent. If there's no image, fall through so
//   CodeMirror's own paste handler processes text — no permission dialog needed.
// Linux/Windows: intercept keydown instead, because WebKitGTK does not expose
//   binary image data through e.clipboardData, so we must read it via the native
//   GTK clipboard command before deciding whether to preventDefault.
export function useMediaPaste({ containerRef, viewRef, filePathRef, onWarnRef, t }: UseMediaPasteParams): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (isMac) {
      const handler = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const mediaItem = Array.from(items).find((item) => item.type.startsWith('image/') || item.type.startsWith('video/'));
        if (!mediaItem) {
          // No media — turn "paste a bare URL over selected text" into a
          // markdown link (issue #247) before falling through to let
          // CodeMirror handle a plain text paste natively.
          const view = viewRef.current;
          const sel = view?.state.selection.main;
          if (view && sel && sel.from !== sel.to) {
            const url = pastedUrl(e.clipboardData?.getData('text/plain') ?? '');
            if (url) {
              e.preventDefault();
              const snippet = `[${view.state.sliceDoc(sel.from, sel.to)}](${url})`;
              view.dispatch({
                changes: { from: sel.from, to: sel.to, insert: snippet },
                selection: EditorSelection.cursor(sel.from + snippet.length),
              });
              view.focus();
            }
          }
          return;
        }
        e.preventDefault();
        const blob = mediaItem.getAsFile();
        if (!blob) return;
        const isVideo = blob.type.startsWith('video/');
        const view = viewRef.current;
        if (!view) return;
        void (async () => {
          const docPath = filePathRef.current ?? null;
          if (!docPath) {
            onWarnRef.current?.(t('editor.saveFirstPasteMedia'));
            return;
          }
          const docDir = docPath.substring(
            0,
            Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
          );
          const arrayBuffer = await blob.arrayBuffer();
          const pasteExt = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov') ?? (isVideo ? 'mp4' : 'png');
          const mediaBase64 = btoa(
            Array.from(new Uint8Array(arrayBuffer)).map((b) => String.fromCharCode(b)).join('')
          );
          try {
            const savedFilename = await invoke<string>('write_asset_bytes', {
              data: mediaBase64,
              filename: `paste-${Date.now()}.${pasteExt}`,
              destDir: docDir,
            });
            const enc = encodeMarkdownPath(savedFilename);
            const snippet = isVideo ? `!video[](assets/${enc})` : `![](assets/${enc})`;
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: snippet },
              selection: EditorSelection.cursor(from + snippet.length),
            });
            view.focus();
          } catch (err) {
            console.error('[Kova] paste media failed:', err);
            onWarnRef.current?.(t('editor.couldNotPasteMedia'));
          }
        })();
      };
      el.addEventListener('paste', handler, { capture: true });
      return () => el.removeEventListener('paste', handler, { capture: true });
    }

    // Linux / Windows: intercept the native 'paste' event (fires for both
    // Ctrl+V and Ctrl+Shift+V) rather than keydown. This lets us read text
    // synchronously off e.clipboardData instead of via the async
    // navigator.clipboard.readText(), which is unreliable under WebKitGTK
    // (Ubuntu) — it can reject silently, and by the time it resolves the
    // preceding preventDefault() has already discarded the native paste, so
    // the keystroke does nothing. Image bytes still require the async native
    // read below since WebKitGTK doesn't expose them through clipboardData.
    const handler = (e: ClipboardEvent) => {
      // Capture cursor position and text synchronously — both the document
      // state and the clipboard event data can become unavailable once we
      // go async.
      const view = viewRef.current;
      const selection = view?.state.selection.main;
      const text = e.clipboardData?.getData('text/plain') ?? '';

      e.preventDefault();

      void (async () => {
        let mediaBase64: string | null = null;
        let pasteExt = 'png';
        let isVideo = false;

        // GTK native clipboard (Linux — WebKitGTK doesn't expose binary
        // image data through e.clipboardData, so we read it natively).
        try {
          mediaBase64 = await invoke<string>('read_clipboard_image');
          // The Rust command always encodes as PNG.
        } catch {
          // Not Linux, or clipboard has no image.
        }

        // Web Clipboard API (Windows WebView2).
        if (mediaBase64 === null) {
          try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
              const mediaType = item.types.find((t) => t.startsWith('image/') || t.startsWith('video/'));
              if (mediaType) {
                isVideo = mediaType.startsWith('video/');
                const blob = await item.getType(mediaType);
                const arrayBuffer = await blob.arrayBuffer();
                mediaBase64 = btoa(
                  Array.from(new Uint8Array(arrayBuffer)).map((b) => String.fromCharCode(b)).join('')
                );
                pasteExt = mediaType.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov') ?? (isVideo ? 'mp4' : 'png');
                break;
              }
            }
          } catch {
            // API not available or clipboard contains no media.
          }
        }

        if (mediaBase64 !== null) {
          const docPath = filePathRef.current ?? null;
          if (!docPath) {
            onWarnRef.current?.(t('editor.saveFirstPasteMedia'));
            return;
          }
          const docDir = docPath.substring(
            0,
            Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
          );
          try {
            const savedFilename = await invoke<string>('write_asset_bytes', {
              data: mediaBase64,
              filename: `paste-${Date.now()}.${pasteExt}`,
              destDir: docDir,
            });
            const enc = encodeMarkdownPath(savedFilename);
            const snippet = isVideo ? `!video[](assets/${enc})` : `![](assets/${enc})`;
            const view = viewRef.current;
            if (!view) return;
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: snippet },
              selection: EditorSelection.cursor(from + snippet.length),
            });
            view.focus();
          } catch (err) {
            console.error('[Kova] paste media failed:', err);
            onWarnRef.current?.(t('editor.couldNotPasteMedia'));
          }
          return;
        }

        // No image — fall back to the plain text captured synchronously
        // from the paste event.
        if (!view || !selection || !text) return;
        // CodeMirror normalises \r\n → \n internally, so the inserted length
        // may be shorter than text.length. Use the normalised form to compute
        // the correct cursor position; otherwise the dispatch is silently
        // rejected when the cursor would land past the end of the new document.
        const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Pasting a bare URL over selected text turns it into a markdown
        // link instead of overwriting the selection (issue #247).
        if (selection.from !== selection.to) {
          const url = pastedUrl(normalised);
          if (url) {
            const snippet = `[${view.state.sliceDoc(selection.from, selection.to)}](${url})`;
            view.dispatch({
              changes: { from: selection.from, to: selection.to, insert: snippet },
              selection: EditorSelection.cursor(selection.from + snippet.length),
            });
            view.focus();
            return;
          }
        }

        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: normalised },
          selection: EditorSelection.cursor(selection.from + normalised.length),
        });
        view.focus();
      })();
    };

    el.addEventListener('paste', handler, { capture: true });
    return () => el.removeEventListener('paste', handler, { capture: true });
  }, [containerRef, viewRef, filePathRef, onWarnRef, t]);
}
