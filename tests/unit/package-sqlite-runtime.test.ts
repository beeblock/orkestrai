import { describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { packageSqliteRuntime } from '../../scripts/package-sqlite-runtime.mjs';

const require = createRequire(import.meta.url);

describe('packaged SQLite Electron runtime', () => {
  it('repairs a copied Node binary and leaves the checkout binary unchanged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ork-sqlite-package-'));
    const resources = process.platform === 'darwin'
      ? join(directory, 'Orkestrai.app/Contents/Resources') : join(directory, 'resources');
    const app = join(resources, 'app');
    const sourceBinary = resolve('node_modules/better-sqlite3/build/Release/better_sqlite3.node');
    const original = await readFile(sourceBinary);
    const electron = require('electron') as string;
    const electronVersion = require('electron/package.json').version;
    const invoke = () => spawnSync(electron, ['-e', 'const Database=require("better-sqlite3");const db=new Database(":memory:");console.log(db.prepare("select 1 as ok").get().ok);db.close();'], {
      cwd: app, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
      encoding: 'utf8', timeout: 15_000, windowsHide: true,
    });
    try {
      await mkdir(join(app, 'node_modules'), { recursive: true });
      for (const name of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
        await cp(dirname(require.resolve(`${name}/package.json`)), join(app, 'node_modules', name), { recursive: true });
      }
      await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'sqlite-package-test', version: '1.0.0', dependencies: { 'better-sqlite3': require('better-sqlite3/package.json').version } }));
      expect(invoke().status).not.toBe(0);
      await packageSqliteRuntime({ appOutDir: directory, electronPlatformName: process.platform, arch: process.arch,
        packager: { appInfo: { productFilename: 'Orkestrai' }, info: { framework: { version: electronVersion } } } });
      const result = invoke();
      expect(result.stderr).not.toContain('NODE_MODULE_VERSION');
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('1');
      expect(await readFile(sourceBinary)).toEqual(original);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 120_000);

  it('refuses an unsupported architecture before rebuilding any files', async () => {
    await expect(packageSqliteRuntime({ electronPlatformName: 'darwin', arch: 0 })).rejects.toThrow('Unsupported SQLite runtime target');
  });
});
