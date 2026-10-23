import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { x as extract } from 'tar';
import { inspectVoiceRuntime, voiceRuntimeSpec } from './voice-runtime.mjs';

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const digest = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

export async function packageVoiceRuntime(context) {
  const spec = voiceRuntimeSpec(context.electronPlatformName, context.arch);
  const product = context.packager.appInfo.productFilename;
  if (!product || product !== basename(product) || ['.', '..'].includes(product)) throw new Error('Invalid packaged product name');
  const resources = spec.platform === 'darwin' ? join(context.appOutDir, `${product}.app/Contents/Resources`) : join(context.appOutDir, 'resources');
  const appRoot = join(resources, 'app');
  const modules = join(appRoot, 'node_modules');
  const moduleStat = await lstat(modules);
  if (!moduleStat.isDirectory() || moduleStat.isSymbolicLink() || await realpath(modules) !== join(await realpath(appRoot), 'node_modules')) throw new Error('Packaged voice module directory must not be a symlink');
  const wrapper = JSON.parse(await readFile(join(modules, 'sherpa-onnx-node/package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(context.packager.projectDir, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${spec.name}`];
  const url = `https://registry.npmjs.org/${spec.name}/-/${spec.name}-${wrapper.version}.tgz`;
  if (wrapper.name !== 'sherpa-onnx-node' || !/^\d+\.\d+\.\d+$/.test(wrapper.version) || !entry || entry.version !== wrapper.version || ![entry.version, `^${entry.version}`, `~${entry.version}`].includes(wrapper.optionalDependencies?.[spec.name])
    || entry.resolved !== url || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? '')) throw new Error(`Unverified locked voice runtime: ${spec.name}`);
  const cache = join(context.packager.projectDir, 'node_modules/.cache/orkestrai-voice-runtime');
  const archive = join(cache, `${spec.name}-${entry.version}.tgz`);
  const cached = await lstat(archive).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  let bytes = cached?.isFile() && cached.size <= MAX_ARCHIVE_BYTES ? await readFile(archive) : null;
  if (!bytes || digest(bytes) !== entry.integrity) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Unable to download voice runtime: HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) throw new Error('Voice archive exceeds size limit');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    if (digest(bytes) !== entry.integrity) throw new Error(`Voice runtime integrity mismatch: ${spec.name}`);
    await mkdir(cache, { recursive: true });
    await writeFile(archive, bytes);
  }
  const staging = await mkdtemp(join(tmpdir(), 'orkestrai-voice-package-'));
  try {
    const stagedModules = join(staging, 'node_modules');
    const staged = join(stagedModules, spec.name);
    await mkdir(staged, { recursive: true });
    await mkdir(join(stagedModules, 'sherpa-onnx-node'));
    await writeFile(join(stagedModules, 'sherpa-onnx-node/package.json'), JSON.stringify(wrapper));
    await extract({ file: archive, cwd: staged, strip: 1, strict: true,
      filter: (path, item) => item.type === 'File' && item.size <= MAX_ARCHIVE_BYTES && spec.files.some(name => path === `package/${name}`),
    });
    // Validate every native library and destination before writing the output bundle.
    await inspectVoiceRuntime(staging, spec.platform, spec.cpu);
    const destination = join(modules, spec.name);
    const existing = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Invalid voice runtime destination');
    for (const name of spec.files) {
      const target = await lstat(join(destination, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (target && (!target.isFile() || target.isSymbolicLink())) throw new Error(`Invalid voice output file: ${name}`);
    }
    await mkdir(destination, { recursive: true });
    for (const name of spec.files) await copyFile(join(staged, name), join(destination, name));
    await inspectVoiceRuntime(appRoot, spec.platform, spec.cpu);
    console.log(`Voice runtime packaged: ${spec.name}@${entry.version}`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
