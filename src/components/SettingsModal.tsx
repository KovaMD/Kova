import type { ReactNode } from 'react';
import { useState, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, PresentationMode, NotesFontSize } from '../store/settings';
import { EDITOR_FONT_OPTIONS } from '../store/settings';
import { isFontAvailable } from '../engine/fontDetect';
import { fetchUpdate, canSelfUpdate, getLinuxPackageManager } from '../engine/updater';
import type { AvailableUpdate } from '../engine/updater';
import { APP_VERSION } from '../version';
import {
  LANGUAGE_OPTIONS,
  getCustomWords,
  removeCustomWord,
  getCustomWordCount,
} from '../engine/spellcheck/spellChecker';

const THIRD_PARTY_LICENSES: { name: string; license: string; copyright: string }[] = [
  { name: 'IBM Plex Mono',           license: 'SIL Open Font License 1.1', copyright: '© 2017 IBM Corp.'                        },
  { name: 'CodeMirror',              license: 'MIT',                        copyright: '© Marijn Haverbeke and contributors'     },
  { name: 'highlight.js',            license: 'BSD 3-Clause',               copyright: '© 2006 Ivan Sagalaev'                   },
  { name: 'js-yaml',                 license: 'MIT',                        copyright: '© 2011 Vitaly Puzrin and contributors'   },
  { name: 'Mermaid',                 license: 'MIT',                        copyright: '© 2014 Knut Sveidqvist and contributors' },
  { name: 'PptxGenJS',               license: 'MIT',                        copyright: '© 2015 Brent Ely'                       },
  { name: 'React',                   license: 'MIT',                        copyright: '© Meta Platforms, Inc.'                 },
  { name: 'react-resizable-panels',  license: 'MIT',                        copyright: '© 2022 Brian Vaughn'                    },
  { name: 'remark / unified',        license: 'MIT',                        copyright: '© unified collective'                   },
  { name: 'Tauri',                   license: 'MIT / Apache 2.0',           copyright: '© 2019 Tauri Programme'                 },
  { name: 'typo-js',                 license: 'BSD',                        copyright: '© 2012 Browserling'                     },
  { name: 'Vite',                    license: 'MIT',                        copyright: '© 2019 Evan You and contributors'       },
];

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: '15 sec',  value: 15  },
  { label: '30 sec',  value: 30  },
  { label: '1 min',   value: 60  },
  { label: '5 min',   value: 300 },
];

// ── Shared button group style ─────────────────────────────────────────────────

function groupBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 4,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-alt)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--bg-input)',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    cursor: 'pointer', fontWeight: active ? 600 : 400, transition: 'all 0.12s',
  };
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: checked ? 'var(--accent)' : 'var(--btn-border)',
        cursor: 'pointer',
        transition: 'background 0.18s',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 19 : 3,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.18s',
        display: 'block',
      }} />
    </button>
  );
}

// ── Setting row ───────────────────────────────────────────────────────────────

function Row({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{description}</div>
        )}
      </div>
      {control}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function Section({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--text-dim)',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      paddingTop: 20,
      paddingBottom: 6,
      borderTop: '1px solid var(--border)',
      marginTop: 4,
    }}>
      {label}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; pct: number | null }
  | { phase: 'done'; version: string }
  | 'error';

