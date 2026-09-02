import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { indentWithTab, undo, redo, selectAll } from '@codemirror/commands';
import { Annotation, Compartment, EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { focusModeCompartment, focusModeExtension } from '../editor/focusMode';
import { slideDivider } from '../editor/slideDivider';
import { stepMarkerDecoration } from '../editor/stepMarkerDecoration';
import { EditorContextMenu } from '../editor/EditorContextMenu';
import {
  slideNav,
  makeWrapCommand,
  makeHeadingCommand,
  indentLine,
  dedentLine,
  makeLinePrefixCommand,
  makeListCommand,
  findNextRange,
} from '../editor/formatCommands';
import { buildMediaSnippet } from '../editor/mediaSnippet';
import { buildContextMenuEntries } from '../editor/contextMenuEntries';
import { insertTable, doToggleLineStepMarker } from '../editor/contextMenuActions';
import { useMediaDragAndDrop } from '../editor/useMediaDragAndDrop';
import { useMediaPaste } from '../editor/useMediaPaste';
import { ModalShell } from '../ModalShell';
import { isMac } from '../../engine/keybindings';
import { slideStartLines } from '../../engine/parser/markdownToSlides';
import { spellCheckExtension } from '../../engine/spellcheck/spellCheckExtension';
import { initSpellChecker } from '../../engine/spellcheck/spellChecker';
import type { SpellCheckLanguage } from '../../engine/spellcheck/spellChecker';
import { useT } from '../../i18n';
import '../../styles/editor.css';

interface Props {
  content: string;
  onChange: (value: string) => void;
  onCursorSlide?: (index: number) => void;
  onWarn?: (msg: string) => void;
  onSaveAs?: () => Promise<string | null>;
  onRequestFind?: () => void;
  focusMode?: boolean;
  filePath?: string | null;
  uiTheme?: 'dark' | 'light';
  editorFontFamily?: string;
  wordWrap?: boolean;
  contentWidth?: 'fixed' | 'full';
  spellCheckEnabled?: boolean;
  spellCheckLanguage?: string;
}

// Tags dispatches made by the content-sync effect so the update listener can
// tell them apart from real user edits and skip marking the doc dirty.
const externalSync = Annotation.define<boolean>();


const DEFAULT_FONT_SIZE = 14;
const SCROLLER_BASE = { lineHeight: '1.7' };
const CONTENT       = { padding: '16px 24px' };

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

function makeContentWidthTheme(contentWidth: 'fixed' | 'full') {
  return EditorView.theme({
    '.cm-content': contentWidth === 'full'
      ? { maxWidth: 'none' }
      : { maxWidth: '720px', margin: '0 auto' },
  });
}


const editorColorCompartment    = new Compartment();
const editorFontCompartment     = new Compartment();
const editorFontSizeCompartment = new Compartment();
const lineWrapCompartment       = new Compartment();
const spellCheckCompartment     = new Compartment();
const contentWidthCompartment   = new Compartment();

function makeFontSizeTheme(size: number) {
  return EditorView.theme({ '.cm-scroller': { fontSize: `${size}px` } });
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
  findNext: (query: string, dir?: 1 | -1) => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  focus: () => void;
}

interface ContextMenuState { x: number; y: number; hasSelection: boolean; clickPos: number | null }
interface ConfirmState { title: string; message: string; okLabel: string; resolve: (ok: boolean) => void }

export const EditorPanel = forwardRef<EditorHandle, Props>(function EditorPanel(
  { content, onChange, onCursorSlide, onWarn, onSaveAs, onRequestFind, focusMode = false, filePath, uiTheme = 'dark', editorFontFamily = DEFAULT_FONT_FAMILY, wordWrap = true, contentWidth = 'fixed', spellCheckEnabled = false, spellCheckLanguage = 'en_US' }: Props,
  ref,
) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fontSizeRef = useRef(DEFAULT_FONT_SIZE);
  const onChangeRef = useRef(onChange);
  const onCursorSlideRef = useRef(onCursorSlide);
  const onWarnRef = useRef(onWarn);
  const onSaveAsRef = useRef(onSaveAs);
  const onRequestFindRef = useRef(onRequestFind);
  const filePathRef = useRef(filePath);
  const uiThemeRef = useRef(uiTheme);
  const spellCheckEnabledRef = useRef(spellCheckEnabled);
  const spellCheckActiveRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [tablePromptOpen, setTablePromptOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const showConfirmRef = useRef<(title: string, message: string, okLabel?: string) => Promise<boolean>>(null!);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCursorSlideRef.current = onCursorSlide; }, [onCursorSlide]);
  useEffect(() => { onWarnRef.current = onWarn; }, [onWarn]);
  useEffect(() => { onSaveAsRef.current = onSaveAs; }, [onSaveAs]);
  useEffect(() => { onRequestFindRef.current = onRequestFind; }, [onRequestFind]);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);
  useEffect(() => { uiThemeRef.current = uiTheme; }, [uiTheme]);
  useEffect(() => { spellCheckEnabledRef.current = spellCheckEnabled; }, [spellCheckEnabled]);

  useEffect(() => {
    showConfirmRef.current = (title, message, okLabel = 'OK') =>
      new Promise<boolean>((resolve) => setConfirmState({ title, message, okLabel, resolve }));
  }, []);

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
        case 'ul':           makeListCommand('ul')(view); break;
        case 'ol':           makeListCommand('ol')(view); break;
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

    undo() {
      const view = viewRef.current;
      if (!view) return;
      undo(view);
      view.focus();
    },

    redo() {
      const view = viewRef.current;
      if (!view) return;
      redo(view);
      view.focus();
    },

    selectAll() {
      const view = viewRef.current;
      if (!view) return;
      selectAll(view);
      view.focus();
    },

    focus() {
      viewRef.current?.focus();
    },

    scrollToSlide(index: number) {
      const view = viewRef.current;
      if (!view) return;
      const starts = slideStartLines(view.state.doc.toString());
      const line = starts[index] ?? starts[starts.length - 1] ?? 1;
      const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;

      view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 4 }),
      });
      view.focus();
    },

    findNext(query: string, dir: 1 | -1 = 1) {
      const view = viewRef.current;
      if (!view) return;

      const doc = view.state.doc.toString();
      const sel = view.state.selection.main;
      const start = dir === 1 ? sel.to : sel.from;

      const range = findNextRange(doc, query, start, dir);
      if (!range) return;

      const { from, to } = range;
      view.dispatch({
        selection: EditorSelection.range(from, to),
        effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 12 }),
      });
      view.focus();
    },
  }), []);

  // Create editor once
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((tr) => tr.annotation(externalSync))) {
        onChangeRef.current(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        const cursorLine = update.state.doc.lineAt(update.state.selection.main.head).number;
        const starts = slideStartLines(update.state.doc.toString());
        let slideIndex = 0;
        for (let i = 0; i < starts.length; i++) {
          if (starts[i] <= cursorLine) slideIndex = i; else break;
        }
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
        editorFontSizeCompartment.of(makeFontSizeTheme(DEFAULT_FONT_SIZE)),
        lineWrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        contentWidthCompartment.of(makeContentWidthTheme(contentWidth)),
        markdown({ codeLanguages: languages }),
        Prec.high(keymap.of([
          indentWithTab,
          {
            key: 'Mod-f',
            run: () => {
              onRequestFindRef.current?.();
              return true;
            },
            preventDefault: true,
          },
          { key: 'Mod-b',       run: makeWrapCommand('**',  '**',   'bold text') },
          { key: 'Mod-i',       run: makeWrapCommand('*',   '*',    'italic text') },
          { key: 'Mod-u',       run: makeWrapCommand('<u>', '</u>', 'underlined text') },
          { key: 'Mod-Shift-x', run: makeWrapCommand('~~',  '~~',   'strikethrough text') },
          { key: 'Mod-`',       run: makeWrapCommand('`',   '`',    'code') },
          { key: 'Mod-]', run: indentLine },
          { key: 'Mod-[', run: dedentLine },
          {
            key: 'Mod-Shift-r',
            run: (view) => { doToggleLineStepMarker(view, view.state.selection.main.head); return true; },
          },
          { key: 'Mod-ArrowUp',    run: slideNav((i) => i - 1) },
          { key: 'PageUp',         run: slideNav((i) => i - 1) },
          { key: 'Mod-ArrowDown',  run: slideNav((i) => i + 1) },
          { key: 'PageDown',       run: slideNav((i) => i + 1) },
          { key: 'Mod-Home',       run: slideNav(() => 0) },
          { key: 'Mod-End',        run: slideNav((_i, n) => n - 1) },
          { key: 'Mod-1', run: makeHeadingCommand(1) },
          { key: 'Mod-2', run: makeHeadingCommand(2) },
          { key: 'Mod-3', run: makeHeadingCommand(3) },
          { key: 'Mod-4', run: makeHeadingCommand(4) },
          { key: 'Mod-5', run: makeHeadingCommand(5) },
          { key: 'Mod-6', run: makeHeadingCommand(6) },
          {
            key: 'Mod-=', run: (view) => {
              const next = Math.min(36, fontSizeRef.current + 2);
              fontSizeRef.current = next;
              view.dispatch({ effects: editorFontSizeCompartment.reconfigure(makeFontSizeTheme(next)) });
              return true;
            },
          },
          {
            key: 'Mod--', run: (view) => {
              const next = Math.max(8, fontSizeRef.current - 2);
              fontSizeRef.current = next;
              view.dispatch({ effects: editorFontSizeCompartment.reconfigure(makeFontSizeTheme(next)) });
              return true;
            },
          },
          {
            key: 'Mod-0', run: (view) => {
              fontSizeRef.current = DEFAULT_FONT_SIZE;
              view.dispatch({ effects: editorFontSizeCompartment.reconfigure(makeFontSizeTheme(DEFAULT_FONT_SIZE)) });
              return true;
            },
          },
        ])),
        updateListener,
        slideDivider,
        stepMarkerDecoration,
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

  const dragActive = useMediaDragAndDrop({ containerRef, viewRef, filePathRef, onWarnRef, t });
  useMediaPaste({ containerRef, viewRef, filePathRef, onWarnRef, t });

  // Ctrl+scroll to zoom editor font size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      const delta = e.deltaY > 0 ? -2 : 2;
      const next = Math.max(8, Math.min(36, fontSizeRef.current + delta));
      if (next === fontSizeRef.current) return;
      fontSizeRef.current = next;
      view.dispatch({ effects: editorFontSizeCompartment.reconfigure(makeFontSizeTheme(next)) });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Sync external content changes. CodeMirror normalises \r\n→\n internally, so
  // a CRLF file on disk always "differs" from the LF doc — ignore CR-only diffs,
  // else opening an unedited CRLF file fires a spurious change (issue #95).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    // `current !== content` is the fast path (equal on every keystroke); only
    // when they differ do we pay the line-ending-normalising compare. CodeMirror
    // collapses lone \r as well as \r\n, so both must be normalised here too.
    if (current !== content && current !== content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')) {
      // Never let this land as an undoable edit: without addToHistory:false,
      // switching documents (or reloading one from disk) pushes a "replace
      // whole doc" transaction onto the undo stack, so Ctrl+Z in the newly
      // loaded document pulls the previous document's content back in.
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [content]);

  // Toggle focus mode extension when prop changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: focusModeCompartment.reconfigure(focusModeExtension(focusMode)),
    });
  }, [focusMode]);

  // Toggle line wrapping when prop changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineWrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  // Switch content width when prop changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: contentWidthCompartment.reconfigure(makeContentWidthTheme(contentWidth)),
    });
  }, [contentWidth]);

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

  const mod = isMac ? 'Cmd' : 'Ctrl';

  function openTablePrompt() {
    setTableRows(3);
    setTableCols(3);
    setTablePromptOpen(true);
  }

  function handleInsertTable() {
    const view = viewRef.current;
    if (!view) return;
    insertTable(view, tableRows, tableCols);
    setTablePromptOpen(false);
  }

  // Resolve the document path before opening any picker. If unsaved, explain
  // why and offer to save first.
  async function handleInsertMedia() {
    let docPath = filePathRef.current ?? null;
    if (!docPath) {
      const ok = await showConfirmRef.current(
        t('editor.saveDocumentFirstTitle'),
        t('editor.saveDocumentFirstMessage'),
        t('common.save'),
      );
      if (!ok) return;
      docPath = await onSaveAsRef.current?.() ?? null;
      if (!docPath) return;
    }

    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif', 'tiff', 'mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'] }],
    });
    if (!selected) return;

    const snippet = await buildMediaSnippet(selected, docPath, (m) => onWarnRef.current?.(m));
    if (!snippet) return;
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: snippet }, selection: EditorSelection.cursor(from + snippet.length) });
    view.focus();
  }

  return (
    <>
    <div className="editor-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        {t('layout.editorPanelHeader')}
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
            <span style={{ color: '#D94F00', fontSize: 13, fontWeight: 500 }}>{t('editor.dropImageHint')}</span>
          </div>
        )}
        {!content && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, color: 'var(--text-dim)', fontSize: 13, pointerEvents: 'none', userSelect: 'none',
          }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>📄</span>
            <span>{t('editor.newPresentationHint', { mod })}</span>
            <span>{t('editor.openFileHint', { mod })}</span>
            <span>{t('editor.tocHint')}</span>
          </div>
        )}
      </div>
    </div>
    {ctxMenu && (
      <EditorContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        entries={buildContextMenuEntries({
          t,
          mod,
          view: viewRef.current,
          hasSelection: ctxMenu.hasSelection,
          clickPos: ctxMenu.clickPos,
          spellCheckEnabled: spellCheckEnabledRef.current,
          onOpenTablePrompt: openTablePrompt,
          onInsertMedia: handleInsertMedia,
        })}
        onClose={() => setCtxMenu(null)}
      />
    )}
    {confirmState && (
      <ModalShell
        onClose={() => { confirmState.resolve(false); setConfirmState(null); }}
        width={320}
        maxWidth="90vw"
        ariaLabel={confirmState.title}
        cardStyle={{ padding: '24px 28px' }}
      >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            {confirmState.title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
            {confirmState.message}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={() => { confirmState.resolve(true); setConfirmState(null); }}>
              {confirmState.okLabel}
            </button>
          </div>
      </ModalShell>
    )}
    {tablePromptOpen && (
      <ModalShell
        onClose={() => setTablePromptOpen(false)}
        width={280}
        maxWidth="90vw"
        ariaLabel={t('editor.insertTableTitle')}
        cardStyle={{ padding: '24px 28px' }}
      >
        {/* Guards against the document-level mousedown listeners App.tsx uses
            to close the File/Edit menus on outside-click. */}
        <div onMouseDown={e => e.stopPropagation()}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
            {t('editor.insertTableTitle')}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
            <label style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('editor.insertTableColumns')}</div>
              <input
                type="number" min={1} max={20} value={tableCols}
                onChange={e => setTableCols(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                style={{
                  width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 5,
                  border: '1px solid var(--border)', background: 'var(--bg-base)',
                  color: 'var(--text-primary)', boxSizing: 'border-box',
                }}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleInsertTable();
                }}
              />
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('editor.insertTableRows')}</div>
              <input
                type="number" min={2} max={50} value={tableRows}
                onChange={e => setTableRows(Math.max(2, Math.min(50, parseInt(e.target.value) || 2)))}
                style={{
                  width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 5,
                  border: '1px solid var(--border)', background: 'var(--bg-base)',
                  color: 'var(--text-primary)', boxSizing: 'border-box',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleInsertTable();
                }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setTablePromptOpen(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={handleInsertTable}>
              {t('editor.insertTableAction')}
            </button>
          </div>
        </div>
      </ModalShell>
    )}
    </>
  );
});
