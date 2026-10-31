import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { inspectRipgrepRuntime } from './ripgrep-runtime.mjs';

/** @param {string} appRoot @param {{platform?:string,arch?:string|number,structureOnly?:boolean}} [options] */
export async function validatePackagedRipgrep(appRoot, { platform = process.platform, arch = process.arch, structureOnly = false } = {}) {
  const spec = await inspectRipgrepRuntime(appRoot, platform, arch);
  if (!structureOnly) {
    assert.equal(process.platform, platform, 'Native code search requires its target OS');
    assert.equal(process.arch, spec.cpu, 'Native code search requires its target CPU');
    const require = createRequire(resolve(appRoot, 'package.json'));
    const entry = await realpath(require.resolve('@vscode/ripgrep'));
    const wrapper = join(await realpath(appRoot), 'node_modules/@vscode/ripgrep');
    assert.ok(entry.startsWith(wrapper + sep), 'Code search wrapper must resolve inside the packaged app');
    const { rgPath } = await import(pathToFileURL(entry).href);
    assert.equal(await realpath(rgPath), await realpath(spec.binary), 'Code search must resolve the packaged executable');
    const execute = promisify(execFile);
    const { stdout } = await execute(rgPath, ['--version'], { timeout: 10_000, maxBuffer: 65_536, windowsHide: true });
    assert.match(stdout, /^ripgrep \d+\.\d+\.\d+/m);
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-ripgrep-smoke-'));
    try {
      await writeFile(join(directory, 'example.ts'), 'export const example = true;\n');
      await writeFile(join(directory, 'ignored.txt'), 'Not source code\n');
      const scan = await execute(rgPath, ['--files', '--hidden', '--no-follow', '--glob', '*.ts', '--', '.'], { cwd: directory, timeout: 10_000, maxBuffer: 65_536, windowsHide: true });
      assert.deepEqual(scan.stdout.trim().split(/\r?\n/).map(file => file.replaceAll('\\', '/').replace(/^\.\//, '')).sort(), ['example.ts']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const result = { platform, arch: spec.cpu, version: spec.version, nativeExecution: !structureOnly };
  console.log(JSON.stringify({ packagedCodeSearch: 'passed', ...result }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [appRoot, platform = process.platform, arch = process.arch, mode] = process.argv.slice(2);
  if (!appRoot || (mode && mode !== '--structure-only')) throw new Error('Usage: validate-ripgrep-runtime.mjs <app-root> [platform] [arch] [--structure-only]');
  await validatePackagedRipgrep(appRoot, { platform, arch, structureOnly: mode === '--structure-only' });
}