interface Props {
  settings: AppSettings;
  keybindingsPath: string;
  themesDir: string;
  themeLoadErrors: string[];
  availableUpdate: string | null;
  onChange: (s: AppSettings) => void;
  onUpdateChecked: (tag: string | null) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, keybindingsPath, themesDir, themeLoadErrors, availableUpdate, onChange, onUpdateChecked, onClose }: Props) {
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const [updateState, setUpdateState] = useState<UpdateState>(
    availableUpdate ? { phase: 'available', version: availableUpdate } : 'idle',
  );
  const pendingUpdate = useRef<AvailableUpdate | null>(null);
  const [selfUpdateSupported, setSelfUpdateSupported] = useState(true);
  const [linuxPackageManager, setLinuxPackageManager] = useState<'apt' | 'dnf' | 'unknown'>('unknown');

  useEffect(() => {
    canSelfUpdate().then((supported) => {
      setSelfUpdateSupported(supported);
      if (!supported) getLinuxPackageManager().then(setLinuxPackageManager).catch(() => {});
    }).catch(() => {});
  }, []);
  const [showLicenses, setShowLicenses] = useState(false);

  const [customWordList, setCustomWordList] = useState<string[]>(() => getCustomWords());
  const [showCustomWords, setShowCustomWords] = useState(false);

  const availableFonts = useMemo(() =>
    EDITOR_FONT_OPTIONS.filter(opt => opt.bundled || opt.value === 'system' || isFontAvailable(opt.family)),
    [],
  );

  // If the saved font is no longer available, reset to the bundled default
  useEffect(() => {
    if (!availableFonts.some(f => f.value === settings.editorFont)) {
      onChange({ ...settings, editorFont: 'ibm-plex-mono' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRemoveCustomWord(word: string) {
    removeCustomWord(word);
    setCustomWordList(getCustomWords());
  }

  async function runCheck() {
    setUpdateState('checking');
    try {
      const update = await fetchUpdate();
      if (update) {
        pendingUpdate.current = update;
        setUpdateState({ phase: 'available', version: update.version });
        onUpdateChecked(update.version);
      } else {
        pendingUpdate.current = null;
        setUpdateState('up-to-date');
        onUpdateChecked(null);
      }
    } catch {
      setUpdateState('error');
    }
  }

  async function runInstall() {
    let update = pendingUpdate.current;
    if (!update) {
      // Modal was opened from the startup notification — re-fetch to get the install handle
      setUpdateState('checking');
      try {
        update = await fetchUpdate();
        if (!update) { setUpdateState('up-to-date'); return; }
        pendingUpdate.current = update;
      } catch {
        setUpdateState('error');
        return;
      }
    }
    const { version } = update;
    setUpdateState({ phase: 'downloading', version, pct: null });
    try {
      let total: number | null = null;
      await update.install((downloaded, contentLength) => {
        if (total === null && contentLength) total = contentLength;
        setUpdateState({ phase: 'downloading', version, pct: total ? Math.round((downloaded / total) * 100) : null });
      });
      setUpdateState({ phase: 'done', version });
    } catch {
      setUpdateState('error');
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'var(--backdrop)',
          zIndex: 1000,
        }}
      />

      {/* Card */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 480,
        maxWidth: '92vw',
        maxHeight: '85vh',
        overflowY: 'auto',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        zIndex: 1001,
        padding: '20px 24px 24px',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Settings</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              padding: 4, borderRadius: 4, lineHeight: 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Appearance */}
        <Section label="Appearance" />

        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>App theme</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'auto',  label: 'Auto'  },
              { value: 'dark',  label: 'Dark'  },
              { value: 'light', label: 'Light' },
            ] as const).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('uiTheme', value)}
                style={groupBtnStyle(settings.uiTheme === value)}
              >
                {label}
              </button>
            ))}
          </div>
          {settings.uiTheme === 'auto' && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
              Follows your operating system's appearance setting.
            </div>
          )}
        </div>

        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>Editor font</div>
          <div style={{ position: 'relative' }}>
            <select
              value={settings.editorFont}
              onChange={(e) => set('editorFont', e.target.value as AppSettings['editorFont'])}
              style={{
                width: '100%',
                padding: '6px 28px 6px 10px',
                fontSize: 12,
                fontFamily: availableFonts.find(o => o.value === settings.editorFont)?.family ?? 'monospace',
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                outline: 'none',
              }}
            >
              {availableFonts.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <svg
              viewBox="0 0 10 6"
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
              }}
            >
              <path d="M0 0l5 6 5-6z" fill="currentColor" />
            </svg>
          </div>
        </div>

        {/* Themes */}
        <Section label="Themes" />

        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            Drop any <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>.yaml</code> theme file into the folder below and restart Kova to load it. Copy <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>example.yaml</code> as a starting point.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{
              flex: 1,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-app)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '5px 8px',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {themesDir}
            </code>
            <button
              type="button"
              onClick={() => invoke('show_in_file_manager', { path: themesDir }).catch(() => {})}
              style={{
                flexShrink: 0,
                padding: '5px 12px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Open folder
            </button>
          </div>
          {themeLoadErrors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: '#c0392b', marginBottom: 4 }}>
                Failed to load {themeLoadErrors.length} theme file{themeLoadErrors.length > 1 ? 's' : ''}:
              </div>
              {themeLoadErrors.map((err) => (
                <div key={err} style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', paddingLeft: 8 }}>
                  {err}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Language & Spelling */}
        <Section label="Language &amp; Spelling" />

        <Row
          label="Check spelling while typing"
          description="Underlines misspelled words in red. Dictionary is loaded on first use."
          control={<Toggle checked={settings.spellCheckEnabled} onChange={(v) => set('spellCheckEnabled', v)} />}
        />

        {settings.spellCheckEnabled && (
          <>
            <div style={{ paddingBottom: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 8 }}>Dictionary language</div>
              <div style={{ position: 'relative' }}>
                <select
                  value={settings.spellCheckLanguage}
                  onChange={(e) => set('spellCheckLanguage', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 28px 6px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid var(--border-alt)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    outline: 'none',
                  }}
                >
                  {LANGUAGE_OPTIONS.map(({ code, label }) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
                <svg
                  viewBox="0 0 10 6"
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
                  }}
                >
                  <path d="M0 0l5 6 5-6z" fill="currentColor" />
                </svg>
              </div>
            </div>

            <div style={{ paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: customWordList.length > 0 && showCustomWords ? 8 : 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text-label)' }}>
                  Learned words ({getCustomWordCount()})
                </div>
                {customWordList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCustomWords(!showCustomWords)}
                    style={{
                      padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                      border: '1px solid var(--border-alt)', background: 'var(--bg-input)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {showCustomWords ? 'Hide' : 'Manage'}
                  </button>
                )}
                {customWordList.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>None yet</span>
                )}
              </div>

              {showCustomWords && customWordList.length > 0 && (
                <div style={{
                  marginTop: 8,
                  maxHeight: 160,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg-app)',
                }}>
                  {customWordList.map((word) => (
                    <div key={word} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '5px 10px', borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{word}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomWord(word)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
                          color: 'var(--text-dim)', fontSize: 14, lineHeight: 1,
                        }}
                        title="Remove from dictionary"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Saving */}
        <Section label="Saving" />

        <Row
          label="Autosave"
          description="Automatically save your file at regular intervals. Only applies after your first manual save."
          control={<Toggle checked={settings.autosave} onChange={(v) => set('autosave', v)} />}
        />

        {settings.autosave && (
          <div style={{ paddingBottom: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 8 }}>Save every</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {INTERVAL_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('autosaveIntervalSeconds', value)}
                  style={groupBtnStyle(settings.autosaveIntervalSeconds === value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Workspace */}
        <Section label="Workspace" />

        <Row
          label="Confirm before closing"
          description="Ask for confirmation when closing a file with unsaved changes."
          control={<Toggle checked={settings.confirmOnClose} onChange={(v) => set('confirmOnClose', v)} />}
        />

        {/* Presentation */}
        <Section label="Presentation" />

        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Display mode</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            Auto detects connected displays at presentation time — dual presenter view if a second screen is found, single screen otherwise. Mirror shows the same slide on both displays.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'auto',   label: 'Auto'          },
              { value: 'single', label: 'Single screen' },
              { value: 'dual',   label: 'Dual screen'   },
              { value: 'mirror', label: 'Mirror'        },
            ] as { value: PresentationMode; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('presentationMode', value)}
                style={groupBtnStyle(settings.presentationMode === value)}
              >{label}</button>
            ))}
          </div>
        </div>

        {settings.presentationMode === 'dual' && (
          <>
            <Row
              label="Show next slide preview"
              description="Displays a preview of the upcoming slide in the presenter view."
              control={<Toggle checked={settings.presenterShowNextSlide} onChange={(v) => set('presenterShowNextSlide', v)} />}
            />
            <Row
              label="Show elapsed timer"
              description="Displays a running clock from the moment the presentation starts."
              control={<Toggle checked={settings.presenterShowTimer} onChange={(v) => set('presenterShowTimer', v)} />}
            />
            <div style={{ padding: '6px 0 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>Notes font size</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {([
                  { value: 'sm', label: 'Small'  },
                  { value: 'md', label: 'Medium' },
                  { value: 'lg', label: 'Large'  },
                ] as { value: NotesFontSize; label: string }[]).map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => set('presenterNotesFontSize', value)}
                    style={groupBtnStyle(settings.presenterNotesFontSize === value)}
                  >{label}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Keyboard Shortcuts */}
        <Section label="Keyboard Shortcuts" />

        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Keybindings file</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            Shortcuts are defined in a YAML file. Edit it in any text editor and restart Kova to apply changes.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{
              flex: 1,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-app)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '5px 8px',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {keybindingsPath}
            </code>
            <button
              type="button"
              onClick={() => invoke('show_in_file_manager', { path: keybindingsPath }).catch(() => {})}
              style={{
                flexShrink: 0,
                padding: '5px 12px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Open file
            </button>
          </div>
        </div>

        {/* Updates */}
        <Section label="Updates" />

        {selfUpdateSupported ? (
          <Row
            label="Check for updates on launch"
            description="Fetches the latest release tag from github.com/KovaMD/Kova on startup. No personal data is sent."
            control={<Toggle checked={settings.checkForUpdates} onChange={(v) => set('checkForUpdates', v)} />}
          />
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, padding: '10px 0' }}>
            Updates for this installation are managed by your package manager.
            {linuxPackageManager === 'apt' && (
              <> Run <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: 3 }}>sudo apt update && sudo apt upgrade kova</code> to update.</>
            )}
            {linuxPackageManager === 'dnf' && (
              <> Run <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: 3 }}>sudo dnf upgrade kova</code> to update.</>
            )}
            {linuxPackageManager === 'unknown' && (
              <> Use <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: 3 }}>apt upgrade</code> or <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: 3 }}>dnf upgrade</code> to update Kova.</>
            )}
          </div>
        )}

        {selfUpdateSupported && <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 4 }}>
          {(updateState === 'idle' || updateState === 'up-to-date' || updateState === 'error') && (
            <button
              type="button"
              onClick={runCheck}
              style={{
                padding: '5px 14px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Check now
            </button>
          )}

          {updateState === 'checking' && (
            <button
              type="button"
              disabled
              style={{
                padding: '5px 14px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-dim)',
                cursor: 'default',
              }}
            >
              Checking…
            </button>
          )}

          {updateState === 'up-to-date' && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Up to date (v{APP_VERSION})</span>
          )}

          {updateState === 'error' && (
            <span style={{ fontSize: 11, color: '#c0392b' }}>Could not reach update server</span>
          )}

          {typeof updateState === 'object' && updateState.phase === 'available' && (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{updateState.version} available</span>
              <button
                type="button"
                onClick={runInstall}
                style={{
                  padding: '5px 14px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid var(--accent)',
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Update Now
              </button>
            </>
          )}

          {typeof updateState === 'object' && updateState.phase === 'downloading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Downloading {updateState.version}{updateState.pct !== null ? ` — ${updateState.pct}%` : '…'}
              </span>
              {updateState.pct !== null && (
                <div style={{ width: 80, height: 3, background: 'var(--border)', borderRadius: 2 }}>
                  <div style={{
                    width: `${updateState.pct}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    borderRadius: 2,
                    transition: 'width 0.15s',
                  }} />
                </div>
              )}
            </div>
          )}

          {typeof updateState === 'object' && updateState.phase === 'done' && (
            <span style={{ fontSize: 11, color: 'var(--accent)' }}>
              {updateState.version} installed — restart Kova to apply
            </span>
          )}
        </div>}

        {/* Licenses */}
        <Section label="Licenses" />

        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Kova is built on open source software.
            </div>
            <button
              type="button"
              onClick={() => setShowLicenses(v => !v)}
              style={{
                flexShrink: 0,
                marginLeft: 12,
                padding: '3px 10px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {showLicenses ? 'Hide' : 'Show'}
            </button>
          </div>

          {showLicenses && (
            <div style={{
              marginTop: 10,
              border: '1px solid var(--border)',
              borderRadius: 4,
              overflow: 'hidden',
            }}>
              {THIRD_PARTY_LICENSES.map((entry, i) => (
                <div
                  key={entry.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'baseline',
                    gap: '6px 12px',
                    padding: '7px 10px',
                    background: i % 2 === 0 ? 'var(--bg-app)' : 'transparent',
                    borderBottom: i < THIRD_PARTY_LICENSES.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{entry.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 8 }}>{entry.copyright}</span>
                  </div>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-alt)',
                    borderRadius: 3,
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}>
                    {entry.license}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* About */}
        <Section label="About" />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Kova</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
              Free and open source · GNU General Public License v3
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            v{APP_VERSION}
          </div>
        </div>

      </div>
    </>
  );
}
