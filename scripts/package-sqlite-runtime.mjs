import { rebuild } from '@electron/rebuild';
import { getAbi } from 'node-abi';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Repair the copied dependency, not the checkout's Node/test runtime. */
export async function packageSqliteRuntime(context) {
  const platform = context.electronPlatformName;
  const arch = typeof context.arch === 'number' ? ({ 1: 'x64', 3: 'arm64' })[context.arch] : context.arch;
  if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported SQLite runtime target: ${platform}/${context.arch}`);
  }
  const electronVersion = context.packager.info.framework.version;
  const abi = getAbi(electronVersion, 'electron');
  const resources = platform === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const app = resolve(resources, 'app');
  const binary = join(app, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');
  await stat(join(app, 'node_modules/better-sqlite3/package.json'));
  // electron-builder can trust a stale rebuild marker after npm restored a
  // Node binary. Force the exact Electron/CPU target after files are copied,
  // before signing; this also handles Intel packages built on Apple Silicon.
  await rebuild({ buildPath: app, projectRootPath: app, electronVersion,
    platform, arch, onlyModules: ['better-sqlite3'], force: true,
    mode: 'sequential', disablePreGypCopy: true });
  const bytes = await readFile(binary);
  if (!bytes.includes(Buffer.from(`node_register_module_v${abi}\0`))) {
    throw new Error(`Packaged SQLite does not export the Electron ABI ${abi} entry point.`);
  }
  console.log(`SQLite runtime packaged: ${platform}/${arch}, Electron ${electronVersion}, ABI ${abi}`);
}
