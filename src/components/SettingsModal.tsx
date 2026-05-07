import type { ReactNode } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import type { AppSettings } from '../store/settings';

const APP_VERSION = '0.1.1';

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: '15 sec',  value: 15  },
  { label: '30 sec',  value: 30  },
  { label: '1 min',   value: 60  },
  { label: '5 min',   value: 300 },
];

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
        background: checked ? '#D94F00' : '#444',
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
        <div style={{ fontSize: 13, color: '#e8e8e8', lineHeight: 1.4 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: '#777', marginTop: 2, lineHeight: 1.4 }}>{description}</div>
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
      color: '#555',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      paddingTop: 20,
      paddingBottom: 6,
      borderTop: '1px solid #2e2e2e',
      marginTop: 4,
    }}>
      {label}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  settings: AppSettings;
  keybindingsPath: string;
  onChange: (s: AppSettings) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, keybindingsPath, onChange, onClose }: Props) {
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.55)',
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
        background: '#242424',
        border: '1px solid #333',
        borderRadius: 8,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        zIndex: 1001,
        padding: '20px 24px 24px',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e8e8e8' }}>Settings</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#666', cursor: 'pointer',
              padding: 4, borderRadius: 4, lineHeight: 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
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
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Save every</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {INTERVAL_OPTIONS.map(({ label, value }) => {
                const active = settings.autosaveIntervalSeconds === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('autosaveIntervalSeconds', value)}
                    style={{
                      flex: 1,
                      padding: '5px 0',
                      fontSize: 11,
                      borderRadius: 4,
                      border: `1px solid ${active ? '#D94F00' : '#3a3a3a'}`,
                      background: active ? 'rgba(217,79,0,0.15)' : '#2a2a2a',
                      color: active ? '#D94F00' : '#aaa',
                      cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      transition: 'all 0.12s',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
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

        {/* Keyboard Shortcuts */}
        <Section label="Keyboard Shortcuts" />

        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: '#e8e8e8', marginBottom: 4 }}>Keybindings file</div>
          <div style={{ fontSize: 11, color: '#777', marginBottom: 10, lineHeight: 1.5 }}>
            Shortcuts are defined in a YAML file. Edit it in any text editor and restart Kova to apply changes.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{
              flex: 1,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: 4,
              padding: '5px 8px',
              color: '#888',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {keybindingsPath}
            </code>
            <button
              type="button"
              onClick={() => openPath(keybindingsPath).catch(() => {})}
              style={{
                flexShrink: 0,
                padding: '5px 12px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #3a3a3a',
                background: '#2a2a2a',
                color: '#ccc',
                cursor: 'pointer',
              }}
            >
              Open file
            </button>
          </div>
        </div>

        {/* About */}
        <Section label="About" />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>Kova</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
              Free and open source · GNU General Public License v3
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'var(--font-mono)' }}>
            v{APP_VERSION}
          </div>
        </div>

      </div>
    </>
  );
}
