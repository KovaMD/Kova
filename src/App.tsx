import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';

import { ThumbnailPanel } from './components/layout/ThumbnailPanel';
import { EditorPanel } from './components/layout/EditorPanel';
import type { EditorHandle, FormatCmd } from './components/layout/EditorPanel';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { StatusBar } from './components/layout/StatusBar';
import { PresentationOverlay } from './components/presentation/PresentationOverlay';
import { PresenterOverlay } from './components/presentation/PresenterOverlay';
import { SettingsModal } from './components/SettingsModal';
import { ThemeLibraryModal } from './components/inspector/ThemeLibraryModal';
import { ImportPptxModal } from './components/ImportPptxModal';
import { ImportUrlModal } from './components/ImportUrlModal';
import { FileMenu } from './components/app/FileMenu';
import { EditMenu } from './components/app/EditMenu';
import { WindowControls } from './components/app/WindowControls';
import { Toolbar } from './components/app/Toolbar';
import { FindReplaceDialog } from './components/app/FindReplaceDialog';
import { AppDialogs } from './components/app/AppDialogs';
import { basename, dirname } from './engine/paths';
import { loadSettings, saveSettings, EDITOR_FONT_OPTIONS } from './store/settings';
import type { AppSettings } from './store/settings';
import { getCombo, isMac } from './engine/keybindings';
import { I18nProvider, useLocaleTranslator } from './i18n';
import { resolveDeckMeta } from './engine/render/slideModel';

import { parseDocument } from './engine/parser/markdownToSlides';
import { extractFrontmatter } from './engine/parser/frontmatter';
import type { Slide, Frontmatter } from './engine/types';
import { parseAspectRatio } from './engine/types';
import { getSlideStepCount } from './engine/layout/steps';
import { useResolvedSlides } from './hooks/useResolvedSlides';
import { useFindReplace } from './hooks/useFindReplace';
import { useOffscreenCapture } from './hooks/useOffscreenCapture';
import { useExports } from './hooks/useExports';
import { useThemeState } from './hooks/useThemeState';
import { useSlideEditing } from './hooks/useSlideEditing';
import { useDocument, useLastSessionRecord, type DocumentThemePort } from './hooks/useDocument';
import { usePresentationSession } from './hooks/usePresentationSession';
import { useFrontmatterEditing } from './hooks/useFrontmatterEditing';
import { useWindowLifecycle } from './hooks/useWindowLifecycle';
import { useAudienceBridge } from './hooks/useAudienceBridge';
import { useAppMenu, installCli } from './hooks/useAppMenu';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useStartupChecks } from './hooks/useStartupChecks';
import { useUiAppearance } from './hooks/useUiAppearance';
import { useExternalImageCount } from './hooks/useExternalImageCount';
import { usePanelLayout } from './hooks/usePanelLayout';
import { bestEffort } from './platform/bestEffort';
import { useColdStartState, useLocalMediaGate, useColdLoad, useColdExport } from './hooks/useColdStart';
import { getPendingCli } from './cli/coldStart';
import { OffscreenDeck } from './components/OffscreenDeck';
import { DeckProvider, useDeckContextValue } from './components/preview/DeckContext';

import './styles/global.css';

function countWords(text: string): number {
  return (text.match(/\b\w+\b/g) ?? []).length;
}

const EMPTY_SLIDES: Slide[] = [];
const EMPTY_FM: Frontmatter = {};

