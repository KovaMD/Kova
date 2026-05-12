import Typo from 'typo-js';

// All supported languages — sorted by display name for the UI dropdown
export type SpellCheckLanguage =
  | 'ca' | 'cs_CZ' | 'da_DK' | 'de_DE' | 'el_GR'
  | 'en_AU' | 'en_GB' | 'en_US' | 'es_ES' | 'fr_FR'
  | 'hr_HR' | 'hu_HU' | 'it_IT' | 'nb_NO' | 'nl_NL'
  | 'pl_PL' | 'pt_PT' | 'ro_RO' | 'ru_RU' | 'sv_SE'
  | 'tr_TR' | 'uk_UA';

// Sorted alphabetically by display label for the picker
export const LANGUAGE_OPTIONS: { code: SpellCheckLanguage; label: string }[] = [
  { code: 'ca',    label: 'Català'           },
  { code: 'cs_CZ', label: 'Čeština'          },
  { code: 'da_DK', label: 'Dansk'            },
  { code: 'de_DE', label: 'Deutsch'          },
  { code: 'el_GR', label: 'Ελληνικά'        },
  { code: 'en_AU', label: 'English (AU)'     },
  { code: 'en_GB', label: 'English (UK)'     },
  { code: 'en_US', label: 'English (US)'     },
  { code: 'es_ES', label: 'Español'          },
  { code: 'fr_FR', label: 'Français'         },
  { code: 'hr_HR', label: 'Hrvatski'         },
  { code: 'hu_HU', label: 'Magyar'           },
  { code: 'it_IT', label: 'Italiano'         },
  { code: 'nb_NO', label: 'Norsk bokmål'     },
  { code: 'nl_NL', label: 'Nederlands'       },
  { code: 'pl_PL', label: 'Polski'           },
  { code: 'pt_PT', label: 'Português'        },
  { code: 'ro_RO', label: 'Română'           },
  { code: 'ru_RU', label: 'Русский'          },
  { code: 'sv_SE', label: 'Svenska'          },
  { code: 'tr_TR', label: 'Türkçe'           },
  { code: 'uk_UA', label: 'Українська'       },
];

// Keep for backwards-compat with SettingsModal import
export const LANGUAGE_LABELS: Record<SpellCheckLanguage, string> = Object.fromEntries(
  LANGUAGE_OPTIONS.map(({ code, label }) => [code, label]),
) as Record<SpellCheckLanguage, string>;

// ── OS language auto-detection ────────────────────────────────────────────────

const PRIMARY_MAP: Partial<Record<string, SpellCheckLanguage>> = {
  ca: 'ca',    cs: 'cs_CZ', da: 'da_DK', de: 'de_DE', el: 'el_GR',
  en: 'en_US', es: 'es_ES', fr: 'fr_FR', hr: 'hr_HR', hu: 'hu_HU',
  it: 'it_IT', nb: 'nb_NO', nl: 'nl_NL', no: 'nb_NO', pl: 'pl_PL',
  pt: 'pt_PT', ro: 'ro_RO', ru: 'ru_RU', sv: 'sv_SE', tr: 'tr_TR',
  uk: 'uk_UA',
};

export function detectOsLanguage(): SpellCheckLanguage {
  const osLang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  // Normalise "en-US" → "en_US" and try exact match
  const normalised = osLang.replace('-', '_') as SpellCheckLanguage;
  if (LANGUAGE_LABELS[normalised]) return normalised;
  // Fall back on primary subtag
  const primary = osLang.split('-')[0].toLowerCase();
  return PRIMARY_MAP[primary] ?? 'en_US';
}

// ── Runtime state ─────────────────────────────────────────────────────────────

const CUSTOM_WORDS_KEY = 'kova:spell-custom-words';

const cache = new Map<SpellCheckLanguage, Typo>();
let active: Typo | null = null;
let currentLang: SpellCheckLanguage | null = null;

const customWords = new Set<string>(loadCustomWords());
const ignored = new Set<string>();
const changeListeners = new Set<() => void>();

function loadCustomWords(): string[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_WORDS_KEY) ?? '[]'); }
  catch { return []; }
}

function saveCustomWords(): void {
  localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify([...customWords]));
}

export function onSpellCheckerChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

function notifyChange(): void {
  changeListeners.forEach(cb => cb());
}

export async function initSpellChecker(lang: SpellCheckLanguage): Promise<void> {
  if (currentLang === lang && active) { notifyChange(); return; }
  if (cache.has(lang)) {
    active = cache.get(lang)!;
    currentLang = lang;
    notifyChange();
    return;
  }
  try {
    const [aff, dic] = await Promise.all([
      fetch(`./dictionaries/${lang}.aff`).then(r => { if (!r.ok) throw new Error(`${lang}.aff not found`); return r.text(); }),
      fetch(`./dictionaries/${lang}.dic`).then(r => { if (!r.ok) throw new Error(`${lang}.dic not found`); return r.text(); }),
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
    const typo = new Typo(lang, aff, dic);
    cache.set(lang, typo);
    active = typo;
    currentLang = lang;
    notifyChange();
  } catch (e) {
    console.error('[Kova] Spell checker failed to load:', e);
  }
}

export function isSpellCheckerReady(): boolean {
  return active !== null;
}

export function spellCheck(word: string): boolean {
  if (!active) return true;
  const lc = word.toLowerCase();
  if (customWords.has(lc) || ignored.has(lc)) return true;
  return active.check(word);
}

export function spellSuggest(word: string): string[] {
  if (!active) return [];
  try { return (active.suggest(word) ?? []).slice(0, 6); }
  catch { return []; }
}

export function addCustomWord(word: string): void {
  customWords.add(word.toLowerCase());
  saveCustomWords();
  notifyChange();
}

export function removeCustomWord(word: string): void {
  customWords.delete(word.toLowerCase());
  saveCustomWords();
  notifyChange();
}

export function ignoreSpellingFor(word: string): void {
  ignored.add(word.toLowerCase());
  notifyChange();
}

export function getCustomWords(): string[] {
  return [...customWords].sort();
}

export function getCustomWordCount(): number {
  return customWords.size;
}
