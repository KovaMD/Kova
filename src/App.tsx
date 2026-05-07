import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from 'react-resizable-panels';

import { ThumbnailPanel } from './components/layout/ThumbnailPanel';
import { EditorPanel } from './components/layout/EditorPanel';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { StatusBar } from './components/layout/StatusBar';
import { PresentationOverlay } from './components/presentation/PresentationOverlay';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings, saveSettings } from './store/settings';
import type { AppSettings } from './store/settings';
import { loadKeybindings, matchShortcut, getCombo, formatCombo } from './engine/keybindings';
import type { Keybindings } from './engine/keybindings';

import yaml from 'js-yaml';
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
  const [settings, setSettings]           = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings]   = useState(false);
  const [confirmCloseAction, setConfirmCloseAction] = useState<(() => void) | null>(null);
  const [keybindings, setKeybindings]     = useState<Keybindings>({ path: '', combos: {} });

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

  // Compute a safe index in the same render as slides so children never receive
  // an out-of-bounds value during the frame before the clamp useEffect fires.
  const safeSlideIndex = slides.length > 0
    ? Math.min(currentSlideIndex, slides.length - 1)
    : 0;

  const aspectRatio = useMemo(
    () => parseAspectRatio(frontmatter.aspect_ratio as string | undefined),
    [frontmatter.aspect_ratio],
  );

  const wordCount = countWords(content);
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  // Load custom themes from ~/.kova/themes/ on startup
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

  // Load keybindings from ~/.kova/keybindings.yaml on startup
  useEffect(() => {
    loadKeybindings().then(setKeybindings).catch(() => {});
  }, []);

  // Window title
  useEffect(() => {
    const name = frontmatter.title ?? filePath?.split('/').pop() ?? 'Kova';
    getCurrentWindow().setTitle(isDirty ? `${name} • — Kova` : `${name} — Kova`).catch(() => {});
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

  const guardDirty = useCallback((action: () => void) => {
    if (isDirty && settings.confirmOnClose) {
      setConfirmCloseAction(() => action);
    } else {
      action();
    }
  }, [isDirty, settings.confirmOnClose]);

  const handleNewFile = useCallback(() => {
    guardDirty(async () => {
      await invoke('stop_watching').catch(() => {});
      setFilePath(null);
      setContent(makeStarter());
      setIsDirty(false);
      setCurrentSlideIndex(0);
    });
  }, [guardDirty]);

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

  const handleOpenFile = useCallback(() => {
    guardDirty(async () => { try {
      const selected = await open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      const text: string = await invoke('read_file', { path: selected });
      // Apply theme declared in frontmatter, if any
      const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      if (fmMatch) {
        try {
          const fm = yaml.load(fmMatch[1]) as Record<string, unknown>;
          if (typeof fm?.theme === 'string') {
            const found = allThemes.find((t) => t.id === fm.theme);
            if (found) { setActiveThemeId(found.id); setThemeOverrides({}); }
          }
        } catch { /* ignore bad yaml */ }
      }
      setFilePath(selected);
      setContent(text);
      setIsDirty(false);
      setCurrentSlideIndex(0);
      await invoke('start_watching', { path: selected }).catch(console.error);
    } catch (err) { console.error('Open failed:', err); }});
  }, [guardDirty, allThemes]);

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

  const handleSettingsChange = useCallback((s: AppSettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  // Autosave — only when enabled, a file path exists, and there are unsaved changes
  useEffect(() => {
    if (!settings.autosave || !filePath || !isDirty) return;
    const id = setInterval(handleSave, settings.autosaveIntervalSeconds * 1000);
    return () => clearInterval(id);
  }, [settings.autosave, settings.autosaveIntervalSeconds, filePath, isDirty, handleSave]);

  useEffect(() => {
    const sc = (id: string) => getCombo(keybindings.combos, id);
    const handler = (e: KeyboardEvent) => {
      if (presentMode) return;
      if (matchShortcut(e, sc('newFile')))   { e.preventDefault(); handleNewFile(); }
      if (matchShortcut(e, sc('openFile')))  { e.preventDefault(); handleOpenFile(); }
      if (matchShortcut(e, sc('save')))      { e.preventDefault(); handleSave(); }
      if (matchShortcut(e, sc('saveAs')))    { e.preventDefault(); handleSaveAs(); }
      if (matchShortcut(e, sc('focusMode'))) { e.preventDefault(); toggleFocusMode(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [presentMode, keybindings.combos, handleNewFile, handleOpenFile, handleSave, handleSaveAs, toggleFocusMode]);

  return (
    <div className="app">
      {presentMode && (
        <PresentationOverlay
          slides={slides}
          currentIndex={safeSlideIndex}
          theme={activeTheme}
          docTitle={frontmatter.title}
          aspectRatio={aspectRatio}
          onNavigate={setCurrentSlideIndex}
          onExit={handlePresentExit}
        />
      )}
      <div className="app-toolbar">
        <button className="btn" onClick={handleNewFile} title={`New (${formatCombo(getCombo(keybindings.combos, 'newFile'))})`}>New</button>
        <button className="btn" onClick={handleOpenFile} title={`Open (${formatCombo(getCombo(keybindings.combos, 'openFile'))})`}>Open</button>
        <button className="btn" onClick={handleSave} disabled={!filePath || !isDirty} title={`Save (${formatCombo(getCombo(keybindings.combos, 'save'))})`}>Save</button>
        <button className="btn" onClick={handleSaveAs} disabled={!content} title={`Save As (${formatCombo(getCombo(keybindings.combos, 'saveAs'))})`}>Save As</button>
        <div className="toolbar-spacer" data-tauri-drag-region />
        <div className="toolbar-doctitle" data-tauri-drag-region>
          {filePath ? filePath.split('/').pop() : 'Untitled.md'}{isDirty ? ' *' : ''}
        </div>
        <button
          className={`btn${focusMode ? ' btn-primary' : ''}`}
          onClick={toggleFocusMode}
          title={`Focus Mode (${formatCombo(getCombo(keybindings.combos, 'focusMode'))})`}
        >
          Focus
        </button>
        <button
          className="btn btn-primary"
          onClick={handlePresentEnter}
          disabled={slides.length === 0}
          title="Present from slide 1 (Alt+click to start from current slide)"
        >▶ Present</button>
        <button
          className="wm-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
          style={{ marginLeft: 4 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <div className="wm-controls">
          <button
            className="wm-btn"
            onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().minimize(); }}
            title="Minimise"
          >
            <svg width="12" height="2" viewBox="0 0 12 2"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
          </button>
          <button
            className="wm-btn"
            onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().toggleMaximize(); }}
            title="Maximise / Restore"
          >
            <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
          <button
            className="wm-btn wm-btn--close"
            onMouseDown={(e) => {
              e.preventDefault();
              guardDirty(() => getCurrentWindow().close());
            }}
            title="Close"
          >
            <svg width="11" height="11" viewBox="0 0 11 11">
              <line x1="1" y1="1" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="10" y1="1" x2="1" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="app-panels">
        <PanelGroup orientation="horizontal" style={{ height: '100%' }}>
          <Panel panelRef={thumbPanelRef} defaultSize={14} minSize={8} collapsible>
            <ThumbnailPanel
              slides={slides}
              currentIndex={safeSlideIndex}
              onSelect={setCurrentSlideIndex}
              theme={activeTheme}
              docTitle={frontmatter.title}
              aspectRatio={aspectRatio}
            />
          </Panel>

          <PanelResizeHandle />

          <Panel defaultSize={72} minSize={20}>
            <EditorPanel
              content={content}
              onChange={handleContentChange}
              onCursorSlide={setCurrentSlideIndex}
              focusMode={focusMode}
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
        currentSlide={safeSlideIndex + 1}
        totalSlides={slides.length}
        wordCount={wordCount}
        isDirty={isDirty}
        filePath={filePath}
      />

      {showSettings && (
        <SettingsModal
          settings={settings}
          keybindingsPath={keybindings.path}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {confirmCloseAction && (
        <>
          <div
            onClick={() => setConfirmCloseAction(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#242424', border: '1px solid #333', borderRadius: 8,
            boxShadow: '0 16px 48px rgba(0,0,0,0.6)', zIndex: 2001,
            padding: '24px 28px', width: 320, maxWidth: '90vw',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8', marginBottom: 8 }}>
              Unsaved changes
            </div>
            <div style={{ fontSize: 13, color: '#999', marginBottom: 20, lineHeight: 1.5 }}>
              You have unsaved changes. Close anyway?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmCloseAction(null)}>Cancel</button>
              <button
                className="btn"
                style={{ background: '#c0392b', borderColor: '#c0392b', color: '#fff' }}
                onClick={() => { const a = confirmCloseAction; setConfirmCloseAction(null); a(); }}
              >Close anyway</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
