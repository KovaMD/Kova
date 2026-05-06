import { useEffect, useRef, useState } from 'react';
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
}

const editorTheme = EditorView.theme({
  '&': { background: '#1e1e1e', height: '100%' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '14px', lineHeight: '1.7' },
  '.cm-content': { padding: '16px 24px', maxWidth: '720px', margin: '0 auto' },
  '.cm-gutters': { background: '#1e1e1e', borderRight: '1px solid #2a2a2a' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  '.cm-cursor': { borderLeftColor: '#D94F00' },
});

interface ContextMenuState { x: number; y: number; hasSelection: boolean }

export function EditorPanel({ content, onChange, onCursorSlide, focusMode = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorSlideRef = useRef(onCursorSlide);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCursorSlideRef.current = onCursorSlide; }, [onCursorSlide]);

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
        markdown({ codeLanguages: languages }),
        keymap.of([indentWithTab]),
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
      { type: 'item', label: 'Code Block',     action: () => doInsert('```\n\n```', 3) },
      { type: 'item', label: 'Blockquote',     action: () => doInsert('> ', 2) },
      { type: 'item', label: 'Table',          action: () => doInsert('| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |', 2) },
      { type: 'item', label: 'Horizontal Rule', action: () => doInsert('\n---\n', 5) },
      { type: 'item', label: 'Image',          action: () => doInsert('![alt text](url)', 2) },
      { type: 'item', label: 'Link',           action: () => doInsert('[link text](url)', 1) },
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
}
