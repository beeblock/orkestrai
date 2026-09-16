import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as archive } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computerRuntimeSpec, packageComputerRuntime } from '../../scripts/package-computer-runtime.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(platform = 'darwin', arch = 'x64') {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-package-test-'));
  roots.push(root);
  const spec = computerRuntimeSpec(platform, arch);
  const appOutDir = join(root, 'output');
  const modules = platform === 'darwin'
    ? join(appOutDir, 'Orkestrai.app/Contents/Resources/app/node_modules')
    : join(appOutDir, 'resources/app/node_modules');
  const driverDir = join(modules, '@trycua/cua-driver');
  await mkdir(driverDir, { recursive: true });
  await writeFile(join(driverDir, 'package.json'), JSON.stringify({ version: '0.28.1', optionalDependencies: { [spec.name]: '0.28.1' } }));
  const source = join(root, 'source/package');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: spec.name, version: '0.28.1', os: [platform], cpu: [arch] }));
  for (const name of [spec.library, 'cua_driver_node_runtime.node', 'node-runtime-NOTICE.md']) {
    await writeFile(join(source, name), `fixture:${arch}:${name}`);
  }
  await writeFile(join(source, 'unrelated-script.js'), 'not part of the runtime');
  const tarball = join(root, 'fixture.tgz');
  await archive({ gzip: true, file: tarball, cwd: join(root, 'source') }, ['package']);
  const bytes = await readFile(tarball);
  const entry = {
    version: '0.28.1',
    resolved: `https://registry.npmjs.org/${spec.name}/-/${spec.name.split('/')[1]}-0.28.1.tgz`,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
  const saveLock = () => writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { [`node_modules/${spec.name}`]: entry } }));
  await saveLock();
  const fetcher = vi.fn(async () => new Response(bytes));
  vi.stubGlobal('fetch', fetcher);
  return { root, spec, entry, saveLock, fetcher, destination: join(modules, spec.name), context: {
    electronPlatformName: platform, arch, appOutDir, packager: { projectDir: root, appInfo: { productFilename: 'Orkestrai' } },
  } };
}

describe('packaged Computer native runtime', () => {
  it.each([['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['win32', 'x64']])('packages the locked %s/%s binary, not the build host binary', async (platform, arch) => {
    const f = await fixture(platform, arch);
    await packageComputerRuntime(f.context);
    expect(await readFile(join(f.destination, 'cua_driver_node_runtime.node'), 'utf8')).toContain(`fixture:${arch}:`);
    expect(await readFile(join(f.destination, 'node-runtime-NOTICE.md'), 'utf8')).toContain('NOTICE');
    await expect(readFile(join(f.destination, 'unrelated-script.js'))).rejects.toMatchObject({ code: 'ENOENT' });
    await packageComputerRuntime(f.context);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps Electron Builder architecture enums and refuses unsupported targets', () => {
    expect(computerRuntimeSpec('darwin', 1).cpu).toBe('x64');
    expect(computerRuntimeSpec('darwin', 3).cpu).toBe('arm64');
    expect(() => computerRuntimeSpec('win32', 0)).toThrow('Unsupported');
    expect(() => computerRuntimeSpec('freebsd', 'x64')).toThrow('Unsupported');
  });

  it.each(['version', 'resolved', 'integrity'])('rejects an inconsistent locked %s before network access', async (key) => {
    const f = await fixture();
    f.entry[key as keyof typeof f.entry] = 'unexpected';
    await f.saveLock();
    await expect(packageComputerRuntime(f.context)).rejects.toThrow('inconsistent locked');
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('rejects tampered archives without writing a packaged runtime', async () => {
    const f = await fixture();
    f.fetcher.mockResolvedValue(new Response('tampered'));
    await expect(packageComputerRuntime(f.context)).rejects.toThrow('integrity mismatch');
    await expect(readFile(join(f.destination, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects failed downloads without extracting their response bodies', async () => {
    const f = await fixture();
    f.fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(packageComputerRuntime(f.context)).rejects.toThrow('HTTP 503');
  });
});
