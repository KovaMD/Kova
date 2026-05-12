import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { focusModeCompartment, focusModeExtension } from '../editor/focusMode';
import { EditorContextMenu } from '../editor/EditorContextMenu';
import type { MenuEntry } from '../editor/EditorContextMenu';
import { isMac } from '../../engine/keybindings';
import { spellCheckExtension } from '../../engine/spellcheck/spellCheckExtension';
import {
  initSpellChecker,
  isSpellCheckerReady,
  spellCheck,
  spellSuggest,
  addCustomWord,
  ignoreSpellingFor,
} from '../../engine/spellcheck/spellChecker';
import type { SpellCheckLanguage } from '../../engine/spellcheck/spellChecker';
import '../../styles/editor.css';

interface Props {
  content: string;
  onChange: (value: string) => void;
  onCursorSlide?: (index: number) => void;
  onWarn?: (msg: string) => void;
  focusMode?: boolean;
  filePath?: string | null;
  uiTheme?: 'dark' | 'light';
  editorFontFamily?: string;
  spellCheckEnabled?: boolean;
  spellCheckLanguage?: string;
}

// Returns a path to `target` relative to the directory of `docPath`.
function makeRelativePath(docPath: string, target: string): string {
  const sep = docPath.includes('\\') ? '\\' : '/';
  const docParts = docPath.split(sep).slice(0, -1);
  const tgtParts = target.split(sep.includes('\\') ? /[/\\]/ : '/');
  let common = 0;
  while (common < docParts.length && common < tgtParts.length && docParts[common] === tgtParts[common]) common++;
  const up = docParts.length - common;
  const rel = [...Array(up).fill('..'), ...tgtParts.slice(common)].join('/');
  return rel || target;
}

// Encode characters that break CommonMark URL parsing (spaces, unbalanced parens).
function encodeMarkdownPath(p: string): string {
  return p.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}


const SCROLLER_BASE = { fontSize: '14px', lineHeight: '1.7' };
const CONTENT       = { padding: '16px 24px', maxWidth: '720px', margin: '0 auto' };

const DEFAULT_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', monospace";

const editorDarkTheme = EditorView.theme({
  '&': { background: '#1e1e1e', height: '100%' },
  '.cm-scroller': SCROLLER_BASE,
  '.cm-content': CONTENT,
  '.cm-gutters': { background: '#1e1e1e', borderRight: '1px solid #2a2a2a' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  '.cm-cursor': { borderLeftColor: '#D94F00' },
});

const editorLightTheme = EditorView.theme({
  '&': { background: '#f1f1f1', height: '100%' },
  '.cm-scroller': SCROLLER_BASE,
  '.cm-content': { ...CONTENT, color: '#1a1a1a' },
  '.cm-gutters': { background: '#f1f1f1', borderRight: '1px solid #d5d5d5', color: '#aaa' },
  '.cm-activeLine': { background: 'rgba(0,0,0,0.04)' },
  '.cm-cursor': { borderLeftColor: '#D94F00' },
  '.cm-selectionBackground': { background: 'rgba(217,79,0,0.15) !important' },
  '.cm-focused .cm-selectionBackground': { background: 'rgba(217,79,0,0.2) !important' },
}, { dark: false });

function makeFontTheme(fontFamily: string) {
  return EditorView.theme({ '.cm-scroller': { fontFamily } });
}

const editorColorCompartment = new Compartment();
const editorFontCompartment  = new Compartment();
const spellCheckCompartment  = new Compartment();

// ── Star-group helpers (for bold/italic which share the * character) ────────


type StarGroup = { openAt: number; closeAt: number; openCount: number; closeCount: number };

/**
 * Collect all runs of consecutive `*` chars in `text`, pair them left-to-right
 * (1st with 2nd, 3rd with 4th, …), and return the pair whose range contains `pos`.
 */
function findStarGroup(text: string, pos: number): StarGroup | null {
  const groups: { start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '*') {
      const s = i;
      while (i < text.length && text[i] === '*') i++;
      groups.push({ start: s, end: i });
    } else {
      i++;
    }
  }
  for (let k = 0; k + 1 < groups.length; k += 2) {
    const open = groups[k], close = groups[k + 1];
    if (open.start <= pos && pos < close.end) {
      return { openAt: open.start, closeAt: close.start, openCount: open.end - open.start, closeCount: close.end - close.start };
    }
  }
  return null;
}

