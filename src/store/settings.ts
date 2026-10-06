import { detectOsLanguage } from '../engine/spellcheck/spellChecker';

export type PresentationMode  = 'auto' | 'single' | 'dual' | 'mirror';
export type NotesFontSize     = 'sm' | 'md' | 'lg';
export type StartupBehavior   = 'blank' | 'reopenLast';

export const LASER_COLOR_OPTIONS = [
  { value: '#ff2020', label: 'Red'    },
  { value: '#ff8800', label: 'Orange' },
  { value: '#22cc44', label: 'Green'  },
  { value: '#4488ff', label: 'Blue'   },
  { value: '#ffffff', label: 'White'  },
] as const;
export type LaserColor = typeof LASER_COLOR_OPTIONS[number]['value'];
export type UiTheme           = 'auto' | 'dark' | 'light';
export type EditorContentWidth = 'fixed' | 'full';
export type EditorFont        = 'ibm-plex-mono' | 'jetbrains-mono' | 'fira-code' | 'cascadia-code' | 'source-code-pro' | 'ubuntu-mono' | 'inconsolata' | 'system';
export type { SpellCheckLanguage } from '../engine/spellcheck/spellChecker';

export const EDITOR_FONT_OPTIONS: { value: EditorFont; label: string; family: string; bundled?: true }[] = [
  { value: 'ibm-plex-mono',  label: 'IBM Plex Mono',  family: "'IBM Plex Mono', monospace",  bundled: true },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', family: "'JetBrains Mono', monospace" },
  { value: 'fira-code',      label: 'Fira Code',       family: "'Fira Code', monospace"      },
  { value: 'cascadia-code',  label: 'Cascadia Code',   family: "'Cascadia Code', monospace"  },
  { value: 'source-code-pro',label: 'Source Code Pro', family: "'Source Code Pro', monospace"},
  { value: 'ubuntu-mono',    label: 'Ubuntu Mono',     family: "'Ubuntu Mono', monospace"    },
  { value: 'inconsolata',    label: 'Inconsolata',     family: "'Inconsolata', monospace"    },
  { value: 'system',         label: 'System default',  family: 'monospace'                   },
];

export interface AppSettings {
  settingsVersion: number;
  uiTheme: UiTheme;
  locale: string;
  uiScale: number;
  editorFont: EditorFont;
  autosave: boolean;
  autosaveIntervalSeconds: number; // 15 | 30 | 60 | 300
  confirmOnClose: boolean;
  checkForUpdates: boolean;
  notifyWhatsNew: boolean;
  // Spell check
  spellCheckEnabled: boolean;
  spellCheckLanguage: string;
  // Presentation
  presentationMode: PresentationMode;
  presenterWindowed: boolean;
  presenterAlwaysOnTop: boolean;
  presenterShowNextSlide: boolean;
  presenterShowTimer: boolean;
  /** Target talk length in minutes; 0 disables the countdown (elapsed-only, the
   *  existing behaviour). Reused every time you present, not asked per-talk. */
  presenterCountdownMinutes: number;
  presenterNotesFontSize: NotesFontSize;
  laserColor: LaserColor;
  /** Thin slide-position bar pinned to the bottom edge of the audience view. */
  presentationShowProgressBar: boolean;
  // Editor
  showFrontmatter: boolean;
  editorWordWrap: boolean;
  editorContentWidth: EditorContentWidth;
  // Presentation defaults
  defaultThemeId: string;
  // Export
  pdfPageSize: 'a4' | 'letter' | 'slide';
  // Startup
  startupBehavior: StartupBehavior;
}

const KEY = 'kova:settings';

function buildDefaults(): AppSettings {
  return {
    settingsVersion: 1,
    uiTheme: 'auto',
    locale: 'auto',
    uiScale: 1,
    editorFont: 'ibm-plex-mono',
    autosave: true,
    autosaveIntervalSeconds: 30,
    confirmOnClose: true,
    checkForUpdates: false,
    notifyWhatsNew: true,
    spellCheckEnabled: true,
    spellCheckLanguage: detectOsLanguage(),
    presentationMode: 'auto',
    // Preserves existing behaviour (presenter view goes fullscreen) for
    // anyone upgrading — only changes anything for users who opt in.
    presenterWindowed: false,
    presenterAlwaysOnTop: false,
    presenterShowNextSlide: true,
    presenterShowTimer: true,
    // Preserves existing behaviour (elapsed-only) for anyone upgrading.
    presenterCountdownMinutes: 0,
    presenterNotesFontSize: 'md',
    laserColor: '#ff2020',
    // Preserves existing behaviour (bar shown) for anyone upgrading.
    presentationShowProgressBar: true,
    showFrontmatter: false,
    editorWordWrap: true,
    // Preserves existing behaviour (720px reading-width cap) for anyone upgrading
    editorContentWidth: 'fixed',
    defaultThemeId: 'light',
    pdfPageSize: 'a4',
    // Preserves existing behaviour (always launch blank) for anyone upgrading
    // — this only changes anything for users who explicitly opt in.
    startupBehavior: 'blank',
  };
}

export function loadSettings(): AppSettings {
  const defaults = buildDefaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
