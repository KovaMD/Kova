// One-off work when the editor starts: load the user's keybindings, check for
// an update (opt-in) and decide whether to show the "What's new" notice.
import { useCallback, useEffect, useState } from 'react';
import { loadKeybindings, type Keybindings } from '../engine/keybindings';
import { fetchUpdate } from '../engine/updater';
import { loadLastSeenVersion, saveLastSeenVersion } from '../store/lastSeenVersion';
import { bestEffort } from '../platform/bestEffort';
import { APP_VERSION } from '../version';

export interface StartupSettings {
  checkForUpdates: boolean;
  notifyWhatsNew: boolean;
}

export function useStartupChecks({ checkForUpdates, notifyWhatsNew }: StartupSettings) {
  const [keybindings, setKeybindings] = useState<Keybindings>({ path: '', combos: {} });
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null);
  const [showWhatsNew, setShowWhatsNew] = useState(false);

  // Keybindings from the platform config dir.
  useEffect(() => {
    void bestEffort(loadKeybindings().then(setKeybindings), 'load_keybindings');
  }, []);

  // Update check, only when the opt-in setting is on at launch.
  useEffect(() => {
    if (!checkForUpdates) return;
    fetchUpdate()
      .then((update) => { if (update) setAvailableUpdate(update.version); })
      .catch((err) => console.error('[updater] startup check failed:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- launch-time setting: runs once on mount
  }, []);

  // "What's new" notice: fires the first launch after APP_VERSION changes,
  // regardless of how the update was installed (self-updater, APT/RPM,
  // Flatpak). A missing lastSeenVersion means a fresh install, not an
  // update, so it's recorded silently without a notice.
  // Always fires in dev (import.meta.env.DEV) so the notice can be eyeballed
  // without hand-editing localStorage; excluded from production builds.
  useEffect(() => {
    const lastSeen = loadLastSeenVersion();
    saveLastSeenVersion(APP_VERSION);
    const isNewVersion = lastSeen !== null && lastSeen !== APP_VERSION;
    if ((isNewVersion || import.meta.env.DEV) && notifyWhatsNew) {
      setShowWhatsNew(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- launch-time setting: runs once on mount
  }, []);

  const dismissWhatsNew = useCallback(() => setShowWhatsNew(false), []);

  // setAvailableUpdate: SettingsModal's manual update check reports here too.
  return { keybindings, availableUpdate, setAvailableUpdate, showWhatsNew, dismissWhatsNew };
}
