import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { RELEASE_API, latestPublicRelease, checkWithFallback } = require('../../electron/update-discovery.cjs');

const release = (overrides = {}) => ({ tag_name: 'v0.52.6', draft: false, prerelease: false,
  html_url: 'https://github.com/beeblock/orkestrai/releases/tag/v0.52.6',
  assets: [{ name: 'Orkestrai-Setup-0.52.6.exe' }, { name: 'Orkestrai-0.52.6-arm64.dmg' }], ...overrides });
const fetchRelease = (data = release()) => vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify(data), { status: 200 }));

describe('update discovery during a GitHub feed outage', () => {
  it('offers the official Windows installer after two transient feed failures', async () => {
    const original = new Error('504 Gateway Time-out');
    const primary = vi.fn().mockRejectedValue(original), fetchImpl = fetchRelease(), pause = vi.fn();
    const result = await checkWithFallback(primary, () => latestPublicRelease({ currentVersion: '0.52.5', platform: 'win32', fetchImpl }), pause);
    expect(result).toEqual({ status: 'manual', version: '0.52.6', reason: 'network' });
    expect(primary).toHaveBeenCalledTimes(2); expect(pause).toHaveBeenCalledExactlyOnceWith(500);
    expect(fetchImpl).toHaveBeenCalledWith(RELEASE_API, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchImpl.mock.calls[0][1]?.headers).not.toHaveProperty('authorization');
  });

  it('does not report a check failure when the API confirms the installed Windows version', async () => {
    expect(await latestPublicRelease({ currentVersion: '0.52.6', platform: 'win32', fetchImpl: fetchRelease() })).toEqual({ status: 'none' });
  });

  it('keeps a successful ordinary updater check and its install path unchanged', async () => {
    const fallback = vi.fn();
    const accepted = { status: 'available', version: '0.52.6' };
    expect(await checkWithFallback(async () => accepted, fallback)).toBe(accepted);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('retries a transient primary once before using the secondary source', async () => {
    const primary = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue({ status: 'none' });
    const fallback = vi.fn();
    expect(await checkWithFallback(primary, fallback, vi.fn())).toEqual({ status: 'none' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('preserves a real error when both independent sources are unavailable', async () => {
    const original = new Error('HTTP 504');
    await expect(checkWithFallback(async () => { throw original; }, async () => { throw new Error('offline'); }, vi.fn())).rejects.toBe(original);
  });

  it.each([
    { draft: true }, { prerelease: true }, { tag_name: 'v999999999999.1.1' },
    { tag_name: '<script>1.2.3</script>' }, { html_url: 'https://evil.invalid/release' },
    { assets: [{ name: 'unrelated.exe' }] }, { assets: Array.from({ length: 101 }, () => ({ name: 'Orkestrai-Setup-0.52.6.exe' })) },
  ])('rejects malformed/unavailable release metadata (%j)', async overrides => {
    await expect(latestPublicRelease({ currentVersion: '0.52.5', platform: 'win32', fetchImpl: fetchRelease(release(overrides)) })).rejects.toThrow();
  });

  it('bounds the actual streamed body even when Content-Length is absent', async () => {
    await expect(latestPublicRelease({ currentVersion: '0.52.5', platform: 'win32',
      fetchImpl: async () => new Response('x'.repeat(262145)) })).rejects.toThrow('too large');
  });

  it('does not offer an Intel-only Mac release to an ARM installation', async () => {
    await expect(latestPublicRelease({ currentVersion: '0.52.5', platform: 'darwin', arch: 'arm64',
      fetchImpl: fetchRelease(release({ assets: [{ name: 'Orkestrai-0.52.6.dmg' }] })) })).rejects.toThrow('compatible installer');
  });
});