// ── Adjacent-star counter (for selection-based bold/italic toggle) ───────────

function countStarsAround(state: EditorState, from: number, to: number): [number, number] {
  let n = 0;
  while (from - n > 0 && state.sliceDoc(from - n - 1, from - n) === '*') n++;
  let m = 0;
  while (to + m < state.doc.length && state.sliceDoc(to + m, to + m + 1) === '*') m++;
  return [n, m];
}

// ── Non-star enclosing pair finder (~~, <u>, `) ──────────────────────────────

function findEnclosingMarkerPair(
  text: string,
  pos: number,
  before: string,
  after: string,
): [number, number] | null {
  const bLen = before.length;
  const aLen = after.length;

  if (before === after) {
    const positions: number[] = [];
    let i = 0;
    while (i <= text.length - bLen) {
      if (text.startsWith(before, i)) { positions.push(i); i += bLen; }
      else i++;
    }
    for (let k = 0; k + 1 < positions.length; k += 2) {
      const open = positions[k], close = positions[k + 1];
      if (open <= pos && pos < close + aLen) return [open, close];
    }
    return null;
  }

  // Asymmetric (e.g. <u>...</u>)
  let openIdx = -1, i = 0;
  while (i + bLen <= text.length) {
    if (text.startsWith(before, i) && i <= pos) { openIdx = i; i += bLen; }
    else i++;
  }
  if (openIdx === -1) return null;
  let closeIdx = -1;
  i = openIdx + bLen;
  while (i + aLen <= text.length) {
    if (text.startsWith(after, i)) { closeIdx = i; break; }
    i++;
  }
  return closeIdx === -1 ? null : [openIdx, closeIdx];
}

// ── Main wrap/toggle command factory ─────────────────────────────────────────

function makeWrapCommand(before: string, after: string, placeholder: string) {
  const bLen = before.length;
  const aLen = after.length;
  const isStarMarker = /^\*+$/.test(before) && /^\*+$/.test(after);

  return (view: EditorView): boolean => {
    const { state } = view;
    const { from, to } = state.selection.main;

    // ── Selection present ───────────────────────────────────────────────────
    if (from !== to) {
      if (isStarMarker) {
        const [sBefore, sAfter] = countStarsAround(state, from, to);
        const min  = Math.min(sBefore, sAfter);
        const isOn = bLen === 1 ? min % 2 === 1 : min >= bLen;

        if (isOn) {
          view.dispatch({
            changes: [
              { from: from - bLen, to: from,          insert: '' },
              { from: to,          to: to + bLen,     insert: '' },
            ],
            selection: EditorSelection.range(from - bLen, to - bLen),
          });
        } else {
          view.dispatch({
            changes: [
              { from, to: from, insert: before },
              { from: to, to,   insert: after },
            ],
            selection: EditorSelection.range(from + bLen, to + bLen),
          });
        }
      } else {
        // Exact-match toggle for ~~, <u>, `
        const outerBefore = from >= bLen ? state.sliceDoc(from - bLen, from) : '';
        const outerAfter  = to + aLen <= state.doc.length ? state.sliceDoc(to, to + aLen) : '';
        if (outerBefore === before && outerAfter === after) {
          view.dispatch({
            changes: [
              { from: from - bLen, to: from, insert: '' },
              { from: to, to: to + aLen, insert: '' },
            ],
            selection: EditorSelection.range(from - bLen, to - bLen),
          });
        } else {
          view.dispatch({
            changes: [
              { from, to: from, insert: before },
              { from: to, to, insert: after },
            ],
            selection: EditorSelection.range(from + bLen, to + bLen),
          });
        }
      }
      view.focus();
      return true;
    }

    // ── No selection ────────────────────────────────────────────────────────
    const line = state.doc.lineAt(from);
    const rel  = from - line.from;

    if (isStarMarker) {
      const group = findStarGroup(line.text, rel);
      if (group) {
        const min  = Math.min(group.openCount, group.closeCount);
        const isOn = bLen === 1 ? min % 2 === 1 : min >= bLen;
        const absOpen  = line.from + group.openAt;
        const absClose = line.from + group.closeAt;
        if (isOn) {
          // Remove bLen stars from the front of each group
          view.dispatch({
            changes: [
              { from: absOpen,  to: absOpen + bLen,  insert: '' },
              { from: absClose, to: absClose + bLen, insert: '' },
            ],
            selection: EditorSelection.cursor(Math.max(absOpen, from - bLen)),
          });
        } else {
          // Extend existing group by inserting at the front of each
          view.dispatch({
            changes: [
              { from: absOpen,  to: absOpen,  insert: before },
              { from: absClose, to: absClose, insert: after },
            ],
            selection: EditorSelection.cursor(from + bLen),
          });
        }
        view.focus();
        return true;
      }
    } else {
      const pair = findEnclosingMarkerPair(line.text, rel, before, after);
      if (pair) {
        const absOpen = line.from + pair[0], absClose = line.from + pair[1];
        view.dispatch({
          changes: [
            { from: absOpen,  to: absOpen + bLen,  insert: '' },
            { from: absClose, to: absClose + aLen, insert: '' },
          ],
          selection: EditorSelection.cursor(Math.max(absOpen, from - bLen)),
        });
        view.focus();
        return true;
      }
    }

    // Nothing found — insert placeholder and select it
    const insert = `${before}${placeholder}${after}`;
    view.dispatch({
      changes: { from, insert },
      selection: EditorSelection.range(from + bLen, from + bLen + placeholder.length),
    });
    view.focus();
    return true;
  };
}

