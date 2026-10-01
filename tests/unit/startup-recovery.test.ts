import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { startupRecoveryCopy } from '../../src/lib/i18n/desktop-messages.js';

const require = createRequire(import.meta.url);
const { showStartupRecovery, waitForInternalServer } = require('../../electron/startup-recovery.cjs');
const { canInstallUpdatesAutomaticallyAsync } = require('../../electron/update-policy.cjs');

function fixture(responses: number[]) {
  return {
    dialog: { showMessageBox: vi.fn(async () => ({ response: responses.shift() ?? 3 })) },
    copy: startupRecoveryCopy('en'), retry: vi.fn(async () => {}),
    openDownload: vi.fn(async () => {}), openLogs: vi.fn(async () => {}), quit: vi.fn(), onError: vi.fn(),
  };
}

describe('server-independent native startup recovery', () => {
  it('offers download and logs even when the renderer and database are unavailable', async () => {
    const options = fixture([0, 2, 3]);
    expect(await showStartupRecovery(options)).toBe(false);
    expect(options.openDownload).toHaveBeenCalledOnce();
    expect(options.openLogs).toHaveBeenCalledOnce();
    expect(options.retry).not.toHaveBeenCalled();
    expect(options.quit).toHaveBeenCalledOnce();
  });

  it('returns to the app on a successful explicit retry', async () => {
    const options = fixture([1]);
    expect(await showStartupRecovery(options)).toBe(true);
    expect(options.retry).toHaveBeenCalledOnce();
    expect(options.quit).not.toHaveBeenCalled();
  });

  it('keeps recovery available after a failed retry instead of exiting or resetting data', async () => {
    const options = fixture([1, 2, 3]);
    options.retry.mockRejectedValueOnce(new Error('Database unavailable'));
    await showStartupRecovery(options);
    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.openLogs).toHaveBeenCalledOnce();
    expect(options.dialog.showMessageBox).toHaveBeenCalledTimes(3);
  });

  it('does not start a retry after shutdown has begun', async () => {
    const options = fixture([1]);
    let quitting = false;
    options.dialog.showMessageBox.mockImplementationOnce(async () => { quitting = true; return { response: 1 }; });
    await showStartupRecovery({ ...options, shouldContinue: () => !quitting });
    expect(options.retry).not.toHaveBeenCalled();
  });

  it('fails immediately when the server has exited rather than waiting for the 30-second deadline', async () => {
    const request = vi.fn();
    const pause = vi.fn();
    await expect(waitForInternalServer('http://127.0.0.1:4173', { server: { exitCode: 1 }, request, pause })).rejects.toThrow('exited');
    expect(request).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('detects a child exit between polls and still accepts a healthy server', async () => {
    const server = { exitCode: null as number | null };
    const request = vi.fn(async () => { server.exitCode = 1; return { ok: false }; });
    const pause = vi.fn(async () => {});
    await expect(waitForInternalServer('http://127.0.0.1:4173', { server, request, pause })).rejects.toThrow('exited');
    expect(request).toHaveBeenCalledOnce();
    await expect(waitForInternalServer('http://127.0.0.1:4173', { request: async () => ({ ok: true }) })).resolves.toBeUndefined();
  });

  it('uses all three shared Paraglide translations', () => {
    const translations = ['pt-BR', 'en', 'es'].map((locale) => startupRecoveryCopy(locale as 'pt-BR' | 'en' | 'es'));
    for (const copy of translations) for (const value of Object.values(copy)) expect(value.trim().length).toBeGreaterThan(2);
    expect(new Set(translations.map((copy) => copy.title)).size).toBe(3);
  });

  it('initializes the updater before the first server boot and packages all recovery dependencies', () => {
    const source = readFileSync('electron/main.cjs', 'utf8').split('app.whenReady().then(async () => {')[1];
    expect(source.indexOf('void setupAutoUpdater()')).toBeLessThan(source.indexOf('await ensureServer();'));
    expect(source).toContain('.catch(recoverStartup)');
    const files = JSON.parse(readFileSync('package.json', 'utf8')).build.files;
    expect(files).toContain('scripts/run-startup-migrations.mjs');
    expect(files).toContain('src/lib/database/resumable-workspace-schema.ts');
    expect(files).toContain('electron/**');
    expect(files).toContain('build/**');
  });

  it('assesses macOS trust asynchronously and defaults to manual installation when denied', async () => {
    let finish: ((error: Error | null) => void) | undefined;
    const assess = vi.fn((_command, _args, _options, callback) => { finish = callback; });
    const pending = canInstallUpdatesAutomaticallyAsync({ platform: 'darwin', execPath: '/Applications/Orkestrai.app/Contents/MacOS/Orkestrai', assess });
    expect(assess).toHaveBeenCalledOnce();
    expect(assess.mock.calls[0][2]).toMatchObject({ timeout: 30_000 });
    finish?.(null);
    expect(await pending).toBe(true);
    expect(await canInstallUpdatesAutomaticallyAsync({ platform: 'darwin', execPath: '/Applications/Orkestrai.app/Contents/MacOS/Orkestrai', assess: (_c, _a, _o, callback) => callback(new Error('not trusted')) })).toBe(false);
    expect(await canInstallUpdatesAutomaticallyAsync({ platform: 'win32', assess })).toBe(true);
  });
});
