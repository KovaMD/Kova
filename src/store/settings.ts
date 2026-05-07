export interface AppSettings {
  autosave: boolean;
  autosaveIntervalSeconds: number; // 15 | 30 | 60 | 300
  confirmOnClose: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autosave: true,
  autosaveIntervalSeconds: 30,
  confirmOnClose: true,
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
