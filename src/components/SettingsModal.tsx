import type { ReactNode } from 'react';
import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, PresentationMode, NotesFontSize } from '../store/settings';
import { checkForUpdate } from '../engine/updateCheck';
import { APP_VERSION } from '../version';

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

type CheckState = 'idle' | 'checking' | { tag: string; hasUpdate: boolean } | 'error';

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

  const [checkState, setCheckState] = useState<CheckState>(
    availableUpdate ? { tag: availableUpdate, hasUpdate: true } : 'idle',
  );

  async function runCheck() {
    setCheckState('checking');
    try {
      const { latestTag, hasUpdate } = await checkForUpdate();
      setCheckState({ tag: latestTag, hasUpdate });
      onUpdateChecked(hasUpdate ? latestTag : null);
    } catch {
      setCheckState('error');
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
            {(['dark', 'light'] as const).map((value) => (
              <button key={value} type="button" onClick={() => set('uiTheme', value)}
                style={groupBtnStyle(settings.uiTheme === value)}
              >
                {value === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
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

        <Row
          label="Check for updates on launch"
          description="Fetches the latest release tag from github.com/KovaMD/Kova on startup. No personal data is sent."
          control={<Toggle checked={settings.checkForUpdates} onChange={(v) => set('checkForUpdates', v)} />}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 4 }}>
          <button
            type="button"
            onClick={runCheck}
            disabled={checkState === 'checking'}
            style={{
              padding: '5px 14px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid var(--border-alt)',
              background: 'var(--bg-input)',
              color: checkState === 'checking' ? 'var(--text-dim)' : 'var(--text-secondary)',
              cursor: checkState === 'checking' ? 'default' : 'pointer',
            }}
          >
            {checkState === 'checking' ? 'Checking…' : 'Check now'}
          </button>

          {checkState === 'error' && (
            <span style={{ fontSize: 11, color: '#c0392b' }}>Could not reach GitHub</span>
          )}
          {typeof checkState === 'object' && !checkState.hasUpdate && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Up to date (v{APP_VERSION})</span>
          )}
          {typeof checkState === 'object' && checkState.hasUpdate && (
            <button
              type="button"
              onClick={() => openUrl('https://github.com/KovaMD/Kova/releases/latest').catch(() => {})}
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {checkState.tag} available — download
            </button>
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