function makeHeadingCommand(level: number) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from } = state.selection.main;
    const line = state.doc.lineAt(from);
    const existing = line.text.match(/^(#{1,6}) /);
    const prefix = '#'.repeat(level) + ' ';

    let change: { from: number; to: number; insert: string };
    let cursorDelta: number;

    if (existing) {
      const oldPrefix = existing[0];
      if (existing[1].length === level) {
        // Same level — toggle off
        change = { from: line.from, to: line.from + oldPrefix.length, insert: '' };
        cursorDelta = -oldPrefix.length;
      } else {
        // Different level — replace
        change = { from: line.from, to: line.from + oldPrefix.length, insert: prefix };
        cursorDelta = prefix.length - oldPrefix.length;
      }
    } else {
      // No heading — insert
      change = { from: line.from, to: line.from, insert: prefix };
      cursorDelta = prefix.length;
    }

    view.dispatch({
      changes: change,
      selection: EditorSelection.cursor(Math.max(line.from, from + cursorDelta)),
    });
    return true;
  };
}

const INDENT = '  ';

function indentLine(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  view.dispatch({
    changes: { from: line.from, insert: INDENT },
    selection: EditorSelection.cursor(from + INDENT.length),
  });
  view.focus();
  return true;
}

function dedentLine(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const leading = line.text.match(/^ {1,2}/)?.[0] ?? '';
  if (!leading) return false;
  view.dispatch({
    changes: { from: line.from, to: line.from + leading.length, insert: '' },
    selection: EditorSelection.cursor(Math.max(line.from, from - leading.length)),
  });
  view.focus();
  return true;
}

const LIST_PREFIX_RE = /^(\d+\.\s+|- )/;

function makeLinePrefixCommand(prefix: string) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from } = state.selection.main;
    const line = state.doc.lineAt(from);
    if (line.text.startsWith(prefix)) {
      // Toggle off — same prefix already present
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
        selection: EditorSelection.cursor(Math.max(line.from, from - prefix.length)),
      });
    } else {
      const existing = line.text.match(LIST_PREFIX_RE);
      const removeLen = existing ? existing[0].length : 0;
      view.dispatch({
        changes: { from: line.from, to: line.from + removeLen, insert: prefix },
        selection: EditorSelection.cursor(from + prefix.length - removeLen),
      });
    }
    view.focus();
    return true;
  };
}

export type FormatCmd =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strikethrough' }
  | { type: 'code' }
  | { type: 'ul' }
  | { type: 'ol' }
  | { type: 'blockquote' }
  | { type: 'hr' };

export interface EditorHandle {
  runFormat: (cmd: FormatCmd) => void;
  scrollToSlide: (index: number) => void;
}

interface ContextMenuState { x: number; y: number; hasSelection: boolean; clickPos: number | null }

