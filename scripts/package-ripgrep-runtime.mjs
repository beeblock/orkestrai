import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { x as extract } from 'tar';
import { inspectRipgrepBinary, inspectRipgrepRuntime, ripgrepTarget, validateRipgrepManifest } from './ripgrep-runtime.mjs';

const MAX_ARCHIVE = 32 * 1024 * 1024;
/** @param {Uint8Array} bytes */
const digest = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

/** Provision the target CPU, including ARM64 packages built on Intel hosts. */
/** @param {{electronPlatformName:string,arch:string|number,appOutDir:string,packager:{projectDir:string,appInfo:{productFilename:string}}}} context */
export async function packageRipgrepRuntime(context) {
  const spec = ripgrepTarget(context.electronPlatformName, context.arch);
  const resources = spec.platform === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
    : join(context.appOutDir, 'resources');
  const appRoot = join(resources, 'app');
  const modules = join(appRoot, 'node_modules');
  const wrapper = JSON.parse(await readFile(join(modules, '@vscode/ripgrep/package.json'), 'utf8'));
  const project = context.packager.projectDir;
  const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${spec.name}`];
  const url = `https://registry.npmjs.org/${spec.name}/-/${spec.name.split('/')[1]}-${wrapper.version}.tgz`;
  if (wrapper.name !== '@vscode/ripgrep' || !/^\d+\.\d+\.\d+$/.test(wrapper.version ?? '') || !entry || entry.version !== wrapper.version
    || wrapper.optionalDependencies?.[spec.name] !== entry.version || entry.resolved !== url
    || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? '')) throw new Error(`Unverified ripgrep package: ${spec.name}`);
  const cache = join(project, 'node_modules/.cache/orkestrai-ripgrep-runtime');
  const archive = join(cache, `${spec.name.split('/')[1]}-${entry.version}.tgz`);
  for (const path of [join(project, 'node_modules'), join(project, 'node_modules/.cache'), cache, archive]) {
    const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing?.isSymbolicLink()) throw new Error('Ripgrep cache must not be a symbolic link');
  }
  const cached = await lstat(archive).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  let bytes = cached?.isFile() && cached.size <= MAX_ARCHIVE ? await readFile(archive) : null;
  if (!bytes || digest(bytes) !== entry.integrity) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > MAX_ARCHIVE) throw new Error(`Unable to download ripgrep package: HTTP ${response.status}`);
    /** @type {Uint8Array[]} */
    const chunks = []; let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_ARCHIVE) { await reader.cancel(); throw new Error('Ripgrep archive exceeds its size limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    bytes = Buffer.concat(chunks);
    if (digest(bytes) !== entry.integrity) throw new Error(`Ripgrep integrity mismatch: ${spec.name}`);
    await mkdir(cache, { recursive: true });
    const temporary = `${archive}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, archive); }
    finally { await rm(temporary, { force: true }); }
  }
  const staging = await mkdtemp(join(tmpdir(), 'orkestrai-ripgrep-package-'));
  const files = ['package.json', 'LICENSE', spec.binary];
  try {
    // Extract only the bytes whose digest was verified, never a mutable cache path.
    const verified = join(staging, 'verified.tgz');
    await writeFile(verified, bytes, { flag: 'wx', mode: 0o600 });
    await extract({ file: verified, cwd: staging, strip: 1, strict: true, filter: (path, item) => {
      if (!('type' in item) || item.type !== 'File' || !files.some(file => path === `package/${file}`)) return false;
      if (typeof item.size !== 'number' || item.size > 64 * 1024 * 1024) throw new Error('Oversized ripgrep package entry');
      return true;
    } });
    validateRipgrepManifest(JSON.parse(await readFile(join(staging, 'package.json'), 'utf8')), spec, entry.version);
    await inspectRipgrepBinary(join(staging, spec.binary), spec);
    for (const file of files) if (!(await stat(join(staging, file))).isFile()) throw new Error('Missing ripgrep runtime file');
    const destination = join(modules, spec.name);
    // Never follow an existing output link back into the checkout or another app.
    for (const path of [modules, join(modules, '@vscode'), destination, join(destination, 'bin'), ...files.map(file => join(destination, file))]) {
      const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing?.isSymbolicLink()) throw new Error('Ripgrep output must not be a symbolic link');
    }
    for (const file of files) {
      const target = join(destination, file);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await copyFile(join(staging, file), temporary); await rename(temporary, target); }
      finally { await rm(temporary, { force: true }); }
    }
    await chmod(join(destination, spec.binary), 0o755);
    await inspectRipgrepRuntime(appRoot, spec.platform, spec.cpu);
    console.log(`Code search runtime packaged: ${spec.name}@${entry.version}`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
