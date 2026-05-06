import { useEffect, useRef } from 'react';
import { indentWithTab } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { focusModeCompartment, focusModeExtension } from '../editor/focusMode';
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
  '.cm-cursor': { borderLeftColor: '#c07a30' },
});

export function EditorPanel({ content, onChange, onCursorSlide, focusMode = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorSlideRef = useRef(onCursorSlide);

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

  return (
    <div className="editor-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Editor
        {focusMode && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#c07a30', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            Focus Mode
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
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
  );
}
