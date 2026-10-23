import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export function voiceRuntimeSpec(platform, arch) {
  const cpu = typeof arch === 'number' ? ({ 0: 'ia32', 1: 'x64', 3: 'arm64' })[arch] : arch;
  const supported = { darwin: ['x64', 'arm64'], linux: ['x64', 'arm64'], win32: ['x64', 'ia32'] };
  if (!supported[platform]?.includes(cpu)) throw new Error(`Unsupported voice runtime target: ${platform}/${arch}`);
  const libraries = platform === 'darwin'
    ? ['libonnxruntime.dylib', 'libsherpa-onnx-c-api.dylib', 'libsherpa-onnx-cxx-api.dylib']
    : platform === 'linux'
      ? ['libonnxruntime.so', 'libsherpa-onnx-c-api.so', 'libsherpa-onnx-cxx-api.so']
      : ['onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll'];
  return { platform, cpu, name: `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${cpu}`,
    binaries: ['sherpa-onnx.node', ...libraries], files: ['package.json', 'README.md', 'index.js', 'sherpa-onnx.node', ...libraries] };
}

export function voiceBinaryCpu(header, platform) {
  if (platform === 'darwin' && header.length >= 8 && header.readUInt32LE(0) === 0xfeedfacf) {
    return ({ 16777223: 'x64', 16777228: 'arm64' })[header.readUInt32LE(4)] ?? null;
  }
  if (platform === 'linux' && header.length >= 20 && header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) && header[4] === 2 && header[5] === 1) {
    return ({ 62: 'x64', 183: 'arm64' })[header.readUInt16LE(18)] ?? null;
  }
  if (platform === 'win32' && header.length >= 64 && header.readUInt16LE(0) === 0x5a4d) {
    const offset = header.readUInt32LE(60);
    if (offset + 6 <= header.length && header.readUInt32LE(offset) === 0x4550) return ({ 332: 'ia32', 34404: 'x64' })[header.readUInt16LE(offset + 4)] ?? null;
  }
  return null;
}

export async function validateVoiceBinary(path, spec) {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const cpu = voiceBinaryCpu(header.subarray(0, bytesRead), spec.platform);
    if (cpu !== spec.cpu) throw new Error(`Voice binary architecture mismatch: ${path} (expected ${spec.platform}/${spec.cpu}, found ${cpu ?? 'invalid'})`);
  } finally { await handle.close(); }
}

export async function inspectVoiceRuntime(appRoot, platform, arch) {
  const spec = voiceRuntimeSpec(platform, arch);
  const modules = join(resolve(appRoot), 'node_modules');
  const directory = join(modules, spec.name);
  const canonicalModules = await realpath(modules);
  const canonicalDirectory = await realpath(directory);
  if (canonicalModules !== join(await realpath(appRoot), 'node_modules') || (await lstat(modules)).isSymbolicLink()
    || canonicalDirectory !== join(canonicalModules, spec.name) || !(await lstat(directory)).isDirectory()) throw new Error('Voice runtime escapes packaged modules');
  const wrapperDirectory = join(modules, 'sherpa-onnx-node');
  if (!(await lstat(wrapperDirectory)).isDirectory() || await realpath(wrapperDirectory) !== join(canonicalModules, 'sherpa-onnx-node')
    || !(await lstat(join(wrapperDirectory, 'package.json'))).isFile()) throw new Error('Invalid packaged voice wrapper');
  const wrapper = JSON.parse(await readFile(join(modules, 'sherpa-onnx-node/package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (wrapper.name !== 'sherpa-onnx-node' || manifest.name !== spec.name || manifest.version !== wrapper.version || !manifest.os?.includes(spec.platform) || !manifest.cpu?.includes(spec.cpu)) throw new Error(`Voice runtime target/version mismatch: ${spec.name}`);
  for (const name of spec.files) {
    const file = join(directory, name);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || !(await realpath(file)).startsWith(canonicalDirectory + sep)) throw new Error(`Invalid voice runtime file: ${name}`);
  }
  for (const name of spec.binaries) await validateVoiceBinary(join(directory, name), spec);
  return { ...spec, version: manifest.version, directory };
}
