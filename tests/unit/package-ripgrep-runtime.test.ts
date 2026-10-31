import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { c as archive } from 'tar';
import { packageRipgrepRuntime } from '../../scripts/package-ripgrep-runtime.mjs';
import { inspectRipgrepRuntime, ripgrepTarget } from '../../scripts/ripgrep-runtime.mjs';
import { validatePackagedRipgrep } from '../../scripts/validate-ripgrep-runtime.mjs';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function binary(platform: string, cpu: string) {
  const bytes = Buffer.alloc(256);
  if (platform === 'darwin') { bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(cpu === 'arm64' ? 0x0100000c : 0x01000007, 4); }
  if (platform === 'linux') { Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(bytes); bytes.writeUInt16LE(cpu === 'arm64' ? 183 : 62, 18); }
  if (platform === 'win32') { bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(128, 0x3c); bytes.writeUInt32LE(0x00004550, 128); bytes.writeUInt16LE(cpu === 'arm64' ? 0xaa64 : 0x8664, 132); }
  return bytes;
}

async function fixture(platform: string, cpu: string, wrongCpu = false) {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-ripgrep-package-test-')); roots.push(root);
  const spec = ripgrepTarget(platform, cpu);
  const appOutDir = join(root, 'output');
  const app = join(appOutDir, platform === 'darwin' ? 'Orkestrai.app/Contents/Resources/app' : 'resources/app');
  const wrapper = join(app, 'node_modules/@vscode/ripgrep');
  await mkdir(wrapper, { recursive: true });
  await writeFile(join(app, 'package.json'), '{}');
  await writeFile(join(wrapper, 'package.json'), JSON.stringify({ name: '@vscode/ripgrep', version: '1.18.0', optionalDependencies: { [spec.name]: '1.18.0' } }));
  const content = join(root, 'content');
  await mkdir(join(content, 'package/bin'), { recursive: true });
  await writeFile(join(content, 'package/package.json'), JSON.stringify({ name: spec.name, version: '1.18.0', os: [platform], cpu: [cpu] }));
  await writeFile(join(content, 'package/LICENSE'), 'MIT test fixture');
  await writeFile(join(content, 'package', spec.binary), binary(platform, wrongCpu ? (cpu === 'arm64' ? 'x64' : 'arm64') : cpu));
  await chmod(join(content, 'package', spec.binary), 0o755);
  const tarball = join(root, 'native.tgz');
  await archive({ file: tarball, cwd: content, gzip: true }, ['package']);
  const bytes = await readFile(tarball);
  const lock = { packages: { [`node_modules/${spec.name}`]: { version: '1.18.0', resolved: `https://registry.npmjs.org/${spec.name}/-/${spec.name.split('/')[1]}-1.18.0.tgz`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } } };
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
  const fetch = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes.length) } }));
  vi.stubGlobal('fetch', fetch);
  return { root, app, spec, bytes, lock, fetch, context: { electronPlatformName: platform, arch: cpu === 'arm64' ? 3 : 1, appOutDir, packager: { projectDir: root, appInfo: { productFilename: 'Orkestrai' } } } };
}

describe('packaged code-search runtime', () => {
  it.each([['darwin', 'x64'], ['darwin', 'arm64'], ['linux', 'x64'], ['win32', 'x64']])('provisions and verifies the target instead of assuming the host package: %s/%s', async (platform, cpu) => {
    const f = await fixture(platform, cpu);
    await expect(stat(join(f.app, 'node_modules', f.spec.name))).rejects.toThrow();
    await packageRipgrepRuntime(f.context);
    expect((await inspectRipgrepRuntime(f.app, platform, cpu)).version).toBe('1.18.0');
    await validatePackagedRipgrep(f.app, { platform, arch: cpu, structureOnly: true });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    // A verified target archive can be reused without a second download.
    await packageRipgrepRuntime(f.context);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an unverified URL before downloading or writing a target', async () => {
    const f = await fixture('darwin', 'arm64');
    f.lock.packages[`node_modules/${f.spec.name}`].resolved = 'https://example.com/native.tgz';
    await writeFile(join(f.root, 'package-lock.json'), JSON.stringify(f.lock));
    await expect(packageRipgrepRuntime(f.context)).rejects.toThrow('Unverified ripgrep');
    expect(f.fetch).not.toHaveBeenCalled();
    await expect(stat(join(f.app, 'node_modules', f.spec.name))).rejects.toThrow();
  });

  it('rejects a corrupt archive before writing the app target', async () => {
    const f = await fixture('darwin', 'arm64');
    f.fetch.mockImplementation(async () => new Response('corrupt'));
    await expect(packageRipgrepRuntime(f.context)).rejects.toThrow('integrity mismatch');
    await expect(stat(join(f.app, 'node_modules', f.spec.name))).rejects.toThrow();
  });

  it('rejects an Intel executable inside a correctly named ARM package before writing the target', async () => {
    const f = await fixture('darwin', 'arm64', true);
    await expect(packageRipgrepRuntime(f.context)).rejects.toThrow('architecture mismatch');
    await expect(stat(join(f.app, 'node_modules', f.spec.name))).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('never copies through a target bin link or accepts an executable outside the app', async () => {
    const f = await fixture('darwin', 'arm64');
    const target = join(f.app, 'node_modules', f.spec.name);
    const external = join(f.root, 'external');
    await mkdir(target, { recursive: true }); await mkdir(external);
    await writeFile(join(external, 'rg'), binary('darwin', 'arm64')); await chmod(join(external, 'rg'), 0o755);
    await writeFile(join(target, 'package.json'), JSON.stringify({ name: f.spec.name, version: '1.18.0', os: ['darwin'], cpu: ['arm64'] }));
    await symlink(external, join(target, 'bin'));
    await expect(packageRipgrepRuntime(f.context)).rejects.toThrow('symbolic link');
    expect(await readFile(join(external, 'rg'))).toEqual(binary('darwin', 'arm64'));
    await expect(inspectRipgrepRuntime(f.app, 'darwin', 'arm64')).rejects.toThrow('contained');
  });

  it.skipIf(process.platform === 'win32')('rejects a linked download cache before fetching or overwriting external files', async () => {
    const f = await fixture('darwin', 'arm64');
    const external = join(f.root, 'external-cache');
    await mkdir(external); await mkdir(join(f.root, 'node_modules/.cache'), { recursive: true });
    await writeFile(join(external, 'owner.txt'), 'Keep this');
    await symlink(external, join(f.root, 'node_modules/.cache/orkestrai-ripgrep-runtime'));
    await expect(packageRipgrepRuntime(f.context)).rejects.toThrow('cache must not be a symbolic link');
    expect(f.fetch).not.toHaveBeenCalled();
    expect(await readFile(join(external, 'owner.txt'), 'utf8')).toBe('Keep this');
  });

  it('resolves and executes a contained real package and filters real source files', async () => {
    const require = createRequire(import.meta.url);
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-ripgrep-real-test-')); roots.push(root);
    const spec = ripgrepTarget(process.platform, process.arch);
    await mkdir(join(root, 'node_modules/@vscode'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{}');
    await cp(dirname(dirname(require.resolve('@vscode/ripgrep'))), join(root, 'node_modules/@vscode/ripgrep'), { recursive: true });
    await cp(dirname(require.resolve(`${spec.name}/package.json`)), join(root, 'node_modules', spec.name), { recursive: true });
    const result = await validatePackagedRipgrep(root);
    expect(result.nativeExecution).toBe(true);
  });
});
