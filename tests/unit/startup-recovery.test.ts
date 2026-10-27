import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { startupRecoveryCopy } from '../../src/lib/i18n/desktop-messages.js';

const require = createRequire(import.meta.url);
const { createStartupWatcher, isInteractiveLaunch, parseStartupPhase, showStartupRecovery, waitForInternalServer } = require('../../electron/startup-recovery.cjs');
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

  it('waits through a long database preparation the server announces, then 30 seconds more at most', async () => {
    let clock = 0;
    const now = () => clock;
    const pause = async (ms: number) => { clock += ms; };
    // A 2.3 GB database: backup and migrations take 55 s, then the server answers 2 s later.
    const preparing = () => clock < 55_000;
    const request = vi.fn(async () => ({ ok: clock >= 57_000 }));
    await expect(waitForInternalServer('http://127.0.0.1:4173', { now, pause, preparing, request })).resolves.toBeUndefined();
    expect(clock).toBeGreaterThanOrEqual(57_000);

    clock = 0;
    await expect(waitForInternalServer('http://127.0.0.1:4173', { now, pause, preparing: () => clock < 55_000, request: async () => ({ ok: false }) })).rejects.toThrow('did not respond');
    expect(clock).toBeGreaterThanOrEqual(84_500);
    expect(clock).toBeLessThan(86_000);

    clock = 0;
    await expect(waitForInternalServer('http://127.0.0.1:4173', { now, pause, request: async () => ({ ok: false }) })).rejects.toThrow('did not respond');
    expect(clock).toBeLessThan(31_000);

    clock = 0;
    await expect(waitForInternalServer('http://127.0.0.1:4173', { now, pause, preparing: () => true, preparationTimeoutMs: 120_000, request: async () => ({ ok: false }) })).rejects.toThrow('did not respond');
    expect(clock).toBeLessThan(121_000);
  });

  it('keeps a real server that blocks while preparing its database, and still stops one that never answers', async () => {
    // Like the server: announce each step, flushed, then block the event loop (VACUUM does) before listening.
    const script = `
      const http = require('node:http');
      const announce = (phase) => new Promise((done) => process.stdout.write('[orkestrai:startup] ' + JSON.stringify({ phase }) + '\\n', done));
      const block = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
      (async () => {
        process.stdout.write('booting\\n');
        await announce('backup'); block(900);
        await announce('migrating'); block(900);
        await announce('prepared');
        const server = http.createServer((request, response) => { response.statusCode = 200; response.end('ok'); });
        server.listen(0, '127.0.0.1', () => process.stdout.write('port ' + server.address().port + '\\n'));
      })();
    `;
    const boot = () => {
      const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
      const watcher = createStartupWatcher();
      const other: string[] = [];
      let port = 0;
      child.stdout.on('data', (chunk) => {
        for (const line of watcher.feed(String(chunk))) {
          other.push(line);
          const match = /^port (\d+)$/.exec(line);
          if (match) port = Number(match[1]);
        }
      });
      const request = async () => {
        if (!port) throw new Error('not listening');
        return fetch(`http://127.0.0.1:${port}/`);
      };
      return { child, watcher, other, request };
    };

    const patient = boot();
    try {
      await expect(waitForInternalServer('', { timeoutMs: 600, preparing: patient.watcher.preparing, server: patient.child, request: patient.request, pause: (ms: number) => new Promise((done) => setTimeout(done, ms)) })).resolves.toBeUndefined();
      expect(patient.other[0]).toBe('booting');
      expect(patient.watcher.preparing()).toBe(false);
    } finally { patient.child.kill(); }

    // Without hearing the steps, the same 1.8 s preparation looks like a hang.
    const deaf = boot();
    try {
      await expect(waitForInternalServer('', { timeoutMs: 600, server: deaf.child, request: deaf.request, pause: (ms: number) => new Promise((done) => setTimeout(done, ms)) })).rejects.toThrow('did not respond');
    } finally { deaf.child.kill(); }
  }, 20_000);

  it('shows the splash before waiting for a preparing server, and tells it about the preparation whenever it is ready', () => {
    expect(isInteractiveLaunch({ backgroundLaunch: false, loginLaunch: false, invite: null })).toBe(true);
    expect(isInteractiveLaunch({ backgroundLaunch: true, loginLaunch: false, invite: null })).toBe(false);
    expect(isInteractiveLaunch({ backgroundLaunch: false, loginLaunch: true, invite: null })).toBe(false);
    expect(isInteractiveLaunch({ backgroundLaunch: true, loginLaunch: true, invite: 'orkestrai://invite' })).toBe(true);
    const main = readFileSync('electron/main.cjs', 'utf8');
    const boot = main.split('app.whenReady().then(async () => {')[1];
    expect(boot.indexOf('createSplash();')).toBeLessThan(boot.indexOf('await ensureServer();'));
    const retry = main.split('retry: async () => {')[1];
    expect(retry.indexOf('createSplash();')).toBeLessThan(retry.indexOf('await ensureServer();'));
    expect(main).not.toContain('toldSplash');
  });

  it('replays preparation after loading stops even when did-finish-load still reports loading', () => {
    let loading = true;
    const executeJavaScript = vi.fn(async (_script: string) => {});
    class Splash extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { isLoading: () => loading, executeJavaScript });
      center() {}
      loadFile() {}
      show() {}
      isDestroyed() { return false; }
    }
    const main = readFileSync('electron/main.cjs', 'utf8');
    const source = main.slice(main.indexOf('function createSplash() {'), main.indexOf('function closeSplash() {'));
    const context = {
      BrowserWindow: Splash, splashWindow: null as Splash | null, __dirname: '/desktop', appRoot: '/app', menuLocale: 'en',
      path: { join: (...parts: string[]) => parts.join('/') },
      require: () => ({ startupPreparingCopy: () => ({ title: 'Preparing your data', detail: 'Backing up' }) }),
    };
    runInNewContext(`${source}\nstartupPreparing = true; createSplash();`, context);
    context.splashWindow!.webContents.emit('did-finish-load');
    expect(executeJavaScript).not.toHaveBeenCalled();
    loading = false;
    context.splashWindow!.webContents.emit('did-stop-loading');
    expect(executeJavaScript).toHaveBeenCalledOnce();
    expect(executeJavaScript.mock.calls[0][0]).toContain('Preparing your data');
  });

  it('reads the preparation steps the server announces and ignores anything else', () => {
    expect(parseStartupPhase('[orkestrai:startup] {"phase":"backup"}')).toBe('backup');
    expect(parseStartupPhase('[server] [orkestrai:startup] {"phase":"prepared"}')).toBe('prepared');
    expect(parseStartupPhase('[orkestrai:startup] {"phase":"format-disk"}')).toBeNull();
    expect(parseStartupPhase('[orkestrai:startup] {not json')).toBeNull();
    expect(parseStartupPhase('Orkestrai ouvindo em http://127.0.0.1:4173')).toBeNull();
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
