import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

const REGISTRY_URL = 'https://themes.kova.md/themes.json';
const THEME_URL = (id: string) => `https://themes.kova.md/themes/${id}.yaml`;

interface RemoteTheme {
  id: string;
  name: string;
  sha256?: string;
}

interface Props {
  themeId: string;
  onInstalled: (themeId: string) => void;
  onDismiss: () => void;
}

export function MissingThemeBanner({ themeId, onInstalled, onDismiss }: Props) {
  const [registryTheme, setRegistryTheme] = useState<RemoteTheme | null | 'checking'>('checking');
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(REGISTRY_URL)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((themes: RemoteTheme[]) => {
        if (!cancelled) setRegistryTheme(themes.find((t) => t.id === themeId) ?? null);
      })
      .catch(() => { if (!cancelled) setRegistryTheme(null); });
    return () => { cancelled = true; };
  }, [themeId]);

  async function handleInstall() {
    const theme = registryTheme as RemoteTheme;
    if (!theme?.sha256) {
      setError('Theme is missing its integrity hash');
      return;
    }
    setInstalling(true);
    setError(null);
    try {
      const res = await fetch(THEME_URL(themeId));
      if (!res.ok) throw new Error('Download failed');
      const buffer = await res.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex !== theme.sha256) throw new Error('Integrity check failed');
      await invoke('save_theme', { id: themeId, yaml: new TextDecoder().decode(buffer) });
      onInstalled(themeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
      setInstalling(false);
    }
  }

  const themeName = registryTheme && registryTheme !== 'checking'
    ? registryTheme.name
    : themeId;

  return (
    <div style={{
      position: 'fixed',
      bottom: 28,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-alt)',
      borderRadius: 6,
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      zIndex: 3000,
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 12,
      color: 'var(--text-secondary)',
      maxWidth: 560,
      minWidth: 320,
    }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--dirty-color)' }}>
        <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="8" cy="11.5" r="0.6" fill="currentColor"/>
      </svg>

      <span style={{ flex: 1 }}>
        {registryTheme === 'checking'
          ? <>Checking for theme <strong style={{ color: 'var(--text-primary)' }}>{themeId}</strong>…</>
          : registryTheme !== null
            ? <>This file uses theme <strong style={{ color: 'var(--text-primary)' }}>{themeName}</strong> which isn't installed{error ? `: ${error}` : '.'}</>
            : <>This file uses theme <strong style={{ color: 'var(--text-primary)' }}>{themeId}</strong> which isn't in the Theme Library.</>
        }
      </span>

      {registryTheme !== 'checking' && registryTheme !== null && (
        <button
          type="button"
          disabled={installing}
          onClick={handleInstall}
          style={{
            flexShrink: 0,
            padding: '4px 12px',
            fontSize: 11,
            borderRadius: 4,
            border: '1px solid var(--accent)',
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            cursor: installing ? 'default' : 'pointer',
            fontWeight: 500,
          }}
        >
          {installing ? 'Installing…' : error ? 'Retry' : 'Install'}
        </button>
      )}

      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
