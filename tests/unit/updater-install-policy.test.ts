import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { BaseUpdater } = require('electron-updater/out/BaseUpdater.js');
const { applyUpdateInstallPolicy, createUpdaterLogger } = require('../../electron/update-policy.cjs');
const { createDiagnosticsLogger } = require('../../electron/diagnostics.cjs');
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

function downloadedUpdate(platform: string, supported = true) {
  const events = new EventEmitter();
  const adapter = {
    version: '0.52.2', name: 'Orkestrai', isPackaged: true,
    onQuit: (handler: (code: number) => void) => events.once('quit', handler),
  };
  // Exercise the actual pinned updater's downloaded-update and quit hooks.
  // No installer process, model account or owner data is involved.
  const updater = new BaseUpdater(undefined, adapter);
  updater.logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  updater.downloadedUpdateHelper = {
    file: join(tmpdir(), 'synthetic-verified-installer.exe'),
    downloadedFileInfo: { isAdminRightsRequired: false },
  };
  updater.doInstall = vi.fn(() => true);
  applyUpdateInstallPolicy(updater, { platform, supported });
  updater.addQuitHandler();
  return { events, updater };
}

it.each([0, 1, 143])('does not launch NSIS when Windows exits with code %s after downloading an update', code => {
  const { events, updater } = downloadedUpdate('win32');
  events.emit('quit', code);
  expect(updater.autoDownload).toBe(true);
  expect(updater.doInstall).not.toHaveBeenCalled();
  expect(updater.installerPath).toContain('synthetic-verified-installer.exe');
});

it('keeps a Windows download available for the explicit restart/update action', () => {
  const { events, updater } = downloadedUpdate('win32');
  expect(updater.install(true, true)).toBe(true);
  events.emit('quit', 0);
  expect(updater.doInstall).toHaveBeenCalledExactlyOnceWith({ isSilent: true, isForceRunAfter: true, isAdminRightsRequired: false });
});

it.each(['linux', 'darwin'])('preserves trusted %s update-on-quit behavior', platform => {
  const { events, updater } = downloadedUpdate(platform);
  events.emit('quit', 0);
  expect(updater.doInstall).toHaveBeenCalledExactlyOnceWith({ isSilent: true, isForceRunAfter: false, isAdminRightsRequired: false });
});

it('never downloads or auto-installs an untrusted macOS build', () => {
  const { events, updater } = downloadedUpdate('darwin', false);
  events.emit('quit', 0);
  expect(updater.autoDownload).toBe(false);
  expect(updater.doInstall).not.toHaveBeenCalled();
});

it('persists updater stages in the bounded diagnostics log and redacts credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-updater-diagnostics-'));
  directories.push(directory);
  const diagnostics = createDiagnosticsLogger(directory, { maxBytes: 1024, backups: 1 });
  const logger = createUpdaterLogger((...values: unknown[]) => diagnostics.write(...values));
  logger.info('Auto install update on quit');
  logger.warn('Authorization: Bearer private-example-token');
  logger.error('Installer failed', { password: 'private-password' });
  const contents = await readFile(diagnostics.filePath, 'utf8');
  expect(contents).toContain('[INFO] [updater] Auto install update on quit');
  expect(contents).toContain('[ERROR] [updater] Installer failed');
  expect(contents).not.toContain('private-example-token');
  expect(contents).not.toContain('private-password');
});