export const EditorPanel = forwardRef<EditorHandle, Props>(function EditorPanel(
  { content, onChange, onCursorSlide, onWarn, focusMode = false, filePath, uiTheme = 'dark', editorFontFamily = DEFAULT_FONT_FAMILY, spellCheckEnabled = false, spellCheckLanguage = 'en_US' }: Props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorSlideRef = useRef(onCursorSlide);
  const onWarnRef = useRef(onWarn);
  const filePathRef = useRef(filePath);
  const uiThemeRef = useRef(uiTheme);
  const spellCheckEnabledRef = useRef(spellCheckEnabled);
  const spellCheckActiveRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCursorSlideRef.current = onCursorSlide; }, [onCursorSlide]);
  useEffect(() => { onWarnRef.current = onWarn; }, [onWarn]);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);
  useEffect(() => { uiThemeRef.current = uiTheme; }, [uiTheme]);
  useEffect(() => { spellCheckEnabledRef.current = spellCheckEnabled; }, [spellCheckEnabled]);

  useImperativeHandle(ref, () => ({
    runFormat(cmd: FormatCmd) {
      const view = viewRef.current;
      if (!view) return;
      switch (cmd.type) {
        case 'heading':      makeHeadingCommand(cmd.level)(view); break;
        case 'bold':         makeWrapCommand('**', '**', 'bold text')(view); break;
        case 'italic':       makeWrapCommand('*', '*', 'italic text')(view); break;
        case 'underline':    makeWrapCommand('<u>', '</u>', 'underlined text')(view); break;
        case 'strikethrough':makeWrapCommand('~~', '~~', 'strikethrough text')(view); break;
        case 'code':         makeWrapCommand('`', '`', 'code')(view); break;
        case 'ul':           makeLinePrefixCommand('- ')(view); break;
        case 'ol':           makeLinePrefixCommand('1. ')(view); break;
        case 'blockquote':   makeLinePrefixCommand('> ')(view); break;
        case 'hr': {
          const { from } = view.state.selection.main;
          const insert = '\n---\n';
          view.dispatch({ changes: { from, insert }, selection: EditorSelection.cursor(from + insert.length) });
          view.focus();
          break;
        }
      }
    },

    scrollToSlide(index: number) {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc.toString();

      // Skip past the frontmatter block
      const fmMatch = doc.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const bodyStart = fmMatch ? fmMatch[0].length : 0;

      let pos = bodyStart;

      if (index > 0) {
        // Find the index-th standalone --- separator in the body
        const body = doc.slice(bodyStart);
        const sep = /^---$/gm;
        let found = 0;
        let m: RegExpExecArray | null;
        while ((m = sep.exec(body)) !== null) {
          found++;
          if (found === index) {
            // Place cursor on the line after the --- separator
            const afterSep = bodyStart + m.index + m[0].length;
            pos = afterSep + (doc[afterSep] === '\r' ? 2 : doc[afterSep] === '\n' ? 1 : 0);
            break;
          }
        }
      }

      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
      view.focus();
    },
  }), []);

  // Create editor once
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const raw = update.state.doc.toString().slice(0, pos);
        // Strip frontmatter block so its --- delimiters aren't counted as slide separators
        const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
        const slideIndex = (stripped.match(/^---$/gm) ?? []).length;
        onCursorSlideRef.current?.(slideIndex);
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        editorColorCompartment.of(
          uiThemeRef.current === 'light' ? editorLightTheme : [oneDark, editorDarkTheme]
        ),
        editorFontCompartment.of(makeFontTheme(editorFontFamily)),
        EditorView.lineWrapping,
        markdown({ codeLanguages: languages }),
        Prec.high(keymap.of([
          indentWithTab,
          { key: 'Mod-b',       run: makeWrapCommand('**',  '**',   'bold text') },
          { key: 'Mod-i',       run: makeWrapCommand('*',   '*',    'italic text') },
          { key: 'Mod-u',       run: makeWrapCommand('<u>', '</u>', 'underlined text') },
          { key: 'Mod-Shift-x', run: makeWrapCommand('~~',  '~~',   'strikethrough text') },
          { key: 'Mod-`',       run: makeWrapCommand('`',   '`',    'code') },
          { key: 'Mod-]', run: indentLine },
          { key: 'Mod-[', run: dedentLine },
          { key: 'Mod-1', run: makeHeadingCommand(1) },
          { key: 'Mod-2', run: makeHeadingCommand(2) },
          { key: 'Mod-3', run: makeHeadingCommand(3) },
          { key: 'Mod-4', run: makeHeadingCommand(4) },
          { key: 'Mod-5', run: makeHeadingCommand(5) },
          { key: 'Mod-6', run: makeHeadingCommand(6) },
        ])),
        updateListener,
        focusModeCompartment.of([]),
        spellCheckCompartment.of([]),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle OS file drops via Tauri's drag-drop window event.
  // The browser File API never exposes paths; this is the only reliable source.
  useEffect(() => {
    const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif|tiff?)$/i;
    const dragHasImages = { current: false };

    const unlisten = getCurrentWindow().onDragDropEvent((evt) => {
      const p = evt.payload;

      if (p.type === 'enter') {
        dragHasImages.current = p.paths.some((f) => IMAGE_EXT.test(f));
        return;
      }

      if (p.type === 'over') {
        if (!dragHasImages.current) return;
        const rect = containerRef.current?.getBoundingClientRect();
        const overEditor = !!rect
          && p.position.x >= rect.left && p.position.x <= rect.right
          && p.position.y >= rect.top  && p.position.y <= rect.bottom;
        setDragActive(overEditor);
        return;
      }

      if (p.type === 'leave') {
        setDragActive(false);
        dragHasImages.current = false;
        return;
      }

      if (p.type === 'drop') {
        setDragActive(false);
        dragHasImages.current = false;

        const { x, y } = p.position;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;

        const imagePaths = p.paths.filter((f) => IMAGE_EXT.test(f));
        if (!imagePaths.length) return;

        const view = viewRef.current;
        if (!view) return;

        const pos = view.posAtCoords({ x, y }) ?? view.state.doc.length;
        const docPath = filePathRef.current ?? null;
        const docDir  = docPath
          ? docPath.substring(0, Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\')))
          : null;

        void (async () => {
          const inserts = await Promise.all(imagePaths.map(async (abs) => {
            const label = abs.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'image';
            let imgPath: string;

            if (!docDir) {
              onWarnRef.current?.('Save your document first before dropping images.');
              return null;
            }

            const normAbs = abs.replace(/\\/g, '/');
            const normDir = docDir.replace(/\\/g, '/');
            if (normAbs.startsWith(normDir + '/')) {
              // Already inside the document folder — use a relative path.
              imgPath = makeRelativePath(docPath!, abs);
            } else {
              // Outside the document folder — copy into assets/ to avoid
              // macOS permission issues with protected directories (Desktop, etc.).
              try {
                const filename = await invoke<string>('copy_image_to_assets', { src: abs, destDir: docDir });
                imgPath = `assets/${filename}`;
              } catch (e) {
                console.error('[Kova] copy_image_to_assets failed:', e);
                onWarnRef.current?.(
                  'Could not copy image — on macOS, grant Kova access under System Settings → Privacy & Security → Files and Folders.'
                );
                return null;
              }
            }

            return `![${label}](${encodeMarkdownPath(imgPath)})`;
          }));

          const validInserts = inserts.filter((s): s is string => s !== null);
          if (!validInserts.length) return;
          const insert = validInserts.join('\n');
          view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
          view.focus();
        })();
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Sync external content changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  // Toggle focus mode extension when prop changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: focusModeCompartment.reconfigure(focusModeExtension(focusMode)),
    });
  }, [focusMode]);

  // Manage spell check extension
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (spellCheckEnabled) {
      if (!spellCheckActiveRef.current) {
        view.dispatch({ effects: spellCheckCompartment.reconfigure(spellCheckExtension()) });
        spellCheckActiveRef.current = true;
      }
      initSpellChecker(spellCheckLanguage as SpellCheckLanguage);
    } else if (spellCheckActiveRef.current) {
      view.dispatch({ effects: spellCheckCompartment.reconfigure([]) });
      spellCheckActiveRef.current = false;
    }
  }, [spellCheckEnabled, spellCheckLanguage]);

  // Switch editor color theme when uiTheme prop changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editorColorCompartment.reconfigure(
        uiTheme === 'light' ? editorLightTheme : [oneDark, editorDarkTheme]
      ),
    });
  }, [uiTheme]);

  // Switch editor font when editorFontFamily prop changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editorFontCompartment.reconfigure(makeFontTheme(editorFontFamily)),
    });
  }, [editorFontFamily]);

  // ── Context menu ────────────────────────────────────────────────────────────

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const clickPos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection: from !== to, clickPos: clickPos ?? null });
  }

  function getWordAtPos(pos: number): { word: string; from: number; to: number } | null {
    const view = viewRef.current;
    if (!view) return null;
    const doc = view.state.doc.toString();
    let from = pos;
    let to = pos;
    while (from > 0 && /[a-zA-Z'-]/.test(doc[from - 1])) from--;
    while (to < doc.length && /[a-zA-Z'-]/.test(doc[to])) to++;
    while (from < to && /['"-]/.test(doc[from])) from++;
    while (to > from && /['"-]/.test(doc[to - 1])) to--;
    if (to - from < 2) return null;
    return { word: doc.slice(from, to), from, to };
  }

  function doCopy() {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from !== to) navigator.clipboard.writeText(view.state.sliceDoc(from, to));
  }

  function doCut() {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    view.dispatch({ changes: { from, to, insert: '' } });
    view.focus();
  }

  async function doPaste() {
    const view = viewRef.current;
    if (!view) return;
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
    });
    view.focus();
  }

  function doInsert(snippet: string, cursorOffset: number) {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: snippet },
      selection: EditorSelection.cursor(from + cursorOffset),
    });
    view.focus();
  }

  function doWrap(before: string, after: string, placeholder: string) {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) {
      const insert = `${before}${placeholder}${after}`;
      view.dispatch({
        changes: { from, insert },
        selection: EditorSelection.range(from + before.length, from + before.length + placeholder.length),
      });
    } else {
      const selected = view.state.sliceDoc(from, to);
      const insert = `${before}${selected}${after}`;
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + insert.length),
      });
    }
    view.focus();
  }

  const mod = isMac ? 'Cmd' : 'Ctrl';

  function buildMenuEntries(): MenuEntry[] {
    const hasSel = ctxMenu?.hasSelection ?? false;
    const view = viewRef.current;

    const spellEntries: MenuEntry[] = [];
    if (spellCheckEnabledRef.current && ctxMenu?.clickPos != null && view && isSpellCheckerReady()) {
      const wordInfo = getWordAtPos(ctxMenu.clickPos);
      if (wordInfo && !spellCheck(wordInfo.word)) {
        const suggestions = spellSuggest(wordInfo.word);
        spellEntries.push({ type: 'header', label: `"${wordInfo.word}"` });
        if (suggestions.length > 0) {
          suggestions.forEach(s => spellEntries.push({
            type: 'item',
            label: s,
            action: () => {
              const v = viewRef.current;
              if (!v) return;
              v.dispatch({
                changes: { from: wordInfo.from, to: wordInfo.to, insert: s },
                selection: EditorSelection.cursor(wordInfo.from + s.length),
              });
              v.focus();
            },
          }));
        } else {
          spellEntries.push({ type: 'item', label: 'No suggestions', disabled: true, action: () => {} });
        }
        spellEntries.push({
          type: 'item',
          label: 'Add to Kova\'s dictionary',
          action: () => addCustomWord(wordInfo.word),
        });
        spellEntries.push({
          type: 'item',
          label: 'Ignore',
          action: () => ignoreSpellingFor(wordInfo.word),
        });
        spellEntries.push({ type: 'divider' });
      }
    }

    return [
      ...spellEntries,
      { type: 'header', label: 'Clipboard' },
      { type: 'item', label: 'Copy',  shortcut: `${mod}+C`, action: doCopy,  disabled: !hasSel },
      { type: 'item', label: 'Cut',   shortcut: `${mod}+X`, action: doCut,   disabled: !hasSel },
      { type: 'item', label: 'Paste', shortcut: `${mod}+V`, action: doPaste },
      { type: 'divider' },
      { type: 'header', label: 'Format' },
      { type: 'item', label: 'Bold',          shortcut: `${mod}+B`,       action: () => doWrap('**',  '**',   'bold text') },
      { type: 'item', label: 'Italic',        shortcut: `${mod}+I`,       action: () => doWrap('*',   '*',    'italic text') },
      { type: 'item', label: 'Underline',     shortcut: `${mod}+U`,       action: () => doWrap('<u>', '</u>', 'underlined text') },
      { type: 'item', label: 'Strikethrough', shortcut: `${mod}+Shift+X`, action: () => doWrap('~~',  '~~',   'strikethrough text') },
      { type: 'item', label: 'Inline Code',   shortcut: `${mod}+\``,      action: () => doWrap('`',   '`',    'code') },
      { type: 'item', label: 'Indent',        shortcut: `${mod}+]`,       action: () => { const v = viewRef.current; if (v) indentLine(v); } },
      { type: 'item', label: 'Dedent',        shortcut: `${mod}+[`,       action: () => { const v = viewRef.current; if (v) dedentLine(v); } },
      { type: 'divider' },
      {
        type: 'submenu', label: 'Insert', entries: [
          { type: 'item', label: 'Code Block',      action: () => doInsert('```\n\n```', 3) },
          { type: 'item', label: 'Blockquote',      action: () => doInsert('> ', 2) },
          { type: 'item', label: 'Table',           action: () => doInsert('| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |', 2) },
          { type: 'item', label: 'Horizontal Rule', action: () => doInsert('\n<hr>\n', 5) },
          { type: 'item', label: 'Image',           action: () => doInsert('![alt text](url)', 2) },
          { type: 'item', label: 'Link',            action: () => doInsert('[link text](url)', 1) },
          { type: 'item', label: 'Speaker Notes',   action: () => doInsert('\n\n???\n\n', 7) },
        ],
      },
      { type: 'divider' },
      {
        type: 'submenu', label: 'Charts', entries: [
          {
            type: 'item', label: 'Pie Chart',
            action: () => doInsert(
              '\n```mermaid\npie title Distribution\n    "Category A" : 40\n    "Category B" : 35\n    "Category C" : 25\n```\n',
              22,  // lands on "Distribution"
            ),
          },
          {
            type: 'item', label: 'Bar Chart',
            action: () => doInsert(
              '\n```mermaid\nxychart-beta\n    title "Sales by Quarter"\n    x-axis [Q1, Q2, Q3, Q4]\n    y-axis 0 --> 100\n    bar [40, 65, 55, 80]\n```\n',
              36,  // lands on "Sales by Quarter"
            ),
          },
          {
            type: 'item', label: 'Line Chart',
            action: () => doInsert(
              '\n```mermaid\nxychart-beta\n    title "Trend Over Time"\n    x-axis [Jan, Feb, Mar, Apr, May]\n    y-axis 0 --> 100\n    line [30, 45, 60, 55, 75]\n```\n',
              36,  // lands on "Trend Over Time"
            ),
          },
        ],
      },
      {
        type: 'submenu', label: 'Diagrams', entries: [
          {
            type: 'item', label: 'Progress Bars',
            action: () => doInsert(
              '\n!progress[Task Complete](75)\n!progress[In Progress](40)\n!progress[Planned](10)\n',
              11,  // lands on "Task Complete"
            ),
          },
          {
            type: 'item', label: 'Flowchart',
            action: () => doInsert(
              '\n```mermaid\nflowchart TD\n    A([Start]) --> B[Process Step]\n    B --> C{Decision?}\n    C -- Yes --> D([End])\n    C -- No --> B\n```\n',
              46,  // lands on "Process Step"
            ),
          },
          {
            type: 'item', label: 'Timeline',
            action: () => doInsert(
              '\n```mermaid\ntimeline\n    title Company Milestones\n    2022 : Founded\n         : Seed Funding\n    2023 : Product Launch\n         : 1K Users\n    2024 : Series A\n         : 10K Users\n```\n',
              31,  // lands on "Company Milestones"
            ),
          },
          {
            type: 'item', label: 'Sequence Diagram',
            action: () => doInsert(
              '\n```mermaid\nsequenceDiagram\n    participant U as User\n    participant A as App\n    participant D as Database\n    U->>A: Login Request\n    A->>D: Verify Credentials\n    D-->>A: User Found\n    A-->>U: Access Granted\n```\n',
              49,  // lands on "User"
            ),
          },
        ],
      },
    ];
  }

  return (
    <>
    <div className="editor-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Editor
        {focusMode && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#D94F00', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            Focus Mode
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} onContextMenu={handleContextMenu} />
        {dragActive && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none',
            border: '2px dashed #D94F00', borderRadius: 4,
            background: 'rgba(217,79,0,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#D94F00', fontSize: 13, fontWeight: 500 }}>Drop image to insert</span>
          </div>
        )}
        {!content && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, color: 'var(--text-dim)', fontSize: 13, pointerEvents: 'none', userSelect: 'none',
          }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>📄</span>
            <span>{mod}+N — new presentation</span>
            <span>{mod}+O — open file</span>
          </div>
        )}
      </div>
    </div>
    {ctxMenu && (
      <EditorContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        entries={buildMenuEntries()}
        onClose={() => setCtxMenu(null)}
      />
    )}
    </>
  );
});