export default function App() {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  // Index into visibleSlides (hidden slides skipped) while presenting — kept
  // separate from currentSlideIndex (which indexes the full editor deck).
  const [presentIndex, setPresentIndex]   = useState(0);
  // Build-reveal step index for the *current* presented slide (see
  // usePresentationNav / engine/layout/steps.ts) — always reset to 0 whenever
  // presentIndex changes to a different slide.
  const [presentStep, setPresentStep]     = useState(0);
  // Single handler for both overlays' onNavigate — usePresentationNav always
  // supplies both index and step explicitly, never one without the other.
  const handlePresentNavigate = useCallback((index: number, step: number) => {
    setPresentIndex(index);
    setPresentStep(step);
  }, []);
  // CLI cold-start session flags (kova --present / --export).
  const coldStart = useColdStartState();
  const { coldPresent, coldExport } = coldStart;
  const [settings, setSettings]           = useState<AppSettings>(loadSettings);
  const t = useLocaleTranslator(settings.locale);
  const [showSettings, setShowSettings]   = useState(false);
  const [settingsScrollToUpdates, setSettingsScrollToUpdates] = useState(false);
  const [showThemeLibrary, setShowThemeLibrary] = useState(false);
  const [showImport, setShowImport]       = useState(false);
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [warnMessage, setWarnMessage]     = useState<string | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pdfOptionsOpen, setPdfOptionsOpen] = useState(false);
  const [pdfPerPage, setPdfPerPage]         = useState(1);
  const [pdfNotesOn, setPdfNotesOn]         = useState(false);
  const {
    context: offscreenContext,
    capturing,
    runCapture: runOffscreenCapture,
    onSlideReady: onOffscreenSlideReady,
    setSlideRef: setOffscreenSlideRef,
  } = useOffscreenCapture();
  const editorRef         = useRef<EditorHandle>(null);

  // The document lifecycle drives theme state that is itself derived from the
  // document (useThemeState below reads the content's frontmatter), so the
  // theme operations reach useDocument through this stable port, which
  // forwards to the latest useThemeState result. Only ever called from
  // handlers and effects, by which time the ref is populated.
  const themeApiRef = useRef<DocumentThemePort | null>(null);
  const documentThemePort = useMemo<DocumentThemePort>(() => ({
    syncThemeFromContent: (text) => themeApiRef.current?.syncThemeFromContent(text),
    isCliThemeActive: () => themeApiRef.current?.isCliThemeActive() ?? false,
    setActiveThemeId: (id) => themeApiRef.current?.setActiveThemeId(id),
    setMissingThemeId: (id) => themeApiRef.current?.setMissingThemeId(id),
  }), []);

  const {
    filePath,
    content,
    setContent,
    contentRef,
    isDirty,
    setIsDirty,
    importDir,
    guardDirty,
    applyFileContent,
    handleContentChange,
    handleNewFile,
    handleOpenFile,
    handleSave,
    handleSaveAs,
    handleMarkdownDrop,
    openImported,
    handleImportMarp,
    recents,
    ...doc
  } = useDocument({
    settings,
    theme: documentThemePort,
    setCurrentSlideIndex,
    editorRef,
    coldPresent,
    getPendingCli,
    setWarnMessage,
  });

  // A single parse of the raw frontmatter block, shared below instead of
  // each derived value re-running extractFrontmatter's YAML parse on its own
  // — this is on the hot path (every keystroke re-renders App with a new
  // `content`).
  const parsedFrontmatter = useMemo(() => extractFrontmatter(content), [content]);

  const {
    allThemes,
    setActiveThemeId,
    missingThemeId,
    setMissingThemeId,
    installedRemoteIds,
    themeOverrides,
    baseTheme,
    activeTheme,
    reloadCustomThemes,
    handleMissingThemeInstalled,
    syncThemeFromContent,
    cliThemeRef,
    applyCliTheme,
  } = useThemeState({
    rawThemeOverrides: parsedFrontmatter.frontmatter.theme_overrides,
    onWarn: setWarnMessage,
  });
  themeApiRef.current = {
    syncThemeFromContent,
    isCliThemeActive: () => !!cliThemeRef.current,
    setActiveThemeId,
    setMissingThemeId,
  };

  // Persisted panel layout and Focus Mode (collapses the side panels).
  const { focusMode, toggleFocusMode, defaultLayout, onLayoutChanged, thumbPanelRef, inspectorPanelRef } =
    usePanelLayout(showInspector);

  const handleFormat = useCallback((cmd: FormatCmd) => {
    editorRef.current?.runFormat(cmd);
  }, []);

  const handleThumbnailSelect = useCallback((index: number) => {
    setCurrentSlideIndex(index);
    editorRef.current?.scrollToSlide(index);
  }, []);

  const { slides: rawSlides, frontmatter } = useMemo(() => {
    if (!content.trim()) return { slides: EMPTY_SLIDES, frontmatter: EMPTY_FM };
    try { return parseDocument(content); }
    catch { return { slides: EMPTY_SLIDES, frontmatter: EMPTY_FM }; }
  }, [content]);

  // Body-only view for the editor — frontmatter is managed by the inspector.
  const editorBody = parsedFrontmatter.body;

  const editorContent = settings.showFrontmatter ? content : editorBody;

  const docDir = useMemo(
    () => (filePath ? dirname(filePath, importDir) : importDir),
    [filePath, importDir],
  );

  const slides = useResolvedSlides(rawSlides, docDir);

  // Compute a safe index in the same render as slides so children never receive
  // an out-of-bounds value during the frame before the clamp useEffect fires.
  const safeSlideIndex = slides.length > 0
    ? Math.min(currentSlideIndex, slides.length - 1)
    : 0;

  // Deck used for presentation + export — hidden slides removed. Reference-equal
  // to entries in `slides`, so index translation uses indexOf/indexOf.
  const visibleSlides = useMemo(() => slides.filter((s) => !s.hidden), [slides]);

  // Bounded wait for local media before a CLI cold export (useColdExport).
  const mediaGate = useLocalMediaGate(visibleSlides);
  const safePresentIndex = visibleSlides.length > 0
    ? Math.min(presentIndex, visibleSlides.length - 1)
    : 0;
  // Defensive clamp mirrors safePresentIndex — a slide's step count can only
  // shrink out from under presentStep via a hot-reloaded/edited-while-cold-
  // presenting deck, but the overlays should never receive an out-of-range value.
  const safePresentStep = visibleSlides[safePresentIndex]
    ? Math.min(presentStep, getSlideStepCount(visibleSlides[safePresentIndex]))
    : 0;

  // {title}/{author}/{date} for header/footer templates, resolved exactly as
  // the PPTX export does (resolveDeckMeta): {title} falls back to the cover
  // slide's H1 when frontmatter has none (issue #55), {date} to today.
  const { title: docTitle, author: docAuthor, date: docDate } = resolveDeckMeta(frontmatter, rawSlides, settings.locale);

  const aspectRatio = useMemo(
    () => parseAspectRatio(frontmatter.aspect_ratio as string | undefined),
    [frontmatter.aspect_ratio],
  );
  // Deck-wide render inputs for every SlideRenderer host (DeckContext).
  const deck = useDeckContextValue(activeTheme, docTitle, docAuthor, docDate, aspectRatio);

  const wordCount = useMemo(() => countWords(editorBody), [editorBody]);

  // Images outside the document's folder (break if the .md moves alone).
  const externalImageCount = useExternalImageCount(content, filePath);
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  const { keybindings, availableUpdate, setAvailableUpdate, showWhatsNew, dismissWhatsNew } = useStartupChecks({
    checkForUpdates: settings.checkForUpdates,
    notifyWhatsNew: settings.notifyWhatsNew,
  });

  // Window title — used by the taskbar/switcher/Mission Control. On macOS the
  // title text is hidden at the NSWindow level (see lib.rs setup) so it doesn't
  // duplicate the in-app centered doctitle next to the traffic lights.
  useEffect(() => {
    const name = frontmatter.title ?? (filePath != null ? basename(filePath) : undefined) ?? 'Kova';
    void bestEffort(getCurrentWindow().setTitle(isDirty ? `${name} • — Kova` : `${name} — Kova`), 'setTitle');
  }, [filePath, frontmatter.title, isDirty]);

  // Clamp slide index
  useEffect(() => {
    if (slides.length > 0 && currentSlideIndex >= slides.length) {
      setCurrentSlideIndex(slides.length - 1);
    }
  }, [slides.length, currentSlideIndex]);

  // Declared above usePresentationSession so its stable-identity useCallback
  // can be passed in without a temporal-dead-zone reference.
  const handleWarn = useCallback((msg: string) => {
    setWarnMessage(msg);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setWarnMessage(null), 6000);
  }, []);

  const { presentMode, presenterMode, handlePresentEnter, handlePresentExit } = usePresentationSession({
    slides,
    visibleSlides,
    safeSlideIndex,
    safePresentIndex,
    setCurrentSlideIndex,
    setPresentIndex,
    setPresentStep,
    activeTheme,
    aspectRatio,
    docTitle,
    docAuthor,
    docDate,
    settings,
    coldPresent,
    filePath,
    onWarn: handleWarn,
    t,
  });

  const { quitApp } = useWindowLifecycle({ guardDirty });

  useAudienceBridge({ presentMode, presenterMode, safePresentIndex, safePresentStep, setPresentIndex, setPresentStep });

  const { handleThemeSelect, handleThemeChange, handleMetaChange, handleAspectRatioCycle } =
    useFrontmatterEditing({ setContent, setIsDirty, setActiveThemeId });

  // Cold-start load (kova --present / --check / --import / --export); the
  // auto-enter for --present lives in usePresentationSession.
  useColdLoad({ cold: coldStart, applyFileContent, applyCliTheme });

  // Keep the last-session record current so it's accurate whenever the app
  // actually quits (see useLastSessionRecord).
  useLastSessionRecord(filePath, safeSlideIndex, coldPresent);

  const handleImportComplete = useCallback(async (markdown: string, savedPath: string) => {
    setShowImport(false);
    await openImported(markdown, savedPath);
  }, [openImported]);

  const handleImportFromUrl = useCallback(async (text: string) => {
    setShowImportUrl(false);
    await openImported(text, '');
  }, [openImported]);

  const {
    exportPptx: handleExport,
    exportPdf: handleExportPdf,
    exportHtml: handleExportHtml,
    print: handlePrint,
    copyWithAssets: handleCopyWithAssets,
    runPdfExportCapture,
    runHtmlExportCapture,
  } = useExports({
    visibleSlides,
    frontmatter,
    activeTheme,
    aspectRatio,
    locale: settings.locale,
    filePath,
    contentRef,
    t,
    offscreen: { capturing, runCapture: runOffscreenCapture },
  });

  // Cold-start export (kova --export pptx|pdf|html FILE OUT): fires once the
  // deck loaded by useColdLoad has resolved.
  useColdExport({
    coldExport,
    filePath,
    mediaGate,
    visibleSlides,
    frontmatter,
    activeTheme,
    locale: settings.locale,
    pdfPageSize: settings.pdfPageSize,
    runPdfExportCapture,
    runHtmlExportCapture,
  });

  const {
    handleSlideReorder,
    handleDuplicateSlide,
    handleNewSlide,
    handleDeleteSlide,
    handleDeleteMultiple,
    handleReorderMultiple,
    handleToggleHidden,
    handleToggleTodo,
    handleSetSlideBackground,
    handleClearSlideBackground,
  } = useSlideEditing({
    setContent,
    setIsDirty,
    setCurrentSlideIndex,
    editorRef,
    slideCount: slides.length,
    filePath,
    onWarn: handleWarn,
    t,
  });

  const findReplace = useFindReplace({ editorRef, slideCount: slides.length, onSelectSlide: setCurrentSlideIndex });

  const handleSettingsChange = useCallback((s: AppSettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const resolvedUiTheme = useUiAppearance(settings);

  // Export menu items are enabled when there is something to export and no PDF
  // export is already running (Print additionally waits for a running print).
  const canExport = slides.length > 0 && capturing !== 'export';

  // ── Menu actions (native macOS menu bar + in-window FileMenu) ──────────────
  const menuActions = useAppMenu({
    newFile: handleNewFile,
    openFile: handleOpenFile,
    openRecent: handleMarkdownDrop,
    clearRecent: doc.clearRecents,
    save: handleSave,
    saveAs: () => { void handleSaveAs(); },
    copyWithAssets: () => { void handleCopyWithAssets(); },
    import: () => guardDirty(() => setShowImport(true)),
    importUrl: () => guardDirty(() => setShowImportUrl(true)),
    importMarp: handleImportMarp,
    export: handleExport,
    exportPdf: () => { setPdfPerPage(1); setPdfNotesOn(false); setPdfOptionsOpen(true); },
    exportHtml: handleExportHtml,
    print: handlePrint,
    exit: () => guardDirty(quitApp),
    present: () => { void handlePresentEnter(); },
    toggleInspector: () => setShowInspector((v) => !v),
    openSettings: () => setShowSettings(true),
    installCli: () => { void installCli(t); },
  }, recents, t);

  useGlobalShortcuts(keybindings.combos, presentMode || presenterMode, {
    newFile: handleNewFile,
    openFile: handleOpenFile,
    save: () => { if (filePath) handleSave(); else void handleSaveAs(); },
    saveAs: () => { void handleSaveAs(); },
    toggleFocusMode,
    toggleHiddenCurrent: slides.length > 0 ? () => handleToggleHidden(safeSlideIndex) : undefined,
    present: (fromCurrent) => { void handlePresentEnter(fromCurrent); },
  });

  const presentationOverlays = (
    <>
      {presentMode && (
        <PresentationOverlay
          slides={visibleSlides}
          currentIndex={safePresentIndex}
          currentStep={safePresentStep}
          laserColor={settings.laserColor}
          showTimer={settings.presenterShowTimer}
          countdownMinutes={settings.presenterCountdownMinutes}
          showProgressBar={settings.presentationShowProgressBar}
          onNavigate={handlePresentNavigate}
          onExit={handlePresentExit}
        />
      )}
      {presenterMode && (
        <PresenterOverlay
          slides={visibleSlides}
          currentIndex={safePresentIndex}
          currentStep={safePresentStep}
          showNextSlide={settings.presenterShowNextSlide}
          showTimer={settings.presenterShowTimer}
          countdownMinutes={settings.presenterCountdownMinutes}
          notesFontSize={settings.presenterNotesFontSize}
          laserColor={settings.laserColor}
          onNavigate={handlePresentNavigate}
          onExit={handlePresentExit}
        />
      )}
    </>
  );

  // Cold-start present (kova --present FILE): the editor chrome never mounts.
  // Before presentation starts this renders a minimal loading surface (only
  // visible for the instant between the window being shown and the overlay
  // mounting); during presentation it renders just the overlays, so nothing
  // editor-shaped can flash behind them or during exit.
  if (coldPresent) {
    return (
      <I18nProvider locale={settings.locale}>
        <DeckProvider value={deck}>
        <div className="app">
          {presentationOverlays}
          {!presentMode && !presenterMode && (
            <div style={{
              height: '100vh',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ opacity: 0.6, fontSize: 14 }}>{t('app.presentLoading')}</span>
            </div>
          )}
        </div>
        </DeckProvider>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider locale={settings.locale}>
    <DeckProvider value={deck}>
    <div className="app">
      {doc.fileDragOver && !presentMode && !presenterMode && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 5000, pointerEvents: 'none',
          border: '2px dashed #D94F00', borderRadius: 4,
          background: 'rgba(217,79,0,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#D94F00', fontSize: 14, fontWeight: 500 }}>{t('app.dropToOpen')}</span>
        </div>
      )}
      {presentationOverlays}
      <Toolbar
        menus={!isMac && (
          <>
            <FileMenu
              actions={menuActions}
              recents={recents}
              filePath={filePath}
              isDirty={isDirty}
              hasContent={!!content}
              canExport={canExport}
              pdfExporting={capturing === 'export'}
              printing={capturing === 'print'}
              combos={keybindings.combos}
            />
            <EditMenu editorRef={editorRef} onFind={findReplace.openDialog} />
          </>
        )}
        windowControls={!isMac && <WindowControls onClose={menuActions.exit} />}
        filePath={filePath}
        isDirty={isDirty}
        isRenaming={doc.isRenaming}
        renameValue={doc.renameValue}
        onRenameStart={doc.startRename}
        onRenameChange={doc.setRenameValue}
        onRenameCommit={doc.handleRenameCommit}
        onRenameCancel={doc.cancelRename}
        canPresent={slides.length > 0}
        onPresent={handlePresentEnter}
        focusMode={focusMode}
        focusModeCombo={getCombo(keybindings.combos, 'focusMode')}
        onToggleFocusMode={toggleFocusMode}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector((v) => !v)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="app-panels">
        <PanelGroup
          orientation="horizontal"
          style={{ height: '100%' }}
          id="kova-main"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel id="thumb" panelRef={thumbPanelRef} defaultSize={22} minSize={8} collapsible>
            <ThumbnailPanel
              slides={slides}
              currentIndex={safeSlideIndex}
              onSelect={handleThumbnailSelect}
              onReorder={handleSlideReorder}
              onDuplicate={handleDuplicateSlide}
              onNewSlide={handleNewSlide}
              onToggleHidden={handleToggleHidden}
              onToggleTodo={handleToggleTodo}
              onSetBackground={handleSetSlideBackground}
              onClearBackground={handleClearSlideBackground}
              onDelete={handleDeleteSlide}
              onDeleteMultiple={handleDeleteMultiple}
              onReorderMultiple={handleReorderMultiple}
            />
          </Panel>

          <PanelResizeHandle />

          <Panel id="editor" defaultSize={64} minSize={20}>
            <EditorPanel
              ref={editorRef}
              content={editorContent}
              onChange={handleContentChange}
              onCursorSlide={setCurrentSlideIndex}
              onWarn={handleWarn}
              onSaveAs={handleSaveAs}
              onRequestFind={findReplace.openDialog}
              focusMode={focusMode}
              filePath={filePath}
              uiTheme={resolvedUiTheme}
              editorFontFamily={EDITOR_FONT_OPTIONS.find(o => o.value === settings.editorFont)?.family}
              wordWrap={settings.editorWordWrap}
              contentWidth={settings.editorContentWidth}
              spellCheckEnabled={settings.spellCheckEnabled}
              spellCheckLanguage={settings.spellCheckLanguage}
            />
          </Panel>

          {showInspector && <PanelResizeHandle />}

          {showInspector && (
            <Panel id="inspector" panelRef={inspectorPanelRef} defaultSize={14} minSize={8} collapsible>
              <InspectorPanel
                filePath={filePath}
                slideCount={slides.length}
                frontmatter={frontmatter}
                theme={activeTheme}
                baseTheme={baseTheme}
                themeOverrides={themeOverrides}
                allThemes={allThemes}
                onThemeSelect={handleThemeSelect}
                onThemeChange={handleThemeChange}
                onMetaChange={handleMetaChange}
                onFormat={handleFormat}
                onOpenLibrary={() => setShowThemeLibrary(true)}
              />
            </Panel>
          )}
        </PanelGroup>
      </div>

      <StatusBar
        currentSlide={safeSlideIndex + 1}
        totalSlides={slides.length}
        layoutName={slides[safeSlideIndex]?.layout}
        layoutOverridden={slides[safeSlideIndex]?.layoutOverride !== undefined}
        wordCount={wordCount}
        isDirty={isDirty}
        filePath={filePath}
        externalImageCount={externalImageCount}
        aspectRatioLabel={`${aspectRatio.w}:${aspectRatio.h}`}
        onAspectRatioCycle={handleAspectRatioCycle}
        availableUpdate={availableUpdate}
        onVersionClick={availableUpdate ? () => { setShowSettings(true); setSettingsScrollToUpdates(true); } : undefined}
        locale={settings.locale}
      />

      <FindReplaceDialog findReplace={findReplace} />

      {showSettings && (
        <SettingsModal
          settings={settings}
          availableUpdate={availableUpdate}
          allThemes={allThemes}
          isDirty={isDirty}
          scrollToUpdates={settingsScrollToUpdates}
          onChange={handleSettingsChange}
          onUpdateChecked={setAvailableUpdate}
          onClose={() => { setShowSettings(false); setSettingsScrollToUpdates(false); }}
        />
      )}

      {showThemeLibrary && (
        <ThemeLibraryModal
          installedIds={installedRemoteIds}
          onThemesChanged={reloadCustomThemes}
          onClose={() => setShowThemeLibrary(false)}
        />
      )}

      {showImport && (
        <ImportPptxModal
          onImported={handleImportComplete}
          onClose={() => setShowImport(false)}
        />
      )}

      {showImportUrl && (
        <ImportUrlModal
          onImported={handleImportFromUrl}
          onClose={() => setShowImportUrl(false)}
        />
      )}

      <AppDialogs
        marpPromptOpen={doc.marpPromptOpen}
        onMarpConvert={doc.convertMarp}
        onMarpDismiss={doc.dismissMarpPrompt}
        marpLoss={doc.marpLoss}
        onMarpLossDismiss={doc.dismissMarpLoss}
        missingThemeId={missingThemeId}
        onMissingThemeInstalled={handleMissingThemeInstalled}
        onMissingThemeDismiss={() => setMissingThemeId(null)}
        showWhatsNew={showWhatsNew}
        onWhatsNewOpen={() => {
          // /releases/latest always redirects to the newest published release —
          // more robust than building a /releases/tag/vX.Y.Z URL from APP_VERSION,
          // which would 404 if the two ever drift (e.g. a local dev build).
          void bestEffort(openUrl('https://github.com/KovaMD/Kova/releases/latest'), 'openUrl');
          dismissWhatsNew();
        }}
        onWhatsNewDismiss={dismissWhatsNew}
        warnMessage={warnMessage}
        externalChangeOpen={doc.externalChangeOpen}
        onExternalChangeClose={doc.closeExternalChange}
        onExternalChangeReload={doc.reloadExternalChange}
        onExternalChangeSaveAs={doc.saveAsExternalChange}
        externalReloadBannerOpen={doc.externalReloadBannerOpen}
        onExternalReloadBannerDismiss={doc.dismissExternalReloadBanner}
        pdfOptionsOpen={pdfOptionsOpen}
        pdfPerPage={pdfPerPage}
        pdfNotesOn={pdfNotesOn}
        pdfHasNotes={pdfOptionsOpen && visibleSlides.some((s) => s.speakerNotes.trim())}
        onPdfPerPageChange={(n) => { setPdfPerPage(n); if (n !== 1) setPdfNotesOn(false); }}
        onPdfNotesChange={setPdfNotesOn}
        onPdfOptionsClose={() => setPdfOptionsOpen(false)}
        onPdfExport={() => {
          setPdfOptionsOpen(false);
          const notes = pdfPerPage === 1 && pdfNotesOn ? visibleSlides.map((s) => s.speakerNotes) : undefined;
          void handleExportPdf({ perPage: pdfPerPage, notes, paper: settings.pdfPageSize });
        }}
        confirmCloseOpen={doc.confirmCloseOpen}
        onConfirmCloseCancel={doc.cancelConfirmClose}
        onConfirmCloseDiscard={doc.discardAndContinue}
        onConfirmCloseSave={doc.saveAndContinue}
        dropConfirmPath={doc.dropConfirmPath}
        onDropConfirmCancel={doc.cancelDropConfirm}
        onDropConfirmOpen={doc.confirmDropOpen}
      />

      {/* Off-screen slide rendering for PDF/HTML export and Print */}
      {offscreenContext && (
        <OffscreenDeck
          slides={offscreenContext.slides}
          setSlideRef={setOffscreenSlideRef}
          onSlideReady={onOffscreenSlideReady}
        />
      )}
    </div>
    </DeckProvider>
    </I18nProvider>
  );
}
