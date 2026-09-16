import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x as extract } from 'tar';

export function computerRuntimeSpec(platform, arch) {
  const cpu = typeof arch === 'number' ? ({ 1: 'x64', 3: 'arm64' })[arch] : arch;
  const suffix = { darwin: '', linux: '-gnu', win32: '-msvc' }[platform];
  if (!['x64', 'arm64'].includes(cpu) || suffix === undefined) {
    throw new Error(`Unsupported Computer runtime target: ${platform}/${arch}`);
  }
  return {
    name: `@trycua/cua-driver-${platform}-${cpu}${suffix}`,
    platform,
    cpu,
    library: { darwin: 'libcua_driver_sdk.dylib', linux: 'libcua_driver_sdk.so', win32: 'cua_driver_sdk.dll' }[platform],
  };
}

export async function packageComputerRuntime(context) {
  const spec = computerRuntimeSpec(context.electronPlatformName, context.arch);
  const project = context.packager.projectDir;
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const modules = join(resources, 'app', 'node_modules');
  const driver = JSON.parse(await readFile(join(modules, '@trycua/cua-driver/package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${spec.name}`];
  const expectedUrl = `https://registry.npmjs.org/${spec.name}/-/${spec.name.split('/')[1]}-${driver.version}.tgz`;
  if (!entry || entry.version !== driver.version || driver.optionalDependencies?.[spec.name] !== entry.version
    || entry.resolved !== expectedUrl || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? '')) {
    throw new Error(`Missing or inconsistent locked Computer runtime: ${spec.name}`);
  }
  const digest = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const cache = join(project, 'node_modules/.cache/orkestrai-computer-runtime');
  const archive = join(cache, `${spec.name.split('/')[1]}-${entry.version}.tgz`);
  let bytes = await readFile(archive).catch(() => null);
  if (!bytes || digest(bytes) !== entry.integrity) {
    const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Unable to download Computer runtime: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== entry.integrity) throw new Error(`Computer runtime integrity mismatch: ${spec.name}`);
    await mkdir(cache, { recursive: true });
    await writeFile(archive, bytes);
  }

  const staging = await mkdtemp(join(tmpdir(), 'orkestrai-computer-package-'));
  const files = ['package.json', spec.library, 'cua_driver_node_runtime.node', 'node-runtime-NOTICE.md'];
  try {
    // Cross-architecture packaging does not install npm's missing optional binaries.
    // Extract only regular files from the exact archive pinned by the lockfile.
    await extract({ file: archive, cwd: staging, strip: 1, strict: true,
      filter: (path, item) => item.type === 'File' && files.some((name) => path === `package/${name}`),
    });
    const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'));
    if (manifest.name !== spec.name || manifest.version !== entry.version
      || !manifest.os?.includes(spec.platform) || !manifest.cpu?.includes(spec.cpu)) {
      throw new Error(`Computer runtime target mismatch: ${spec.name}`);
    }
    for (const name of files) {
      if (!(await stat(join(staging, name))).size) throw new Error(`Empty Computer runtime file: ${name}`);
    }
    const destination = join(modules, spec.name);
    await mkdir(destination, { recursive: true });
    for (const name of files) await copyFile(join(staging, name), join(destination, name));
    console.log(`Computer runtime packaged: ${spec.name}@${entry.version}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
