import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from 'react-resizable-panels';

import { ThumbnailPanel } from './components/layout/ThumbnailPanel';
import { EditorPanel } from './components/layout/EditorPanel';
import { PreviewPanel } from './components/layout/PreviewPanel';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { StatusBar } from './components/layout/StatusBar';
import { PresentationOverlay } from './components/presentation/PresentationOverlay';

import { parseDocument } from './engine/parser/markdownToSlides';
import { exportToPptx } from './engine/export/exportPptx';
import { BUILT_IN_THEMES, DEFAULT_THEME, parseThemeYaml } from './engine/theme';
import type { Slide, Frontmatter } from './engine/types';
import { parseAspectRatio } from './engine/types';
import type { Theme } from './engine/theme';

import './styles/global.css';

function makeStarter() {
  return `---
title: My Presentation
date: ${new Date().getFullYear()}
---

# My Presentation

---

## First Slide

- Point one
- Point two
- Point three
`;
}

function countWords(text: string): number {
  return (text.match(/\b\w+\b/g) ?? []).length;
}

const EMPTY_SLIDES: Slide[] = [];
const EMPTY_FM: Frontmatter = {};

export default function App() {
  const [filePath, setFilePath]           = useState<string | null>(null);
  const [content, setContent]             = useState('');
  const [isDirty, setIsDirty]             = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [focusMode, setFocusMode]         = useState(false);
  const [presentMode, setPresentMode]     = useState(false);

  // Theme state: active theme id + per-session overrides
  const [allThemes, setAllThemes]         = useState<Theme[]>(BUILT_IN_THEMES);
  const [activeThemeId, setActiveThemeId] = useState<string>(DEFAULT_THEME.id);
  const [themeOverrides, setThemeOverrides] = useState<Partial<Theme>>({});

  // Resolved theme = base theme merged with overrides
  const activeTheme = useMemo<Theme>(() => {
    const base = allThemes.find((t) => t.id === activeThemeId) ?? DEFAULT_THEME;
    return { ...base, ...themeOverrides,
      colors: { ...base.colors, ...(themeOverrides.colors ?? {}) },
      fonts:  { ...base.fonts,  ...(themeOverrides.fonts  ?? {}) },
      header: { ...base.header, ...(themeOverrides.header ?? {}) },
      footer: { ...base.footer, ...(themeOverrides.footer ?? {}) },
    };
  }, [allThemes, activeThemeId, themeOverrides]);

  // Panel refs for Focus Mode collapse
  const thumbPanelRef     = usePanelRef();
  const inspectorPanelRef = usePanelRef();

  const { slides, frontmatter } = useMemo(() => {
    if (!content.trim()) return { slides: EMPTY_SLIDES, frontmatter: EMPTY_FM };
    try { return parseDocument(content); }
    catch { return { slides: EMPTY_SLIDES, frontmatter: EMPTY_FM }; }
  }, [content]);

  const aspectRatio = useMemo(
    () => parseAspectRatio(frontmatter.aspect_ratio as string | undefined),
    [frontmatter.aspect_ratio],
  );

  const wordCount = countWords(content);
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  // Load custom themes from ~/.deckmd/themes/ on startup
  useEffect(() => {
    invoke<Array<[string, string]>>('load_custom_themes')
      .then((entries) => {
        const custom = entries
          .map(([id, yaml]) => parseThemeYaml(id, yaml))
          .filter((t): t is Theme => t !== null);
        if (custom.length > 0) setAllThemes([...BUILT_IN_THEMES, ...custom]);
      })
      .catch(() => {}); // silently ignore if dir doesn't exist
  }, []);

  // Window title
  useEffect(() => {
    const name = frontmatter.title ?? filePath?.split('/').pop() ?? 'DeckMD';
    getCurrentWindow().setTitle(isDirty ? `${name} • — DeckMD` : `${name} — DeckMD`).catch(() => {});
  }, [filePath, frontmatter.title, isDirty]);

  // File-changed event from Rust watcher → reload
  useEffect(() => {
    const unlisten = listen<void>('file-changed', async () => {
      const path = filePathRef.current;
      if (!path) return;
      try {
        const newContent: string = await invoke('read_file', { path });
        setContent(newContent);
        setIsDirty(false);
      } catch (err) {
        console.error('Failed to reload file:', err);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Clamp slide index
  useEffect(() => {
    if (slides.length > 0 && currentSlideIndex >= slides.length) {
      setCurrentSlideIndex(slides.length - 1);
    }
  }, [slides.length, currentSlideIndex]);

  // Focus Mode: collapse/expand side panels
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      if (next) {
        thumbPanelRef.current?.collapse();
        inspectorPanelRef.current?.collapse();
      } else {
        thumbPanelRef.current?.expand();
        inspectorPanelRef.current?.expand();
      }
      return next;
    });
  }, [thumbPanelRef, inspectorPanelRef]);

  const handleNewFile = useCallback(async () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return;
    await invoke('stop_watching').catch(() => {});
    setFilePath(null);
    setContent(makeStarter());
    setIsDirty(false);
    setCurrentSlideIndex(0);
  }, [isDirty]);

  const handlePresentEnter = useCallback(async (e?: React.MouseEvent) => {
    if (slides.length === 0) return;
    if (!e?.altKey) setCurrentSlideIndex(0);
    setPresentMode(true);
    await getCurrentWindow().setFullscreen(true).catch(() => {});
  }, [slides.length]);

  const handlePresentExit = useCallback(async () => {
    setPresentMode(false);
    await getCurrentWindow().setFullscreen(false).catch(() => {});
  }, []);

  const handleThemeSelect = useCallback((id: string) => {
    setActiveThemeId(id);
    setThemeOverrides({}); // clear overrides when switching base theme
  }, []);

  const handleThemeChange = useCallback((patch: Partial<Theme>) => {
    setThemeOverrides((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      const text: string = await invoke('read_file', { path: selected });
      setFilePath(selected);
      setContent(text);
      setIsDirty(false);
      setCurrentSlideIndex(0);
      await invoke('start_watching', { path: selected }).catch(console.error);
    } catch (err) { console.error('Open failed:', err); }
  }, []);

  const handleSave = useCallback(async () => {
    if (!filePath) return;
    try {
      await invoke('write_file', { path: filePath, content });
      setIsDirty(false);
    } catch (err) { console.error('Save failed:', err); }
  }, [filePath, content]);

  const handleSaveAs = useCallback(async () => {
    try {
      const target = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: filePath ?? undefined,
      });
      if (!target) return;
      await invoke('write_file', { path: target, content });
      setFilePath(target);
      setIsDirty(false);
      await invoke('start_watching', { path: target }).catch(console.error);
    } catch (err) { console.error('Save As failed:', err); }
  }, [filePath, content]);

  const handleExport = useCallback(async () => {
    if (slides.length === 0) return;
    try {
      const { base64, warnings } = await exportToPptx(slides, frontmatter, activeTheme);
      const defaultPath = filePath
        ? filePath.replace(/\.(md|markdown)$/i, '.pptx')
        : 'presentation.pptx';
      const target = await save({
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
        defaultPath,
      });
      if (!target) return;
      await invoke('write_file_bytes', { path: target, data: base64 });
      if (warnings.length > 0) {
        window.alert(`Export complete with ${warnings.length} warning(s):\n\n${warnings.join('\n')}`);
      }
    } catch (err) { console.error('Export failed:', err); }
  }, [slides, frontmatter, activeTheme, filePath]);

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    setIsDirty(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (presentMode) return; // PresentationOverlay handles keys while presenting
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'n') { e.preventDefault(); handleNewFile(); }
      if (mod && e.key === 'o') { e.preventDefault(); handleOpenFile(); }
      if (mod && !e.shiftKey && e.key === 's') { e.preventDefault(); handleSave(); }
      if (mod && e.shiftKey && e.key === 's') { e.preventDefault(); handleSaveAs(); }
      if (mod && e.shiftKey && e.key === 'F') { e.preventDefault(); toggleFocusMode(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [presentMode, handleNewFile, handleOpenFile, handleSave, handleSaveAs, toggleFocusMode]);

  return (
    <div className="app">
      {presentMode && (
        <PresentationOverlay
          slides={slides}
          currentIndex={currentSlideIndex}
          theme={activeTheme}
          docTitle={frontmatter.title}
          aspectRatio={aspectRatio}
          onNavigate={setCurrentSlideIndex}
          onExit={handlePresentExit}
        />
      )}
      <div className="app-toolbar">
        <span className="toolbar-title">DeckMD</span>
        <button className="btn" onClick={handleNewFile} title="New (Ctrl+N)">New</button>
        <button className="btn" onClick={handleOpenFile} title="Open (Ctrl+O)">Open</button>
        <button className="btn" onClick={handleSave} disabled={!filePath || !isDirty} title="Save (Ctrl+S)">Save</button>
        <button className="btn" onClick={handleSaveAs} disabled={!content} title="Save As (Ctrl+Shift+S)">Save As</button>
        <span className={`toolbar-filename${isDirty ? ' dirty' : ''}`}>
          {filePath ? filePath.split('/').pop() : ''}
        </span>
        <div className="toolbar-spacer" />
        <button
          className={`btn${focusMode ? ' btn-primary' : ''}`}
          onClick={toggleFocusMode}
          title="Focus Mode (Ctrl+Shift+F)"
        >
          Focus
        </button>
        <button
          className="btn btn-primary"
          onClick={handlePresentEnter}
          disabled={slides.length === 0}
          title="Present from slide 1 (Alt+click to start from current slide)"
        >▶ Present</button>
      </div>

      <div className="app-panels">
        <PanelGroup orientation="horizontal" style={{ height: '100%' }}>
          <Panel panelRef={thumbPanelRef} defaultSize={14} minSize={8} collapsible>
            <ThumbnailPanel
              slides={slides}
              currentIndex={currentSlideIndex}
              onSelect={setCurrentSlideIndex}
              theme={activeTheme}
              docTitle={frontmatter.title}
              aspectRatio={aspectRatio}
            />
          </Panel>

          <PanelResizeHandle />

          <Panel defaultSize={42} minSize={20}>
            <EditorPanel
              content={content}
              onChange={handleContentChange}
              onCursorSlide={setCurrentSlideIndex}
              focusMode={focusMode}
            />
          </Panel>

          <PanelResizeHandle />

          <Panel defaultSize={30} minSize={15}>
            <PreviewPanel
              slides={slides}
              currentIndex={currentSlideIndex}
              theme={activeTheme}
              docTitle={frontmatter.title}
              aspectRatio={aspectRatio}
            />
          </Panel>

          <PanelResizeHandle />

          <Panel panelRef={inspectorPanelRef} defaultSize={14} minSize={8} collapsible>
            <InspectorPanel
              filePath={filePath}
              slideCount={slides.length}
              frontmatter={frontmatter}
              theme={activeTheme}
              allThemes={allThemes}
              onThemeSelect={handleThemeSelect}
              onThemeChange={handleThemeChange}
              onExport={handleExport}
            />
          </Panel>
        </PanelGroup>
      </div>

      <StatusBar
        currentSlide={currentSlideIndex + 1}
        totalSlides={slides.length}
        wordCount={wordCount}
        isDirty={isDirty}
        filePath={filePath}
      />
    </div>
  );
}
