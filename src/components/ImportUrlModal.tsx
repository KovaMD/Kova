import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useT } from '../i18n';
import { ModalShell } from './ModalShell';
import { toRawUrl } from '../utils/toRawUrl';

interface ImportUrlModalProps {
  onImported: (text: string) => void;
  onClose: () => void;
}

export function ImportUrlModal({ onImported, onClose }: ImportUrlModalProps) {
  const t = useT();
  const [url, setUrl]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const inputRef              = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const rawUrl = toRawUrl(trimmed);
      const text: string = await invoke('fetch_url_text', { url: rawUrl });
      onImported(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape-to-close is now handled globally by ModalShell.
    if (e.key === 'Enter') handleImport();
  };

  const resolvedUrl = toRawUrl(url.trim());
  const willRewrite = url.trim() && resolvedUrl !== url.trim();

  return (
    <ModalShell
      onClose={onClose}
      width={480}
      maxWidth="94vw"
      ariaLabel={t('modals.importUrlTitle')}
      cardStyle={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('modals.importUrlTitle')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {t('modals.importUrlDescription')}
        </div>
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('modals.importUrlPlaceholder')}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '6px 10px', borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--bg-input, var(--bg))',
            color: 'var(--text-primary)', fontSize: 13,
          }}
        />
        {willRewrite && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, wordBreak: 'break-all' }}>
            {t('modals.importUrlFetchingRaw', { url: resolvedUrl })}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--error, #e05)', lineHeight: 1.4 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="btn" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn--primary"
            onClick={handleImport}
            disabled={!url.trim() || loading}
          >
            {loading ? t('modals.importUrlFetching') : t('modals.importUrlImport')}
          </button>
        </div>
    </ModalShell>
  );
}
