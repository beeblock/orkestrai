import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** @param {string} platform @param {string | number} arch */
export function ripgrepTarget(platform, arch) {
  const cpu = typeof arch === 'number' ? new Map([[1, 'x64'], [3, 'arm64']]).get(arch) ?? '' : arch;
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(cpu)) throw new Error(`Unsupported ripgrep target: ${platform}/${arch}`);
  return { platform, cpu, name: `@vscode/ripgrep-${platform}-${cpu}`, binary: `bin/rg${platform === 'win32' ? '.exe' : ''}` };
}

/** @param {{name?:unknown,version?:unknown,os?:unknown,cpu?:unknown}} manifest @param {ReturnType<typeof ripgrepTarget>} spec @param {string} version */
export function validateRipgrepManifest(manifest, spec, version) {
  if (!manifest || typeof manifest !== 'object' || manifest.name !== spec.name || manifest.version !== version
    || !Array.isArray(manifest.os) || manifest.os.length !== 1 || manifest.os[0] !== spec.platform
    || !Array.isArray(manifest.cpu) || manifest.cpu.length !== 1 || manifest.cpu[0] !== spec.cpu) throw new Error(`Ripgrep target metadata mismatch: ${spec.name}`);
}

/** @param {string} file @param {ReturnType<typeof ripgrepTarget>} spec */
export async function inspectRipgrepBinary(file, spec) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 64 || info.size > 64 * 1024 * 1024) throw new Error('Invalid ripgrep executable file');
  if (spec.platform !== 'win32' && process.platform !== 'win32' && !(info.mode & 0o111)) throw new Error('Ripgrep file is not executable');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const bytes = Buffer.alloc(Math.min(info.size, 4096));
    await handle.read(bytes, 0, bytes.length, 0);
    let valid = false;
    if (spec.platform === 'darwin') valid = bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === (spec.cpu === 'arm64' ? 0x0100000c : 0x01000007);
    if (spec.platform === 'linux') valid = bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === (spec.cpu === 'arm64' ? 183 : 62);
    if (spec.platform === 'win32' && bytes.readUInt16LE(0) === 0x5a4d) {
      const offset = bytes.readUInt32LE(0x3c);
      valid = offset <= bytes.length - 6 && bytes.readUInt32LE(offset) === 0x00004550 && bytes.readUInt16LE(offset + 4) === (spec.cpu === 'arm64' ? 0xaa64 : 0x8664);
    }
    if (!valid) throw new Error(`Ripgrep executable architecture mismatch: ${spec.platform}/${spec.cpu}`);
  } finally { await handle.close(); }
}

/** @param {string} appRoot @param {string} platform @param {string | number} arch */
export async function inspectRipgrepRuntime(appRoot, platform, arch) {
  const spec = ripgrepTarget(platform, arch);
  const root = await realpath(resolve(appRoot));
  const modules = join(root, 'node_modules');
  const wrapper = join(modules, '@vscode/ripgrep');
  if (await realpath(wrapper) !== wrapper) throw new Error('Ripgrep wrapper must be contained in the packaged app');
  const parent = JSON.parse(await readFile(join(wrapper, 'package.json'), 'utf8'));
  const directory = join(modules, spec.name);
  const resolved = await realpath(directory);
  if (resolved !== directory || !resolved.startsWith(modules + sep)) throw new Error('Ripgrep must be contained in the packaged app');
  const target = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (parent.name !== '@vscode/ripgrep' || !/^\d+\.\d+\.\d+$/.test(parent.version ?? '') || parent.optionalDependencies?.[spec.name] !== parent.version) throw new Error('Invalid packaged ripgrep wrapper');
  validateRipgrepManifest(target, spec, parent.version);
  const binary = join(directory, spec.binary);
  if (await realpath(binary) !== binary) throw new Error('Ripgrep executable must be contained in the packaged app');
  await inspectRipgrepBinary(binary, spec);
  return { ...spec, directory, binary, version: parent.version };
}
