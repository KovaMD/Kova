import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUpdate, canSelfUpdate, restartApp } from '../updater';
import type { PendingUpdate, UpdateDownloadEvent, UpdateService } from '../ports';

// In-memory UpdateService fake; no updater plugin mock needed.
function fakeService(update: PendingUpdate | null) {
  return {
    check: vi.fn(async () => update),
    canSelfUpdate: vi.fn(async () => true),
    restartApp: vi.fn(async () => {}),
  } satisfies UpdateService;
}

describe('updater', () => {
  // The dev stub short-circuits fetchUpdate; exercise the production path.
  beforeEach(() => { vi.stubEnv('DEV', false); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns null when there is no update', async () => {
    const svc = fakeService(null);
    expect(await fetchUpdate(svc)).toBeNull();
    expect(svc.check).toHaveBeenCalledWith({ timeout: 15_000 });
  });

  it('translates download events into cumulative progress', async () => {
    const events: UpdateDownloadEvent[] = [
      { event: 'Started', data: { contentLength: 100 } },
      { event: 'Progress', data: { chunkLength: 40 } },
      { event: 'Progress', data: { chunkLength: 60 } },
      { event: 'Finished' },
    ];
    const downloadAndInstall = vi.fn(async (onEvent: (e: UpdateDownloadEvent) => void) => { events.forEach(onEvent); });
    const update = await fetchUpdate(fakeService({ version: '1.2.3', downloadAndInstall }));
    expect(update?.version).toBe('1.2.3');
    const progress: Array<[number, number | null]> = [];
    await update!.install((d, t) => progress.push([d, t]));
    expect(progress).toEqual([[0, 100], [40, 100], [100, 100]]);
    expect(downloadAndInstall).toHaveBeenCalledWith(expect.any(Function), { timeout: 300_000 });
  });

  it('reports an unknown total as null', async () => {
    const downloadAndInstall = async (onEvent: (e: UpdateDownloadEvent) => void) => {
      onEvent({ event: 'Started', data: {} });
      onEvent({ event: 'Progress', data: { chunkLength: 5 } });
    };
    const update = await fetchUpdate(fakeService({ version: '2', downloadAndInstall }));
    const progress: Array<[number, number | null]> = [];
    await update!.install((d, t) => progress.push([d, t]));
    expect(progress).toEqual([[0, null], [5, null]]);
  });

  it('delegates canSelfUpdate and restartApp to the service', async () => {
    const svc = fakeService(null);
    expect(await canSelfUpdate(svc)).toBe(true);
    await restartApp(svc);
    expect(svc.restartApp).toHaveBeenCalled();
  });
});
