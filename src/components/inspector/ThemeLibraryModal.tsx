import { useState, useEffect } from 'react';
import { deleteTheme, saveTheme } from '../../platform/ipc';
import { useT } from '../../i18n';
import { ModalShell, ModalCloseButton } from '../ModalShell';

// Manifest is fetched from GitHub so the SHA-256 hashes come from a source
// independent of the CDN server — a compromised themes.kova.md cannot forge
// a hash that wasn't committed to the repo by the CI pipeline.
const REGISTRY_URL = 'https://raw.githubusercontent.com/kovamd/themes/main/themes.json';
// sha256 prefix as query param ensures a new hash == new URL == guaranteed
// cache miss, regardless of how aggressively WKWebView caches the response.
const THEME_URL = (id: string, sha256: string) => `https://themes.kova.md/themes/${id}.yaml?v=${sha256.slice(0, 16)}`;

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
  const t = useT();
  const [themes, setThemes] = useState<RemoteTheme[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => { fetchManifest(); }, []);

  async function fetchManifest() {
    setStatus('loading');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(REGISTRY_URL, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error();
      const data: RemoteTheme[] = await res.json();
      setThemes(data.sort((a, b) => a.name.localeCompare(b.name)));
      setStatus('ready');
    } catch {
      setStatus('error');
    } finally {
      clearTimeout(timer);
    }
  }

  async function install(id: string) {
    setBusy((p) => ({ ...p, [id]: true }));
    setErrors((p) => ({ ...p, [id]: '' }));
    try {
      const theme = themes.find((rt) => rt.id === id);
      if (!theme?.sha256) {
        throw new Error('Cannot install: theme is missing its integrity hash');
      }
      const res = await fetch(THEME_URL(id, theme.sha256), { cache: 'no-store' });
      if (!res.ok) throw new Error('Download failed');
      const buffer = await res.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex !== theme.sha256) throw new Error('Integrity check failed — file may have been tampered with');
      await saveTheme(id, new TextDecoder().decode(buffer));
      onThemesChanged();
    } catch (err) {
      setErrors((p) => ({ ...p, [id]: err instanceof Error ? err.message : 'Install failed' }));
    } finally {
      setBusy((p) => ({ ...p, [id]: false }));
    }
  }

  async function remove(id: string) {
    setBusy((p) => ({ ...p, [id]: true }));
    try {
      await deleteTheme(id);
      onThemesChanged();
    } finally {
      setBusy((p) => ({ ...p, [id]: false }));
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      width={520}
      ariaLabel={t('inspector.themeLibraryTitle')}
      cardStyle={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
    >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 14px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {t('inspector.themeLibraryTitle')}
          </h2>
          <ModalCloseButton onClick={onClose} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {status === 'loading' && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0' }}>
              {t('inspector.themeLibraryLoading')}
            </div>
          )}

          {status === 'error' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('inspector.themeLibraryError')}
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
                {t('common.retry')}
              </button>
            </div>
          )}

          {status === 'ready' && themes.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0' }}>
              {t('inspector.themeLibraryEmpty')}
            </div>
          )}

          {status === 'ready' && themes.map((rt) => {
            const installed = installedIds.has(rt.id);
            const loading = busy[rt.id] ?? false;
            const installError = errors[rt.id] ?? '';
            return (
              <div
                key={rt.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  marginBottom: 6,
                }}
              >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  background: 'var(--bg-panel)',
                  border: `1px solid ${installError ? 'var(--danger, #c0392b)' : installed ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: installError ? '6px 6px 0 0' : 6,
                }}
              >
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  <Swatch color={rt.colors.primary} />
                  <Swatch color={rt.colors.background} border />
                  <Swatch color={rt.colors.accent} />
                  <Swatch color={rt.colors.text} />
                  {rt.colors.section_bg && <Swatch color={rt.colors.section_bg} />}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {rt.name}
                  </div>
                  {rt.description && (
                    <div style={{
                      fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {rt.description}
                    </div>
                  )}
                </div>

                {installed ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => remove(rt.id)}
                    style={secondaryBtnStyle(loading)}
                  >
                    {loading ? t('common.removing') : t('common.remove')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => install(rt.id)}
                    style={accentBtnStyle(loading)}
                  >
                    {loading ? t('common.installing') : t('common.install')}
                  </button>
                )}
              </div>
              {installError && (
                <div style={{
                  fontSize: 11,
                  color: 'var(--danger, #c0392b)',
                  background: 'var(--danger-bg, rgba(192,57,43,0.08))',
                  border: '1px solid var(--danger, #c0392b)',
                  borderTop: 'none',
                  borderRadius: '0 0 6px 6px',
                  padding: '5px 12px',
                }}>
                  {installError}
                </div>
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
          {t('inspector.themeLibraryFrom')}{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>github.com/kovamd/themes</span>
          {' · '}{t('inspector.themeLibraryFooter')}
        </div>

    </ModalShell>
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
