import type { DeepPartial } from '../types';
import type { Messages } from '../en';

const de: DeepPartial<Messages> = {
  common: {
    cancel: 'Abbrechen', // Cancel
    save: 'Speichern', // Save
    saveAs: 'Speichern unter…', // Save As…
    close: 'Schließen', // Close
    back: 'Zurück', // Back
    dismiss: 'Verwerfen', // Dismiss
    ok: 'OK', // OK
    open: 'Öffnen', // Open
    discard: 'Verwerfen', // Discard
    reload: 'Neu laden', // Reload
    retry: 'Erneut versuchen', // Retry
    install: 'Installieren', // Install
    installing: 'Wird installiert…', // Installing…
    remove: 'Entfernen', // Remove
    removing: 'Wird entfernt…', // Removing…
    hide: 'Ausblenden', // Hide
    show: 'Anzeigen', // Show
  },
  presentation: {
    previousSlide: 'Zurück (←)', // Previous (←)
    nextSlide: 'Weiter (→ / Leertaste)', // Next (→ / Space)
    jumpToSlide: 'Klicken, um zur Folie zu springen', // Click to jump to slide
    elapsedTime: 'Verstrichene Zeit', // Elapsed time
    toggleSpeakerNotes: 'Referentenansicht umschalten (N)', // Toggle speaker notes (N)
    toggleNotesShort: 'Notizen umschalten (N)', // Toggle notes (N)
    toggleLaser: 'Laserpointer umschalten (L)', // Toggle laser pointer (L)
    notesButton: 'Notizen', // Notes
    laserButton: 'Laser', // Laser
    exitPresentation: 'Präsentation beenden (Esc)', // Exit presentation (Esc)
    exitButtonEsc: '✕ ESC', // ✕ ESC
    exitButtonWord: '✕ Beenden', // ✕ Exit
    speakerNotes: 'Referentennotizen', // Speaker notes
    noNotesForSlide: 'Keine Notizen für diese Folie', // No notes for this slide
    audienceBlank: 'Der Publikumsbildschirm ist leer', // Audience screen is blank
    next: 'Weiter', // Next
    endOfPresentation: 'Ende der Präsentation', // End of presentation
    slideAnnounce: 'Folie {{current}} von {{total}}', // Slide {{current}} of {{total}}
  },
  inspector: {
    inspectorTitle: 'Inspektor', // Inspector
    collapseAllSections: 'Alle Abschnitte einklappen', // Collapse all sections
    expandAllSections: 'Alle Abschnitte ausklappen', // Expand all sections
    sectionFormat: 'Format', // Format
    sectionTheme: 'Design', // Theme
    sectionColours: 'Farben', // Colours
    sectionFonts: 'Schriftarten', // Fonts
    sectionDocument: 'Dokument', // Document
    fileLabel: 'Datei', // File
    slidesLabel: 'Folien', // Slides
    titleLabel: 'Titel', // Title
    authorLabel: 'Autor', // Author
    dateLabel: 'Datum', // Date
    titlePlaceholder: 'Ohne Titel', // Untitled
    authorPlaceholder: 'Autor', // Author
    datePlaceholder: 'Datum', // Date
    moreThemesButton: 'Weitere Designs…', // More Themes…
    colorPrimary: 'Primärfarbe', // Primary
    colorAccent: 'Akzent', // Accent
    colorBackground: 'Hintergrund', // Background
    colorText: 'Text', // Text
    colorTitleText: 'Titeltext', // Title text
    colorSectionBg: 'Abschnittshintergrund', // Section bg
    colorCodeBg: 'Code-Hintergrund', // Code bg
    diagramPalette: 'Diagrammpalette', // Diagram palette
    chartColorLabel: 'Diagramm {{n}}', // Chart {{n}}
    resetToThemeDefaults: 'Auf Design-Standard zurücksetzen', // Reset to theme defaults
    headingsLabel: 'Überschriften', // Headings
    inlineLabel: 'Inline', // Inline
    blockLabel: 'Block', // Block
    headingTitle: 'Überschrift {{level}}', // Heading {{level}}
    bold: 'Fett (Strg+B)', // Bold (Ctrl+B)
    italic: 'Kursiv (Strg+I)', // Italic (Ctrl+I)
    underline: 'Unterstrichen', // Underline
    strikethrough: 'Durchgestrichen', // Strikethrough
    inlineCode: 'Inline-Code', // Inline code
    bulletList: 'Aufzählungsliste', // Bullet list
    numberedList: 'Nummerierte Liste', // Numbered list
    blockquote: 'Blockzitat', // Blockquote
    horizontalRule: 'Horizontale Linie', // Horizontal rule
    logoLabel: 'Logo', // Logo
    logoChange: 'Ändern', // Change
    logoChoose: 'Auswählen…', // Choose…
    positionTopLeft: 'Oben links', // Top left
    positionTopRight: 'Oben rechts', // Top right
    positionBottomLeft: 'Unten links', // Bottom left
    positionBottomRight: 'Unten rechts', // Bottom right
    opacityLabel: 'Deckkraft', // Opacity
    showHeader: 'Kopfzeile anzeigen', // Show header
    headerPlaceholder: 'Kopfzeilentext ({title}, {date})', // Header text ({title}, {date})
    showFooter: 'Fußzeile anzeigen', // Show footer
    footerPlaceholder: 'Fußzeilentext ({title}, {date})', // Footer text ({title}, {date})
    slideNumberLabel: 'Foliennummer', // Slide number
    tocSectionLabel: 'Inhaltsverzeichnis', // Table of contents
    tocNumberedLabel: 'Nummeriertes Verzeichnis', // Numbered list
    fontFieldTitle: 'Titel', // Title
    fontFieldBody: 'Fließtext', // Body
    fontFieldCode: 'Code', // Code
    fontUnavailableWarning: '"{{font}}" ist auf diesem Computer nicht installiert. Kova verwendet hier ersatzweise eine andere Schriftart — und dieselbe Ersetzung kann auf einem anderen Betriebssystem anders (oder gar nicht) ausfallen, sodass diese Präsentation an anderer Stelle abweichend aussehen kann.', // "{{font}}" isn't installed on this computer. Kova is falling back to a substitute font here — and the same substitution may happen differently (or not at all) on another OS, so this deck may look different when opened elsewhere.
    themeLibraryTitle: 'Weitere Designs', // More Themes
    themeLibraryLoading: 'Wird geladen…', // Loading…
    themeLibraryError: 'themes.kova.md konnte nicht erreicht werden', // Could not reach themes.kova.md
    themeLibraryEmpty: 'Noch keine Designs verfügbar.', // No themes available yet.
    themeLibraryFrom: 'Von', // From
    themeLibraryFooter: 'Installierte Designs werden sofort zur Designauswahl hinzugefügt', // Installed themes are added to the Theme picker immediately
  },
  layout: {
    slidesPanelHeader: 'Folien', // Slides
    openFileHint: 'Öffne eine Markdown-Datei, um Folien anzuzeigen', // Open a Markdown file to see slides
    slideOptionsAriaLabel: 'Folienoptionen', // Slide options
    moveUp: 'Nach oben verschieben', // Move up
    moveDown: 'Nach unten verschieben', // Move down
    newSlide: 'Neue Folie', // New slide
    duplicateSlide: 'Folie duplizieren', // Duplicate slide
    showSlide: 'Folie anzeigen', // Show slide
    hideSlide: 'Folie ausblenden', // Hide slide
    setSlideBackground: 'Hintergrundbild für Folie setzen …', // Set slide background…
    clearSlideBackground: 'Hintergrundbild entfernen', // Clear background
    deleteSlide: 'Folie löschen', // Delete slide
    showSlideTitle: 'Folie in Präsentation/Export anzeigen', // Show slide in presentation/export
    hideSlideTitle: 'Folie in Präsentation/Export ausblenden', // Hide slide from presentation/export
    editorPanelHeader: 'Editor', // Editor
    slideCountStatus: 'Folie {{current}} von {{total}}', // Slide {{current}} of {{total}}
    noSlides: 'Keine Folien', // No slides
    estimatedMinutes: {
      zero: 'Geschätzt {{count}} Minuten', // Est. {{count}} min
      one: 'Geschätzt {{count}} Minute', // Est. {{count}} min
      other: 'Geschätzt {{count}} Minuten', // Est. {{count}} mins
    },
    wordCount: '{{formatted}} Wörter', // {{formatted}} words
    aspectRatioTooltip: 'Seitenverhältnis: {{current}} — klicken für {{next}}', // Aspect ratio: {{current}} — click for {{next}}
    externalImageWarning: {
      one: '{{count}} Bild liegt außerhalb des Ordners dieser Datei — es wird nicht angezeigt, wenn die Datei verschoben wird', // {{count}} image is outside this file's folder — it won't appear if the file is moved
      other: '{{count}} Bilder liegen außerhalb des Ordners dieser Datei — sie werden nicht angezeigt, wenn die Datei verschoben wird', // {{count}} images are outside this file's folder — they won't appear if the file is moved
    },
    externalImageBadge: {
      one: '⚠ {{count}} externes Bild', // ⚠ {{count}} external image
      other: '⚠ {{count}} externe Bilder', // ⚠ {{count}} external images
    },
    unsaved: 'Nicht gespeichert', // Unsaved
    newUnsaved: 'Neu — nicht gespeichert', // New — unsaved
    saved: 'Gespeichert', // Saved
    updateAvailableTooltip: 'Update {{version}} verfügbar — zum Aktualisieren klicken', // Update {{version}} available — click to update
    kovaVersion: 'kova v{{version}}', // kova v{{version}}
  },
  editor: {
    contextMenuAriaLabel: 'Kontextmenü', // Context menu
    findDialogTitle: 'Suchen', // Find
    findModeText: 'Text', // Text
    findModeSlide: 'Folie #', // Slide #
    findPlaceholderText: 'Suche im Dokument …', // Find in document…
    findPlaceholderSlide: 'Springe zur Folie (1–{{total}})…', // Go to slide (1–{{total}})…
    findNext: 'Nächste', // Next
    findPrevious: 'Vorherige', // Previous
    newPresentationHint: '{{mod}}+N — neue Präsentation', // {{mod}}+N — new presentation
    openFileHint: '{{mod}}+O — Datei öffnen', // {{mod}}+O — open file
    tocHint: 'Rechtsklick → Einfügen → Inhaltsverzeichnis', // Right-click → Insert → Table of Contents
    dropImageHint: 'Bild zum Einfügen ablegen', // Drop image to insert
    saveFirstDropMedia: 'Bitte speichere dein Dokument, bevor du Medien ablegst.', // Save your document first before dropping media.
    saveFirstPasteMedia: 'Bitte speichere dein Dokument, bevor du Medien einfügst.', // Save your document first before pasting media.
    couldNotCopyMedia: 'Medien konnten nicht kopiert werden — gewähre Kova unter macOS Zugriff über Systemeinstellungen → Datenschutz & Sicherheit → Dateien und Ordner.', // Could not copy media — on macOS, grant Kova access under System Settings → Privacy & Security → Files and Folders.
    couldNotPasteMedia: 'Medien konnten nicht eingefügt werden.', // Could not paste media.
    saveDocumentFirstTitle: 'Zuerst Dokument speichern', // Save document first
    saveDocumentFirstMessage: 'Dein Dokument muss vor dem Einfügen von Medien gespeichert werden, damit Kova weiß, wo sie abgelegt werden sollen.', // Your document needs to be saved before inserting media, so Kova knows where to place it.
    menuCopy: 'Kopieren', // Copy
    menuCut: 'Ausschneiden', // Cut
    menuPaste: 'Einfügen', // Paste
    menuFormat: 'Formatieren', // Format
    menuBold: 'Fett', // Bold
    menuItalic: 'Kursiv', // Italic
    menuUnderline: 'Unterstrichen', // Underline
    menuStrikethrough: 'Durchgestrichen', // Strikethrough
    menuInlineCode: 'Inline-Code', // Inline Code
    menuIndent: 'Einrücken - Einzug vergrößern', // Indent
    menuDedent: 'Ausrücken - Einzug verkleinern', // Dedent
    menuInsert: 'Einfügen', // Insert
    menuCodeBlock: 'Code-Block', // Code Block
    menuBlockquote: 'Blockzitat', // Blockquote
    menuTable: 'Tabelle', // Table
    menuHorizontalRule: 'Horizontale Linie', // Horizontal Rule
    menuImageOrVideo: 'Bild oder Video…', // Image or Video…
    menuLink: 'Link', // Link
    menuMathBlock: 'Mathematik-/LaTeX-Block', // Math/LaTeX Block
    menuSpeakerNotes: 'Referentennotizen', // Speaker Notes
    menuReference: 'Referenz', // Reference
    menuTableOfContents: 'Inhaltsverzeichnis', // Table of Contents
    menuCharts: 'Diagramme', // Charts
    menuPieChart: 'Kuchendiagramm', // Pie Chart
    menuBarChart: 'Balkendiagramm', // Bar Chart
    menuLineChart: 'Liniendiagramm', // Line Chart
    menuDiagrams: 'Diagramme', // Diagrams
    menuProgressBars: 'Fortschrittsbalken', // Progress Bars
    menuFlowchart: 'Flussdiagramm', // Flowchart
    menuTimeline: 'Zeitleiste', // Timeline
    menuSequenceDiagram: 'Sequenzdiagramm', // Sequence Diagram
    menuNoSuggestions: 'Keine Vorschläge', // No suggestions
    menuAddToDictionary: 'Zum Kova-Wörterbuch hinzufügen', // Add to Kova's dictionary
    menuIgnore: 'Ignorieren', // Ignore
    insertTableTitle: 'Tabelle einfügen', // Insert Table
    insertTableColumns: 'Spalten', // Columns
    insertTableRows: 'Zeilen', // Rows
    insertTableAction: 'Einfügen', // Insert
  },
  preview: {
    youtubePlaceholder: '▶ YouTube', // ▶ YouTube
    clickToOpenInBrowser: 'Klicken, um im Browser zu öffnen', // Click to open in browser
    openInBrowserTitle: 'Im Browser öffnen: {{url}}', // Open in browser: {{url}}
    rescaledToFit: 'Größe angepasst', // rescaled to fit
    noTitledSlidesFound: 'Keine Folien mit Titel gefunden', // No titled slides found
    pollQrUnavailable: 'QR Code ist nicht verfügbar', // QR code unavailable
  },
  modals: {
    importPptxTitle: 'Aus PowerPoint importieren', // Import from PowerPoint
    importPptxDescription: 'Konvertiere eine .pptx-Datei in eine Kova-Präsentation. Das Layout wird nur angenähert — einige Folien müssen möglicherweise manuell angepasst werden.', // Convert a .pptx file to a Kova presentation. Layout will be approximated — you may need to adjust some slides manually.
    importPptxFileLabel: 'PowerPoint-Datei', // PowerPoint file
    importPptxNoFileSelected: 'Keine Datei ausgewählt', // No file selected
    importPptxBrowse: 'Durchsuchen…', // Browse…
    importPptxWillImport: 'Was importiert wird', // What will be imported
    importPptxWontImport: 'Was nicht importiert wird', // What will not be imported
    importPptxWill1: 'Folieninhalt und -reihenfolge', // Slide content and order
    importPptxWill2: 'Text — Titel, Fließtext, Aufzählungslisten', // Text — titles, body, bullet lists
    importPptxWill3: 'Bilder (extrahiert und lokal gespeichert)', // Images (extracted and saved locally)
    importPptxWill4: 'Tabellen', // Tables
    importPptxWill5: 'Referentennotizen', // Speaker notes
    importPptxWont1: 'Designs, Farben und Schriftarten — nach dem Import ein Kova-Design anwenden', // Themes, colours, and fonts — apply a Kova theme after import
    importPptxWont2: 'Animationen und Übergänge', // Animations and transitions
    importPptxWont3: 'SmartArt-Diagramme', // SmartArt diagrams
    importPptxWont4: 'Diagramme und Grafiken', // Charts and graphs
    importPptxWont5: 'Folienhintergründe und dekorative Formen', // Slide backgrounds and decorative shapes
    importPptxContinue: 'Weiter', // Continue
    importPptxImporting: 'Wird importiert …', // Importing…
    importPptxReadingFile: 'Datei wird gelesen …', // Reading file…
    importPptxParsingSlides: 'Folien werden analysiert …', // Parsing slides…
    importPptxGeneratingMarkdown: 'Markdown wird erzeugt …', // Generating markdown…
    importPptxSavingFile: 'Datei wird gespeichert …', // Saving file…
    importPptxPasswordProtected: 'Diese Datei ist passwortgeschützt und kann nicht importiert werden.', // This file is password-protected and cannot be imported.
    importPptxComplete: 'Import abgeschlossen', // Import complete
    importPptxSlidesImported: {
      one: '{{count}} Folie importiert', // {{count}} slide imported
      other: '{{count}} Folien importiert', // {{count}} slides imported
    },
    importPptxItemsSkipped: {
      one: '{{count}} Element übersprungen', // {{count}} item skipped
      other: '{{count}} Elemente übersprungen', // {{count}} items skipped
    },
    importPptxSavedToLabel: 'Gespeichert unter:', // Saved to:
    importPptxOpenInEditor: 'Im Editor öffnen', // Open in Editor
    importPptxFailed: 'Import fehlgeschlagen', // Import failed
    importUrlTitle: 'Aus URL importieren', // Import from URL
    importUrlDescription: 'Füge einen Link zu einer Markdown-Datei ein. GitHub-, GitLab- und Bitbucket-Links werden automatisch in Raw-Format umgewandelt.', // Paste a link to a Markdown file. GitHub, GitLab, and Bitbucket links are converted to raw automatically.
    importUrlPlaceholder: 'https://github.com/user/repo/blob/main/file.md', // https://github.com/user/repo/blob/main/file.md
    importUrlFetchingRaw: 'Raw-Inhalt wird abgerufen: {{url}}', // Fetching raw: {{url}}
    importUrlFetching: 'Wird abgerufen …', // Fetching…
    importUrlImport: 'Importieren', // Import
    settingsTitle: 'Einstellungen', // Settings
    missingThemeIntegrityError: 'Dem Design fehlt der Integritäts-Hash als Prüfsumme', // Theme is missing its integrity hash
    missingThemeDownloadFailed: 'Download fehlgeschlagen', // Download failed
    missingThemeIntegrityFailed: 'Integritätsprüfung fehlgeschlagen', // Integrity check failed
    missingThemeInstallFailed: 'Installation fehlgeschlagen', // Install failed
    missingThemeCheckingPrefix: 'Design wird gesucht', // Checking for theme
    missingThemeCheckingSuffix: '…', // …
    missingThemeUsesThemePrefix: 'Diese Datei verwendet das Design', // This file uses theme
    missingThemeNotInstalledSuffix: 'das nicht installiert ist', // which isn't installed
    missingThemeNotInLibrarySuffix: 'das nicht in der Design-Bibliothek enthalten ist.', // which isn't in the Theme Library.
  },
  app: {
    connecting: 'Verbindung wird hergestellt …', // Connecting…
    dropToOpen: 'Hierher ziehen zum Öffnen', // Drop to open
    presentLoading: 'Bereite Präsentation vor …', // Preparing presentation…
    cliInstallSuccess: "'kova' wurde installiert in {{dir}}. Frisch geöffnete Kommandofenster können kova nun aufrufen.", // The 'kova' command was installed to {{dir}}. Newly opened terminals can now run kova.
    cliInstallFailure: "Konnte 'kova' nicht automatisch installieren. Starte dies als Ersatz in einem Terminal-Fenster:\n\n{{command}}", // Couldn't install the 'kova' command automatically. Run this in a terminal instead:\n\n{{command}}
    menuFile: 'Datei', // File
    menuEdit: 'Bearbeiten', // Edit
    menuNew: 'Neu', // New
    menuOpen: 'Öffnen', // Open
    menuOpenRecent: 'Zuletzt geöffnet', // Open Recent
    menuNoRecentFiles: 'Bisher keine Dateien verwendet', // No Recent Files
    menuClearMenu: 'Menü leeren', // Clear Menu
    menuImport: 'Importieren', // Import
    menuImportFromPowerPoint: 'Aus PowerPoint …', // From PowerPoint…
    menuImportFromUrl: 'Aus URL …', // From URL…
    menuImportFromMarp: 'Aus Marp …', // From Marp…
    menuSave: 'Speichern', // Save
    menuSaveAs: 'Speichern unter …', // Save As…
    menuCopyWithAssets: 'Mit Ressourcen kopieren …', // Copy with Assets…
    menuExport: 'Exportieren', // Export
    menuExportPowerpoint: 'PowerPoint (.pptx)', // PowerPoint (.pptx)
    menuExportPdf: 'PDF (.pdf)', // PDF (.pdf)
    menuExportingPdf: 'PDF wird exportiert …', // Exporting PDF…
    menuExportHtml: 'HTML (.html)', // HTML (.html)
    menuExporting: 'Wird exportiert …', // Exporting…
    menuPrint: 'Drucken …', // Print…
    menuPreparingPrint: 'Druck wird vorbereitet …', // Preparing Print…
    menuExit: 'Beenden', // Exit
    menuUndo: 'Rückgängig', // Undo
    menuRedo: 'Wiederholen', // Redo
    menuCut: 'Ausschneiden', // Cut
    menuCopy: 'Kopieren', // Copy
    menuPaste: 'Einfügen', // Paste
    menuSelectAll: 'Alles auswählen', // Select All
    untitledFilename: 'unbenannt.md', // Untitled.md
    presentButton: '▶ Präsentieren', // ▶ Present
    presentButtonTitle: 'Ab Folie 1 präsentieren (F5) — Shift-F5 oder Alt+Klick, um ab der aktuellen Folie zu starten', // Present from slide 1 (F5) — Shift-F5 or Alt+click to start from current slide
    enterFocusMode: 'Fokusmodus aktivieren ({{combo}})', // Enter focus mode ({{combo}})
    exitFocusMode: 'Fokusmodus verlassen ({{combo}})', // Exit focus mode ({{combo}})
    toggleInspector: 'Inspektor ein-/ausblenden', // Toggle inspector
    settingsButtonTitle: 'Einstellungen', // Settings
    minimise: 'Minimieren', // Minimise
    maximiseRestore: 'Maximieren / Wiederherstellen', // Maximise / Restore
    windowClose: 'Schließen', // Close
    exportCompleteWithWarnings: {
      one: 'Export abgeschlossen mit {{count}} Warnung:\n\n{{warnings}}', // Export complete with {{count}} warning:\n\n{{warnings}}
      other: 'Export abgeschlossen mit {{count}} Warnungen:\n\n{{warnings}}', // Export complete with {{count}} warnings:\n\n{{warnings}}
    },
    pptxExportFailed: 'PPTX-Export fehlgeschlagen: {{error}}', // PPTX export failed: {{error}}
    pdfExportFallback: 'Der einfache PDF-Renderer wurde verwendet (nativer Export nicht verfügbar); Handout-, N-up- und Papieroptionen wurden nicht angewendet.', // Used the basic PDF renderer (native export unavailable); handout/N-up/paper options were not applied.
    pdfExportFallbackReason: 'Ursache: {{error}}', // Reason: {{error}}
    pdfExportFailed: 'PDF-Export fehlgeschlagen:\n{{error}}', // PDF export failed:\n{{error}}
    htmlExportFailed: 'HTML-Export fehlgeschlagen:\n{{error}}', // HTML export failed:\n{{error}}
    printCompleteWithWarnings: {
      one: 'Druck abgeschlossen mit {{count}} Warnung:\n\n{{warnings}}', // Print complete with {{count}} warning:\n\n{{warnings}}
      other: 'Druck abgeschlossen mit {{count}} Warnungen:\n\n{{warnings}}', // Print complete with {{count}} warnings:\n\n{{warnings}}
    },
    marpDetected: 'Dies sieht aus wie ein Marp-Foliensatz.', // This looks like a Marp deck.
    marpConvert: 'In Kova-Format umwandeln', // Convert to Kova
    marpImported: {
      one: 'Importiert. {{count}} Marp-Funktion wurde vereinfacht.', // Imported. {{count}} Marp feature simplified.
      other: 'Importiert. {{count}} Marp-Funktionen wurden vereinfacht.', // Imported. {{count}} Marp features simplified.
    },
    fileChangedExternally: 'Datei wurde extern geändert', // File changed externally
    fileChangedExternallyDirty: 'Eine andere Anwendung hat diese Datei geändert. Lade neu, um die neueste Version zu erhalten, oder speichere deine aktuellen Änderungen unter einem neuen Namen.', // Another application modified this file. Reload to get the latest version, or save your current edits under a new name.
    fileChangedExternallyClean: 'Eine andere Anwendung hat diese Datei geändert. Die neueste Version wurde geladen.', // Another application modified this file. The latest version has been loaded.
    exportPdfTitle: 'PDF exportieren', // Export PDF
    slidesPerPage: 'Folien pro Seite', // Slides per page
    includeSpeakerNotes: 'Referenten-Notizen einschließen (Handout){{noneNote}}', // Include speaker notes (handout){{noneNote}}
    includeSpeakerNotesNone: ' — keine in diesem Foliensatz', //  — none in this deck
    exportAction: 'Exportieren', // Export
    unsavedChangesTitle: 'Nicht gespeicherte Änderungen', // Unsaved changes
    unsavedChangesMessage: 'Du hast ungespeicherte Änderungen. Möchtest du erst speichern?', // You have unsaved changes. Save before continuing?
    openFileTitle: 'Datei öffnen', // Open file
    openFileReplaceWarningPrefix: 'Das Öffnen von', // Opening
    openFileReplaceWarningSuffix: 'ersetzt das aktuelle Dokument.', // will replace the current document.
    filterMarpMarkdown: 'Marp Markdown', // Marp Markdown
    filterMarkdown: 'Markdown', // Markdown
    filterPowerpoint: 'PowerPoint', // PowerPoint
    filterPdf: 'PDF', // PDF
    filterHtml: 'HTML', // HTML
  },
  macMenu: {
    present: 'Präsentieren', // Present
    view: 'Ansicht', // View
    toggleInspector: 'Inspektor ein-/ausblenden', // Toggle Inspector
    installCli: "Installiere 'kova' im Suchpfad PATH", // Install 'kova' Command in PATH
  },
  settings: {
    windowTitle: 'Einstellungen', // Settings
    sectionAppearance: 'Erscheinungsbild', // Appearance
    appTheme: 'App-Design', // App theme
    themeAuto: 'Automatisch', // Auto
    themeDark: 'Dunkel', // Dark
    themeLight: 'Hell', // Light
    themeAutoDescription: 'Folgt der Erscheinungsbild-Einstellung deines Betriebssystems.', // Follows your operating system's appearance setting.
    displayLanguage: 'Anzeigesprache', // Display language
    languageAuto: 'Systemstandard', // System default
    interfaceScale: 'Skalierung der Oberfläche', // Interface scale
    editorFont: 'Editor-Schriftart', // Editor font
    showFrontmatter: 'YAML-Vorspann (Frontmatter) im Editor anzeigen', // Show frontmatter YAML in editor
    showFrontmatterDescription: 'Zeigt den YAML-Vorspann (Frontmatter-Block) oben im Editor an, sodass er direkt neben den Folien bearbeitet werden kann.', // Displays the YAML frontmatter block at the top of the editor so it can be edited directly alongside the slides.
    wordWrap: 'Zeilenumbruch', // Word wrap
    wordWrapDescription: 'Bricht lange Zeilen im Editor um. Wenn deaktiviert, erscheint für Zeilen, die breiter als das Panel sind, ein horizontaler Bildlaufbalken.', // Wrap long lines in the editor. When off, a horizontal scrollbar appears for lines wider than the panel.
    contentWidth: 'Breite des Inhalts', // Content width
    contentWidthDescription: 'Fixiert hält die Zeilen bei einer ansprechenden Breite. Voll streckt den Editierbereich während du den Trenner verschiebst.', // Fixed keeps editor lines at a comfortable reading width. Full stretches the editor to fill the panel as you resize the split.
    contentWidthFixed: 'Fixiert', // Fixed
    contentWidthFull: 'Voll', // Full
    defaultTheme: 'Standard-Präsentations-Design', // Default presentation theme
    defaultThemeDescription: 'Wird beim Erstellen einer neuen Präsentation angewendet.', // Applied when creating a new presentation.
    sectionLanguageSpelling: 'Sprache & Rechtschreibung', // Language & Spelling
    checkSpelling: 'Rechtschreibung während der Eingabe prüfen', // Check spelling while typing
    checkSpellingDescription: 'Unterstreicht falsch geschriebene Wörter rot. Das Wörterbuch wird bei der ersten Verwendung geladen.', // Underlines misspelled words in red. Dictionary is loaded on first use.
    dictionaryLanguage: 'Wörterbuch-Sprache', // Dictionary language
    learnedWords: 'Gelernte Wörter ({{count}})', // Learned words ({{count}})
    learnedWordsManage: 'Verwalten', // Manage
    learnedWordsNone: 'Noch keine', // None yet
    removeFromDictionary: 'Aus Wörterbuch entfernen', // Remove from dictionary
    autosave: 'Automatisches Speichern', // Autosave
    autosaveDescription: 'Speichert deine Datei automatisch in regelmäßigen Abständen. Gilt erst nach dem ersten manuellen Speichern.', // Automatically save your file at regular intervals. Only applies after your first manual save.
    saveEvery: 'Speichern alle', // Save every
    sectionWorkspace: 'Arbeitsbereich', // Workspace
    confirmBeforeClosing: 'Vor dem Schließen bestätigen', // Confirm before closing
    confirmBeforeClosingDescription: 'Fragt beim Schließen einer Datei mit nicht gespeicherten Änderungen nach Bestätigung.', // Ask for confirmation when closing a file with unsaved changes.
    onStartup: 'Beim Start', // On startup
    onStartupDescription: 'Fenstergröße und -position werden immer wiederhergestellt. Dies steuert nur das Dokument.', // Window size and position are always restored. This controls the document.
    startupBlank: 'Leeres Dokument', // Blank document
    startupReopenLast: 'Zuletzt verwendete Datei erneut öffnen', // Reopen last file
    pdfPageSize: 'PDF-Seitengröße', // PDF page size
    pdfPageSizeDescription: 'Papierformat für den PDF-Export. Seiten werden im Querformat angeordnet.', // Paper size for PDF export. Pages are laid out landscape.
    pageSizeA4: 'A4', // A4
    pageSizeLetter: 'Letter', // Letter
    pageSizeSlide: 'Entsprechend der Folien-Größe', // Match slide size
    sectionPresentation: 'Präsentation', // Presentation
    displayMode: 'Anzeigemodus', // Display mode
    displayModeDescription: 'Erkennt zum Präsentationszeitpunkt automatisch angeschlossene Bildschirme — Referentenansicht mit zwei Bildschirmen, falls ein zweiter Bildschirm gefunden wird, sonst Einzelbildschirm. Spiegeln zeigt dieselbe Folie auf beiden Bildschirmen.', // Auto detects connected displays at presentation time — dual presenter view if a second screen is found, single screen otherwise. Mirror shows the same slide on both displays.
    displayModeAuto: 'Automatisch', // Auto
    displayModeSingle: 'Einzelbildschirm', // Single screen
    displayModeDual: 'Zwei Bildschirme', // Dual screen
    displayModeMirror: 'Spiegeln', // Mirror
    windowedPresenterView: 'Fensterdarstellung für Präsentierende', // Windowed presenter view
    windowedPresenterViewDescription: 'Behalte die Präsentations-Darstellung in einem normalen Fenster statt bildschirmfüllend, damit du die Größe verändern oder ein Fenster danebensetzen kannst.', // Keep the presenter view in a normal window instead of fullscreen, so you can resize it or place another window alongside it.
    laserPointerColour: 'Farbe des Laserpointers', // Laser pointer colour
    showNextSlidePreview: 'Vorschau der nächsten Folie anzeigen', // Show next slide preview
    showNextSlidePreviewDescription: 'Zeigt in der Referenten-Ansicht eine Vorschau der kommenden Folie an.', // Displays a preview of the upcoming slide in the presenter view.
    showElapsedTimer: 'Verstrichene Zeit anzeigen', // Show elapsed timer
    showElapsedTimerDescription: 'Zeigt ab dem Beginn der Präsentation eine laufende Uhr an.', // Displays a running clock from the moment the presentation starts.
    notesFontSize: 'Schriftgröße der Notizen', // Notes font size
    fontSizeSmall: 'Klein', // Small
    fontSizeMedium: 'Mittel', // Medium
    fontSizeLarge: 'Groß', // Large
    sectionUpdates: 'Updates', // Updates
    checkForUpdates: 'Beim Start nach Updates suchen', // Check for updates on launch
    checkForUpdatesDescription: 'Ruft beim Start das neueste Release-Tag von github.com/KovaMD/Kova ab. Es werden keine persönlichen Daten gesendet.', // Fetches the latest release tag from github.com/KovaMD/Kova on startup. No personal data is sent.
    updatesManagedByDistro: 'Updates für diese Installation werden von der Paketverwaltung deiner Distribution verwaltet.', // Updates for this installation are managed by your distribution's package manager.
    checkNow: 'Jetzt prüfen', // Check now
    checking: 'Wird geprüft…', // Checking…
    upToDate: 'Auf dem neuesten Stand (v{{version}})', // Up to date (v{{version}})
    updateCheckError: 'Update-Server konnte nicht erreicht werden', // Could not reach update server
    updateInstallError: 'Heruntergeladen, aber das Update ließ sich nicht verifizieren oder installieren', // Downloaded, but the update could not be verified or installed
    updateAvailable: '{{version}} verfügbar', // {{version}} available
    updateNow: 'Jetzt aktualisieren', // Update Now
    downloading: '{{version}} wird heruntergeladen{{pct}}', // Downloading {{version}}{{pct}}
    updateInstalled: '{{version}} installiert', // {{version}} installed
    restartNow: 'Jetzt neu starten', // Restart now
    restartConfirm: 'Du hast ungespeicherte Änderungen. Trotzdem neu starten?', // You have unsaved changes. Restart anyway?
    sectionAbout: 'Über', // About
    aboutLicense: 'Kostenlos und Open Source · GNU General Public License v3', // Free and open source · GNU General Public License v3
    aboutLinkGithub: 'GitHub', // GitHub
    aboutLinkGithubDescription: 'Quellcode und Versionen', // Source code and releases
    aboutLinkIssues: 'Melde ein Problem', // Report an issue
    aboutLinkIssuesDescription: 'Fehler gefunden oder Idee für Verbesserungen?', // Found a bug, or have a feature idea?
    aboutLinkWiki: 'Wiki', // Wiki
    aboutLinkWikiDescription: 'Anleitungen, Designs und Tastatur-Kürzel', // Guides, themes, and keyboard shortcuts
    aboutLinkSupport: 'Unterstützung durch ein Open Collective', // Support on Open Collective
    aboutLinkSupportDescription: 'Kova gibt es kostenlos durch Beiträge von Freiwilligen', // Kova is free and community funded
    aboutLinkCommunity: 'Chat in der Community', // Community chat
    aboutLinkCommunityDescription: 'Austausch mit anderen Benutzern über die Matrix Plattform', // Talk with other users on Matrix
    showLicenses: 'Lizenzen', // Licenses
    aboutLicensesDescription: 'Open Source Pakete, die Kova nutzt', // Open source packages used by Kova
  },
} as const;

export default de;
