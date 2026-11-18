import { enginePorts, type UpdateService } from './ports';

// ── Dev stub ──────────────────────────────────────────────────────────────────
// Simulates a found update with a fake download to exercise all UI states.
// Automatically excluded from production builds via import.meta.env.DEV.
async function fetchUpdateDev(): Promise<AvailableUpdate> {
  await new Promise(r => setTimeout(r, 800));
  return {
    version: 'v99.0.0',
    async install(onProgress) {
      for (let i = 0; i <= 100; i += 5) {
        await new Promise(r => setTimeout(r, 120));
        onProgress(i, 100);
      }
    },
  };
}
// ─────────────────────────────────────────────────────────────────────────────

export interface AvailableUpdate {
  version: string;
  install(onProgress: (downloaded: number, total: number | null) => void): Promise<void>;
}

// Both requests default to no timeout, so a stalled (not merely dropped)
// connection would otherwise hang "Checking…"/"Downloading…" forever instead
// of failing into the UI's error state. The timeout covers the *entire*
// request (connect through full body), so the download budget has to be
// generous enough for the ~25-105MB installers over a slow connection, not
// just a stall guard.
const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

export async function fetchUpdate(
  updates: UpdateService = enginePorts().updates,
): Promise<AvailableUpdate | null> {
  if (import.meta.env.DEV) return fetchUpdateDev();

  const update = await updates.check({ timeout: CHECK_TIMEOUT_MS });
  if (!update) return null;

  return {
    version: update.version,
    async install(onProgress) {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null;
          onProgress(0, total);
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          onProgress(downloaded, total);
        }
      }, { timeout: DOWNLOAD_TIMEOUT_MS });
    },
  };
}

export async function canSelfUpdate(updates: UpdateService = enginePorts().updates): Promise<boolean> {
  return updates.canSelfUpdate();
}

export async function restartApp(updates: UpdateService = enginePorts().updates): Promise<void> {
  return updates.restartApp();
}

