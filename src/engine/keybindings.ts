import yaml from 'js-yaml';
import { enginePorts, type KeybindingsStore } from './ports';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
);

// snake_case file keys → camelCase action ids
const KEY_MAP: Record<string, string> = {
  new_file:   'newFile',
  open_file:  'openFile',
  save:       'save',
  save_as:    'saveAs',
  focus_mode: 'focusMode',
  hide_slide: 'hideSlide',
};

export const DEFAULT_COMBOS: Record<string, string> = {
  newFile:   'ctrl+n',
  openFile:  'ctrl+o',
  save:      'ctrl+s',
  saveAs:    'ctrl+shift+s',
  focusMode: 'ctrl+shift+f',
  hideSlide: 'ctrl+shift+h',
};

export interface Keybindings {
  path: string;
  combos: Record<string, string>;
}

/** Load keybindings from the platform config dir (created from defaults if absent). */
export async function loadKeybindings(
  store: KeybindingsStore = enginePorts().keybindings,
): Promise<Keybindings> {
  const [path, content] = await store.loadKeybindings();
  return { path, combos: parseKeybindings(content) };
}

function parseKeybindings(content: string): Record<string, string> {
  try {
    const raw = yaml.load(content) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const id = KEY_MAP[k];
      if (id && typeof v === 'string') result[id] = v.toLowerCase().trim();
    }
    // Warn on duplicate combos across resolved (user + default) bindings.
    const merged = { ...DEFAULT_COMBOS, ...result };
    const seen = new Map<string, string>();
    for (const [id, combo] of Object.entries(merged)) {
      if (!combo) continue;
      const prior = seen.get(combo);
      if (prior) console.warn(`[keybindings] duplicate combo "${combo}" assigned to "${id}" and "${prior}"`);
      else seen.set(combo, id);
    }
    return result;
  } catch {
    return {};
  }
}

/** Resolve the active combo for an action, falling back to the built-in default. */
export function getCombo(combos: Record<string, string>, id: string): string {
  return combos[id] ?? DEFAULT_COMBOS[id] ?? '';
}

/** Test whether a KeyboardEvent matches a combo string like 'ctrl+shift+s'. */
export function matchShortcut(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const wantsCtrl = parts.includes('ctrl') || parts.includes('meta');
  return (e.ctrlKey || e.metaKey) === wantsCtrl
    && e.shiftKey === parts.includes('shift')
    && e.altKey   === parts.includes('alt')
    && e.key.toLowerCase() === key;
}

/** Format a combo string for display: 'ctrl+shift+s' → 'Ctrl+Shift+S' (or 'Cmd+Shift+S' on Mac). */
export function formatCombo(combo: string): string {
  return combo.split('+').map((p) => {
    if (p === 'ctrl')  return isMac ? 'Cmd' : 'Ctrl';
    if (p === 'shift') return 'Shift';
    if (p === 'alt')   return isMac ? 'Option' : 'Alt';
    if (p === 'meta')  return 'Cmd';
    return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
  }).join('+');
}
