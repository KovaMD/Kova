import type { DeepPartial, Messages } from './types';
import sl from './locales/sl';

export interface LocaleDef {
  code: string;
  label: string;
  messages: DeepPartial<Messages> | null; // null = English, no override tree needed
}

// Registering a community locale = add one entry here, importing its
// translation tree from './locales/<code>'. See TRANSLATING.md.
export const LOCALES: LocaleDef[] = [
  { code: 'en', label: 'English', messages: null },
  { code: 'sl', label: 'Slovenščina', messages: sl },
];

export const UI_LOCALE_OPTIONS: { code: string; label: string }[] = [
  { code: 'auto', label: 'System default' },
  ...LOCALES.map(({ code, label }) => ({ code, label })),
];

const SUPPORTED_CODES = new Set(LOCALES.map((l) => l.code));

export function detectOsLocale(): string {
  const osLang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  const primary = osLang.split('-')[0].toLowerCase();
  return SUPPORTED_CODES.has(primary) ? primary : 'en';
}

export function getLocaleMessages(code: string): DeepPartial<Messages> | null {
  return LOCALES.find((l) => l.code === code)?.messages ?? null;
}
