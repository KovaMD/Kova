import { useState, useEffect, useRef } from 'react';
import { bestEffort } from '../../../platform/bestEffort';
import { fetchUpdate, canSelfUpdate, restartApp } from '../../../engine/updater';
import type { AvailableUpdate } from '../../../engine/updater';
import { APP_VERSION } from '../../../version';
import { useT } from '../../../i18n';
import type { SectionProps } from '../types';
import { Toggle, Row } from '../controls';

type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; pct: number | null }
  | { phase: 'done'; version: string }
  | 'error'          // check failed — server unreachable
  | 'install-error'; // downloaded, but verify/install failed

export function UpdatesSection({ settings, set, inView, availableUpdate, isDirty, onUpdateChecked }: SectionProps & {
  availableUpdate: string | null;
  isDirty: boolean;
  onUpdateChecked: (tag: string | null) => void;
}) {
  const t = useT();

  const [updateState, setUpdateState] = useState<UpdateState>(
    availableUpdate ? { phase: 'available', version: availableUpdate } : 'idle',
  );
  const pendingUpdate = useRef<AvailableUpdate | null>(null);
  const [selfUpdateSupported, setSelfUpdateSupported] = useState(true);
  useEffect(() => {
    bestEffort(canSelfUpdate().then((supported) => {
      setSelfUpdateSupported(supported);
    }), 'canSelfUpdate');
  }, []);

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
    } catch (err) {
      console.error('[updater] check failed:', err);
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
      } catch (err) {
        console.error('[updater] re-fetch failed:', err);
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
    } catch (err) {
      console.error('[updater] install failed:', err);
      setUpdateState('install-error');
    }
  }
  return (
    <>
      {inView('updates', `${t('settings.checkForUpdates')} ${t('settings.checkForUpdatesDescription')} ${t('settings.notifyWhatsNew')} ${t('settings.notifyWhatsNewDescription')}`) && (
        <>
          {selfUpdateSupported ? (
            <Row
              label={t('settings.checkForUpdates')}
              description={t('settings.checkForUpdatesDescription')}
              control={<Toggle checked={settings.checkForUpdates} onChange={(v) => set('checkForUpdates', v)} />}
            />
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, padding: '10px 0' }}>
              {t('settings.updatesManagedByDistro')}
            </div>
          )}

          {selfUpdateSupported && <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 4 }}>
            {(updateState === 'idle' || updateState === 'up-to-date' || updateState === 'error' || updateState === 'install-error') && (
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
                {t('settings.checkNow')}
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
                {t('settings.checking')}
              </button>
            )}

            {updateState === 'up-to-date' && (
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('settings.upToDate', { version: APP_VERSION })}</span>
            )}

            {updateState === 'error' && (
              <span style={{ fontSize: 11, color: '#c0392b' }}>{t('settings.updateCheckError')}</span>
            )}

            {updateState === 'install-error' && (
              <span style={{ fontSize: 11, color: '#c0392b' }}>{t('settings.updateInstallError')}</span>
            )}

            {typeof updateState === 'object' && updateState.phase === 'available' && (
              <>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('settings.updateAvailable', { version: updateState.version })}</span>
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
                  {t('settings.updateNow')}
                </button>
              </>
            )}

            {typeof updateState === 'object' && updateState.phase === 'downloading' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {t('settings.downloading', { version: updateState.version, pct: updateState.pct !== null ? ` — ${updateState.pct}%` : '…' })}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                  {t('settings.updateInstalled', { version: updateState.version })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (isDirty && !window.confirm(t('settings.restartConfirm'))) return;
                    restartApp();
                  }}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--accent)',
                    background: 'transparent',
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t('settings.restartNow')}
                </button>
              </div>
            )}
          </div>}

          <Row
            label={t('settings.notifyWhatsNew')}
            description={t('settings.notifyWhatsNewDescription')}
            control={<Toggle checked={settings.notifyWhatsNew} onChange={(v) => set('notifyWhatsNew', v)} />}
          />
        </>
      )}
    </>
  );
}
