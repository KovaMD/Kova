import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { indentWithTab } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { focusModeCompartment, focusModeExtension } from '../editor/focusMode';
import { EditorContextMenu } from '../editor/EditorContextMenu';
import type { MenuEntry } from '../editor/EditorContextMenu';
import '../../styles/editor.css';

interface Props {
  content: string;
  onChange: (value: string) => void;
  onCursorSlide?: (index: number) => void;
  focusMode?: boolean;
  filePath?: string | null;
}

// Returns a path to `target` relative to the directory of `docPath`.
// Falls back to the absolute path if they share no common prefix.
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


const editorTheme = EditorView.theme({
  '&': { background: '#1e1e1e', height: '100%' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '14px', lineHeight: '1.7' },
  '.cm-content': { padding: '16px 24px', maxWidth: '720px', margin: '0 auto' },
  '.cm-gutters': { background: '#1e1e1e', borderRight: '1px solid #2a2a2a' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  '.cm-cursor': { borderLeftColor: '#D94F00' },
});

function makeWrapCommand(before: string, after: string, placeholder: string) {
  return (view: EditorView): boolean => {
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

function makeLinePrefixCommand(prefix: string) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from } = state.selection.main;
    const line = state.doc.lineAt(from);
    if (line.text.startsWith(prefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
        selection: EditorSelection.cursor(Math.max(line.from, from - prefix.length)),
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: prefix },
        selection: EditorSelection.cursor(from + prefix.length),
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
}

interface ContextMenuState { x: number; y: number; hasSelection: boolean }

export const EditorPanel = forwardRef<EditorHandle, Props>(function EditorPanel(
  { content, onChange, onCursorSlide, focusMode = false, filePath }: Props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorSlideRef = useRef(onCursorSlide);
  const filePathRef = useRef(filePath);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCursorSlideRef.current = onCursorSlide; }, [onCursorSlide]);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

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
        oneDark,
        editorTheme,
        EditorView.lineWrapping,
        markdown({ codeLanguages: languages }),
        keymap.of([
          indentWithTab,
          { key: 'Ctrl-b', run: makeWrapCommand('**', '**', 'bold text') },
          { key: 'Ctrl-i', run: makeWrapCommand('*',  '*',  'italic text') },
          { key: 'Ctrl-1', run: makeHeadingCommand(1) },
          { key: 'Ctrl-2', run: makeHeadingCommand(2) },
          { key: 'Ctrl-3', run: makeHeadingCommand(3) },
          { key: 'Ctrl-4', run: makeHeadingCommand(4) },
          { key: 'Ctrl-5', run: makeHeadingCommand(5) },
          { key: 'Ctrl-6', run: makeHeadingCommand(6) },
        ]),
        updateListener,
        focusModeCompartment.of([]),
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
        const inserts = imagePaths.map((abs) => {
          const imgPath = filePathRef.current ? makeRelativePath(filePathRef.current, abs) : abs;
          const label = abs.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'image';
          return `![${label}](${imgPath})`;
        });
        const insert = inserts.join('\n');
        view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
        view.focus();
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

  // ── Context menu ────────────────────────────────────────────────────────────

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection: from !== to });
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

  function buildMenuEntries(): MenuEntry[] {
    const hasSel = ctxMenu?.hasSelection ?? false;
    return [
      { type: 'header', label: 'Clipboard' },
      { type: 'item', label: 'Copy',  shortcut: 'Ctrl+C', action: doCopy,  disabled: !hasSel },
      { type: 'item', label: 'Cut',   shortcut: 'Ctrl+X', action: doCut,   disabled: !hasSel },
      { type: 'item', label: 'Paste', shortcut: 'Ctrl+V', action: doPaste },
      { type: 'divider' },
      { type: 'header', label: 'Format' },
      { type: 'item', label: 'Bold',   shortcut: 'Ctrl+B', action: () => doWrap('**', '**', 'bold text') },
      { type: 'item', label: 'Italic', shortcut: 'Ctrl+I', action: () => doWrap('*', '*', 'italic text') },
      { type: 'divider' },
      { type: 'header', label: 'Insert' },
      { type: 'item', label: 'Code Block',      action: () => doInsert('```\n\n```', 3) },
      { type: 'item', label: 'Blockquote',      action: () => doInsert('> ', 2) },
      { type: 'item', label: 'Table',           action: () => doInsert('| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |', 2) },
      { type: 'item', label: 'Horizontal Rule', action: () => doInsert('\n<hr>\n', 5) },
      { type: 'item', label: 'Image',           action: () => doInsert('![alt text](url)', 2) },
      { type: 'item', label: 'Link',            action: () => doInsert('[link text](url)', 1) },
      { type: 'divider' },
      { type: 'header', label: 'Charts' },
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
      { type: 'divider' },
      { type: 'header', label: 'Diagrams' },
      {
        type: 'item', label: 'Progress Bars',
        action: () => doInsert(
          '\n!progress[Task Complete](75)\n!progress[In Progress](40)\n!progress[Planned](10)\n',
          11,  // lands on "Task Complete"
        ),
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
            gap: 10, color: '#444', fontSize: 13, pointerEvents: 'none', userSelect: 'none',
          }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>📄</span>
            <span>Ctrl+N — new presentation</span>
            <span>Ctrl+O — open file</span>
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
