export type PresentationMode  = 'auto' | 'single' | 'dual' | 'mirror';
export type NotesFontSize     = 'sm' | 'md' | 'lg';
export type UiTheme           = 'dark' | 'light';

export interface AppSettings {
  uiTheme: UiTheme;
  autosave: boolean;
  autosaveIntervalSeconds: number; // 15 | 30 | 60 | 300
  confirmOnClose: boolean;
  checkForUpdates: boolean;
  // Presentation
  presentationMode: PresentationMode;
  presenterShowNextSlide: boolean;
  presenterShowTimer: boolean;
  presenterNotesFontSize: NotesFontSize;
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiTheme: 'dark',
  autosave: true,
  autosaveIntervalSeconds: 30,
  confirmOnClose: true,
  checkForUpdates: false,
  presentationMode: 'auto',
  presenterShowNextSlide: true,
  presenterShowTimer: true,
  presenterNotesFontSize: 'md',
};

const KEY = 'kova:settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
