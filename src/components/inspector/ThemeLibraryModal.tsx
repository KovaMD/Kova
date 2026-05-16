import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

const REGISTRY_URL = 'https://themes.kova.md/themes.json';
const THEME_URL = (id: string) => `https://themes.kova.md/themes/${id}.yaml`;

interface RemoteTheme {
  id: string;
  name: string;
  description?: string;
  sha256?: string;
  colors: {
    primary: string;
    background: string;
    accent: string;
    text: string;
    title_text?: string;
    section_bg?: string;
  };
}

interface Props {
  installedIds: Set<string>;
  onThemesChanged: () => void;
  onClose: () => void;
}

export function ThemeLibraryModal({ installedIds, onThemesChanged, onClose }: Props) {
  const [themes, setThemes] = useState<RemoteTheme[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => { fetchManifest(); }, []);

  async function fetchManifest() {
    setStatus('loading');
    try {
      const res = await fetch(REGISTRY_URL);
      if (!res.ok) throw new Error();
      setThemes(await res.json());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }

  async function install(id: string) {
    setBusy((p) => ({ ...p, [id]: true }));
    try {
      const theme = themes.find((t) => t.id === id);
      const res = await fetch(THEME_URL(id));
      if (!res.ok) throw new Error('Download failed');
      const buffer = await res.arrayBuffer();
      if (theme?.sha256) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
        if (hex !== theme.sha256) throw new Error('Hash mismatch — theme file may have been tampered with');
      }
      await invoke('save_theme', { id, yaml: new TextDecoder().decode(buffer) });
      onThemesChanged();
    } catch (err) {
      console.error('Theme install failed:', err);
    } finally {
      setBusy((p) => ({ ...p, [id]: false }));
    }
  }

  async function remove(id: string) {
    setBusy((p) => ({ ...p, [id]: true }));
    try {
      await invoke('delete_theme', { id });
      onThemesChanged();
    } finally {
      setBusy((p) => ({ ...p, [id]: false }));
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'var(--backdrop)', zIndex: 1000 }}
      />

      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 520,
        maxWidth: '92vw',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        zIndex: 1001,
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 14px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            More Themes
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: 4, borderRadius: 4, lineHeight: 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {status === 'loading' && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0' }}>
              Loading…
            </div>
          )}

          {status === 'error' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Could not reach themes.kova.md
              </div>
              <button
                type="button"
                onClick={fetchManifest}
                style={{
                  padding: '5px 14px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                  border: '1px solid var(--border-alt)', background: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {status === 'ready' && themes.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0' }}>
              No themes available yet.
            </div>
          )}

          {status === 'ready' && themes.map((t) => {
            const installed = installedIds.has(t.id);
            const loading = busy[t.id] ?? false;
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  marginBottom: 6,
                  background: 'var(--bg-panel)',
                  border: `1px solid ${installed ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  <Swatch color={t.colors.primary} />
                  <Swatch color={t.colors.background} border />
                  <Swatch color={t.colors.accent} />
                  <Swatch color={t.colors.text} />
                  {t.colors.section_bg && <Swatch color={t.colors.section_bg} />}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {t.name}
                  </div>
                  {t.description && (
                    <div style={{
                      fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.description}
                    </div>
                  )}
                </div>

                {installed ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => remove(t.id)}
                    style={secondaryBtnStyle(loading)}
                  >
                    {loading ? 'Removing…' : 'Remove'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => install(t.id)}
                    style={accentBtnStyle(loading)}
                  >
                    {loading ? 'Installing…' : 'Install'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px',
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-dim)',
          flexShrink: 0,
          textAlign: 'center',
        }}>
          From{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>themes.kova.md</span>
          {' · '}Installed themes are added to the Theme picker immediately
        </div>

      </div>
    </>
  );
}

function Swatch({ color, border }: { color: string; border?: boolean }) {
  return (
    <div style={{
      width: 14, height: 14, borderRadius: 2,
      background: color,
      border: border ? '1px solid var(--border-alt)' : 'none',
      flexShrink: 0,
    }} />
  );
}

function secondaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    flexShrink: 0, padding: '4px 12px', fontSize: 11, borderRadius: 4,
    border: '1px solid var(--border-alt)', background: 'var(--bg-input)',
    color: 'var(--text-secondary)', cursor: disabled ? 'default' : 'pointer',
  };
}

function accentBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    flexShrink: 0, padding: '4px 12px', fontSize: 11, borderRadius: 4,
    border: '1px solid var(--accent)', background: 'var(--accent-bg)',
    color: 'var(--accent)', cursor: disabled ? 'default' : 'pointer', fontWeight: 500,
  };
}
