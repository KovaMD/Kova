import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestEffort } from '../bestEffort';

describe('bestEffort', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('passes the resolved value through', async () => {
    await expect(bestEffort(Promise.resolve(42), 'answer')).resolves.toBe(42);
  });

  it('swallows rejections silently in production', async () => {
    vi.stubEnv('DEV', false);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await expect(bestEffort(Promise.reject(new Error('boom')), 'window op')).resolves.toBeUndefined();
    expect(debug).not.toHaveBeenCalled();
  });

  it('logs rejections with the label via console.debug in dev', async () => {
    vi.stubEnv('DEV', true);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const err = new Error('boom');
    await expect(bestEffort(Promise.reject(err), 'window op')).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0][0]).toContain('window op');
    expect(debug.mock.calls[0]).toContain(err);
  });

  it('returns a promise that never rejects', async () => {
    vi.stubEnv('DEV', false);
    const onRejected = vi.fn();
    await bestEffort(Promise.reject(new Error('nope')), 'x').catch(onRejected);
    expect(onRejected).not.toHaveBeenCalled();
  });
});
