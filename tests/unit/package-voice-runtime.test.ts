import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as archive } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { packageVoiceRuntime } from '../../scripts/package-voice-runtime.mjs';
import { inspectVoiceRuntime, voiceBinaryCpu, voiceRuntimeSpec } from '../../scripts/voice-runtime.mjs';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function binary(platform: string, cpu: string) {
  const data = Buffer.alloc(128);
  if (platform === 'darwin') { data.writeUInt32LE(0xfeedfacf); data.writeUInt32LE(cpu === 'arm64' ? 0x100000c : 0x1000007, 4); }
  if (platform === 'linux') { data.set([127, 69, 76, 70, 2, 1]); data.writeUInt16LE(cpu === 'arm64' ? 183 : 62, 18); }
  if (platform === 'win32') { data.writeUInt16LE(0x5a4d); data.writeUInt32LE(80, 60); data.writeUInt32LE(0x4550, 80); data.writeUInt16LE(cpu === 'ia32' ? 0x14c : 0x8664, 84); }
  return data;
}

async function fixture(platform = 'darwin', cpu = 'arm64', options: { binaryCpu?: string; missing?: string; manifestCpu?: string; linkFile?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-voice-test-')); roots.push(root);
  const spec = voiceRuntimeSpec(platform, cpu);
  const output = join(root, 'output');
  const appRoot = platform === 'darwin' ? join(output, 'Orkestrai.app/Contents/Resources/app') : join(output, 'resources/app');
  const modules = join(appRoot, 'node_modules');
  await mkdir(join(modules, 'sherpa-onnx-node'), { recursive: true });
  const wrapper = { name: 'sherpa-onnx-node', version: '1.13.8', optionalDependencies: { [spec.name]: '^1.13.8' } };
  await writeFile(join(modules, 'sherpa-onnx-node/package.json'), JSON.stringify(wrapper));
  const source = join(root, 'source/package'); await mkdir(source, { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: spec.name, version: '1.13.8', os: [platform], cpu: [options.manifestCpu ?? cpu] }));
  for (const name of spec.files.filter(name => name !== 'package.json' && name !== options.missing)) {
    if (name === options.linkFile) await symlink('index.js', join(source, name));
    else await writeFile(join(source, name), spec.binaries.includes(name) ? binary(platform, options.binaryCpu ?? cpu) : 'module.exports = {};');
  }
  await writeFile(join(source, 'unrelated.js'), 'not copied');
  const tgz = join(root, 'fixture.tgz'); await archive({ gzip: true, cwd: join(root, 'source'), file: tgz }, ['package']);
  const bytes = await readFile(tgz);
  const entry = { version: '1.13.8', resolved: `https://registry.npmjs.org/${spec.name}/-/${spec.name}-1.13.8.tgz`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  const saveLock = () => writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { [`node_modules/${spec.name}`]: entry } }));
  await saveLock();
  const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal('fetch', fetcher);
  return { root, spec, modules, appRoot, entry, saveLock, fetcher, context: { electronPlatformName: platform, arch: cpu, appOutDir: output, packager: { projectDir: root, appInfo: { productFilename: 'Orkestrai' } } } };
}

describe('packaged voice native runtime', () => {
  it.each([['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['linux', 'arm64'], ['win32', 'x64'], ['win32', 'ia32']])('packages and verifies the locked %s/%s native libraries', async (platform, cpu) => {
    const f = await fixture(platform, cpu);
    await packageVoiceRuntime(f.context);
    expect(await inspectVoiceRuntime(f.appRoot, platform, cpu)).toMatchObject({ cpu, version: '1.13.8' });
    await expect(readFile(join(f.modules, f.spec.name, 'unrelated.js'))).rejects.toMatchObject({ code: 'ENOENT' });
    await packageVoiceRuntime(f.context); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not rely on the build host optional dependency being installed', async () => {
    const f = await fixture();
    await mkdir(join(f.modules, 'sherpa-onnx-darwin-x64'));
    await writeFile(join(f.modules, 'sherpa-onnx-darwin-x64/sherpa-onnx.node'), binary('darwin', 'x64'));
    await packageVoiceRuntime(f.context);
    expect(await inspectVoiceRuntime(f.appRoot, 'darwin', 'arm64')).toMatchObject({ cpu: 'arm64' });
  });
  it('maps Electron Builder architecture enums and rejects unsupported CPUs', () => {
    expect(voiceRuntimeSpec('darwin', 3).cpu).toBe('arm64');
    expect(voiceRuntimeSpec('darwin', 1).cpu).toBe('x64');
    expect(voiceRuntimeSpec('win32', 0).cpu).toBe('ia32');
    expect(() => voiceRuntimeSpec('win32', 'arm64')).toThrow('Unsupported');
    expect(() => voiceRuntimeSpec('freebsd', 'x64')).toThrow('Unsupported');
  });
  it.each(['version', 'resolved', 'integrity'])('rejects an inconsistent lock %s without downloading', async key => {
    const f = await fixture(); f.entry[key as keyof typeof f.entry] = 'wrong'; await f.saveLock();
    await expect(packageVoiceRuntime(f.context)).rejects.toThrow('Unverified locked'); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('rejects a tampered archive before touching the output', async () => {
    const f = await fixture(); f.fetcher.mockResolvedValue(new Response('tampered'));
    await expect(packageVoiceRuntime(f.context)).rejects.toThrow('integrity mismatch');
    await expect(readFile(join(f.modules, f.spec.name, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a target-named archive containing Intel binaries for Apple Silicon', async () => {
    const f = await fixture('darwin', 'arm64', { binaryCpu: 'x64' });
    await expect(packageVoiceRuntime(f.context)).rejects.toThrow('architecture mismatch');
    await expect(readFile(join(f.modules, f.spec.name, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a manifest for another CPU', async () => {
    const f = await fixture('darwin', 'arm64', { manifestCpu: 'x64' });
    await expect(packageVoiceRuntime(f.context)).rejects.toThrow('target/version mismatch');
  });
  it.each([{ missing: 'libonnxruntime.dylib' }, { linkFile: 'sherpa-onnx.node' }])('rejects missing libraries and archive symlinks: %j', async options => {
    const f = await fixture('darwin', 'arm64', options);
    await expect(packageVoiceRuntime(f.context)).rejects.toThrow();
    await expect(readFile(join(f.modules, f.spec.name, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not follow an output package symlink', async () => {
    const f = await fixture(); const outside = join(f.root, 'outside'); await mkdir(outside);
    await writeFile(join(outside, 'keep'), 'owner data'); await symlink(outside, join(f.modules, f.spec.name));
    await expect(packageVoiceRuntime(f.context)).rejects.toThrow('Invalid voice runtime destination');
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('owner data');
  });
  it('rejects failed downloads and malformed binary headers', async () => {
    const f = await fixture(); f.fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(packageVoiceRuntime(f.context)).rejects.toThrow('HTTP 503');
    expect(voiceBinaryCpu(Buffer.alloc(4), 'win32')).toBeNull();
    expect(voiceBinaryCpu(binary('linux', 'x64'), 'darwin')).toBeNull();
    const pe = binary('win32', 'x64'); pe.writeUInt32LE(0xffffffff, 60);
    expect(voiceBinaryCpu(pe, 'win32')).toBeNull();
  });
});
