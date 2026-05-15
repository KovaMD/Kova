import { check } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';

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

export async function fetchUpdate(): Promise<AvailableUpdate | null> {
  if (import.meta.env.DEV) return fetchUpdateDev();

  const update = await check();
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
      });
    },
  };
}

export async function canSelfUpdate(): Promise<boolean> {
  return invoke<boolean>('can_self_update');
}

export async function getLinuxPackageManager(): Promise<'apt' | 'dnf' | 'unknown'> {
  return invoke<'apt' | 'dnf' | 'unknown'>('get_linux_package_manager');
}
