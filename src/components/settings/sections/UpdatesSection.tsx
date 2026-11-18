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
            <div className="settings-updates-note">
              {t('settings.updatesManagedByDistro')}
            </div>
          )}

          {selfUpdateSupported && <div className="settings-updates-actions">
            {(updateState === 'idle' || updateState === 'up-to-date' || updateState === 'error' || updateState === 'install-error') && (
              <button
                type="button"
                onClick={runCheck}
                className="settings-action-btn"
              >
                {t('settings.checkNow')}
              </button>
            )}

            {updateState === 'checking' && (
              <button
                type="button"
                disabled
                className="settings-action-btn settings-action-btn--busy"
              >
                {t('settings.checking')}
              </button>
            )}

            {updateState === 'up-to-date' && (
              <span className="settings-status">{t('settings.upToDate', { version: APP_VERSION })}</span>
            )}

            {updateState === 'error' && (
              <span className="settings-status settings-status--error">{t('settings.updateCheckError')}</span>
            )}

            {updateState === 'install-error' && (
              <span className="settings-status settings-status--error">{t('settings.updateInstallError')}</span>
            )}

            {typeof updateState === 'object' && updateState.phase === 'available' && (
              <>
                <span className="settings-status">{t('settings.updateAvailable', { version: updateState.version })}</span>
                <button
                  type="button"
                  onClick={runInstall}
                  className="settings-action-btn settings-action-btn--primary"
                >
                  {t('settings.updateNow')}
                </button>
              </>
            )}

            {typeof updateState === 'object' && updateState.phase === 'downloading' && (
              <div className="settings-inline">
                <span className="settings-status">
                  {t('settings.downloading', { version: updateState.version, pct: updateState.pct !== null ? ` — ${updateState.pct}%` : '…' })}
                </span>
                {updateState.pct !== null && (
                  <div className="settings-progress">
                    <div className="settings-progress__bar" style={{ width: `${updateState.pct}%` }} />
                  </div>
                )}
              </div>
            )}

            {typeof updateState === 'object' && updateState.phase === 'done' && (
              <div className="settings-inline settings-inline--wide">
                <span className="settings-status settings-status--success">
                  {t('settings.updateInstalled', { version: updateState.version })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (isDirty && !window.confirm(t('settings.restartConfirm'))) return;
                    restartApp();
                  }}
                  className="settings-restart-btn"
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
