import { detectOsLanguage } from '../engine/spellcheck/spellChecker';

export type PresentationMode  = 'auto' | 'single' | 'dual' | 'mirror';
export type NotesFontSize     = 'sm' | 'md' | 'lg';
export type UiTheme           = 'auto' | 'dark' | 'light';
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
  uiTheme: UiTheme;
  editorFont: EditorFont;
  autosave: boolean;
  autosaveIntervalSeconds: number; // 15 | 30 | 60 | 300
  confirmOnClose: boolean;
  checkForUpdates: boolean;
  // Spell check
  spellCheckEnabled: boolean;
  spellCheckLanguage: string;
  // Presentation
  presentationMode: PresentationMode;
  slideTransition: boolean;
  presenterShowNextSlide: boolean;
  presenterShowTimer: boolean;
  presenterNotesFontSize: NotesFontSize;
}

const KEY = 'kova:settings';

function buildDefaults(): AppSettings {
  return {
    uiTheme: 'auto',
    editorFont: 'ibm-plex-mono',
    autosave: true,
    autosaveIntervalSeconds: 30,
    confirmOnClose: true,
    checkForUpdates: false,
    spellCheckEnabled: true,
    spellCheckLanguage: detectOsLanguage(),
    presentationMode: 'auto',
    slideTransition: true,
    presenterShowNextSlide: true,
    presenterShowTimer: true,
    presenterNotesFontSize: 'md',
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
