import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { getAbi } from 'node-abi';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

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
  // Packagers strip binding.gyp, so electron-rebuild may silently discover no
  // native module even with force=true. Install the exact supported prebuild
  // explicitly into the copied module; never trust a marker or mutate checkout.
  // Missing Electron/CPU prebuilds must fail rather than shipping a Node binary.
  await run(process.execPath, [require.resolve('prebuild-install/bin.js'),
    '--runtime=electron', `--target=${electronVersion}`, `--platform=${platform}`,
    `--arch=${arch}`, '--force'], {
    cwd: join(app, 'node_modules/better-sqlite3'), timeout: 120_000,
    maxBuffer: 1_048_576, windowsHide: true,
  });
  const bytes = await readFile(binary);
  if (!bytes.includes(Buffer.from(`node_register_module_v${abi}\0`))) {
    throw new Error(`Packaged SQLite does not export the Electron ABI ${abi} entry point.`);
  }
  console.log(`SQLite runtime packaged: ${platform}/${arch}, Electron ${electronVersion}, ABI ${abi}`);
}
