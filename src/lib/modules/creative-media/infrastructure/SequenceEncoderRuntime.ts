import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile, writeFile, readdir, chmod, rename, statfs, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { CreativeMediaError } from '../domain/types.js';

const MR = 'https://ffmpeg.martin-riedl.de/download/macos';
const BT = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-17-13-19';
type Archive = { url: string; sha256: string; prefix?: string };
export const SEQUENCE_ENCODERS: Record<string, Archive[]> = {
  'darwin-arm64': [
    { url: `${MR}/arm64/1787073674_9.0.1/ffmpeg.zip`, sha256: '8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe' },
    { url: `${MR}/arm64/1787073674_9.0.1/ffprobe.zip`, sha256: '102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a' },
  ],
  'darwin-x64': [
    { url: `${MR}/amd64/1787081194_9.0.1/ffmpeg.zip`, sha256: '5bdead62ff504ab9b447cc72b212c4fb481e3f7de5877d427a51bee8136dda40' },
    { url: `${MR}/amd64/1787081194_9.0.1/ffprobe.zip`, sha256: '34511bbcf1988ad2886023bf5ace4f44cf62e6defeb3d194d6f7619e5b061f7f' },
  ],
  ...Object.fromEntries([
    ['linux-x64', 'linux64', 'tar.xz', 'ec8bec251b59a9ff403f18d5406ced004abea7d978d53ef3ad693720f9864089'],
    ['linux-arm64', 'linuxarm64', 'tar.xz', '177852d56f3971f8b4490a392a0ff6e590d9b17d2bcaf2fda400f493e574aed2'],
    ['win32-x64', 'win64', 'zip', '0182996f8e5009885cd67b7eb9fccf44ccf02583a36e04be3acf32c655466aa4'],
    ['win32-arm64', 'winarm64', 'zip', 'd8652294c4f131cab58fa2d3a37462f0ec1144f85a35ad19df88159c9f450375'],
  ].map(([platform, arch, extension, sha256]) => {
    const prefix = `ffmpeg-n9.0.1-69-g3e11912860-${arch}-gpl-9.0`;
    return [platform, [{ url: `${BT}/${prefix}.${extension}`, sha256, prefix }]];
  })),
};
export const encoderRoot = () => resolve(process.env.ORKESTRAI_DATA_DIR ?? join(process.cwd(), 'storage'), 'creative-encoder', '9.0.1-r1');
export async function hashFile(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export function encoderProcess(binary: string, args: string[], options: { cwd?: string; signal?: AbortSignal; timeout?: number; onProgress?: (text: string) => void } = {}): Promise<string> {
  return new Promise((resolveResult, reject) => {
    if (options.signal?.aborted) { reject(new CreativeMediaError('creative_sequence_cancelled')); return; }
    let stdout = '', settled = false, aborted = false, forced = false, abortTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(binary, args, { cwd: options.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? 30000);
    const abort = () => { aborted = true; child.kill('SIGTERM'); abortTimer = setTimeout(() => child.kill('SIGKILL'), 1000); };
    options.signal?.addEventListener('abort', abort, { once: true });
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(abortTimer); options.signal?.removeEventListener('abort', abort); error ? reject(error) : resolveResult(stdout); };
    child.stdout.on('data', chunk => { const value = String(chunk); if (stdout.length + value.length > 1024 * 1024) { forced = true; child.kill('SIGKILL'); return; } stdout += value; options.onProgress?.(value); });
    child.stderr.resume();
    child.once('error', () => finish(new CreativeMediaError(options.signal?.aborted ? 'creative_sequence_cancelled' : 'creative_sequence_encoder_failed')));
    // Wait for close before deleting intermediate files, including on cancellation.
    child.once('close', code => finish(code === 0 && !aborted && !forced ? undefined : new CreativeMediaError(aborted ? 'creative_sequence_cancelled' : 'creative_sequence_encoder_failed')));
    // Decoder diagnostics can include private paths. Never persist or return stderr.
  });
}
type RuntimeState = { pending?: Promise<unknown>; error?: string };
const global = globalThis as typeof globalThis & { __orkestraiSequenceRuntime?: RuntimeState };
const state = global.__orkestraiSequenceRuntime ??= {};
export class SequenceEncoderRuntime {
  constructor(readonly root = encoderRoot(), readonly platform = `${process.platform}-${process.arch}`) {}
  async binaries(verify = false) {
    try {
      const manifest = JSON.parse(await readFile(join(this.root, 'installed.json'), 'utf8'));
      if (manifest.platform !== this.platform || !SEQUENCE_ENCODERS[this.platform]) return null;
      const paths: Record<string, string> = {};
      for (const name of ['ffmpeg', 'ffprobe']) {
        const item = manifest[name];
        if (!item || !/^[a-f0-9]{64}$/.test(item.hash) || item.path.includes('..') || !['ffmpeg', 'ffprobe', 'ffmpeg.exe', 'ffprobe.exe'].includes(basename(item.path))) return null;
        const path = resolve(this.root, item.path);
        if (!path.startsWith(`${this.root}/`) && !path.startsWith(`${this.root}\\`)) return null;
        const handle = await open(path, 'r'); const info = await handle.stat(); await handle.close();
        if (!info.isFile() || (verify && await hashFile(path) !== item.hash)) return null;
        paths[name] = path;
      }
      return paths as { ffmpeg: string; ffprobe: string };
    } catch { return null; }
  }
  async status() { return { installed: !!await this.binaries(), installing: !!state.pending, supported: !!SEQUENCE_ENCODERS[this.platform], version: '9.0.1', license: 'GPL-3.0-or-later', sourceUrl: this.platform.startsWith('darwin') ? 'https://git.martin-riedl.de/ffmpeg/build-script' : 'https://github.com/BtbN/FFmpeg-Builds', error: state.error ?? null }; }
  async require() { const binaries = await this.binaries(true); if (!binaries) throw new CreativeMediaError('creative_sequence_runtime_required'); return binaries; }
  startInstall() {
    if (!SEQUENCE_ENCODERS[this.platform]) throw new CreativeMediaError('creative_sequence_platform_unsupported');
    if (!state.pending) {
      state.error = undefined;
      state.pending = this.install().catch(() => { state.error = 'creative_sequence_runtime_failed'; }).finally(() => { state.pending = undefined; });
    }
    return this.status();
  }
  async install() {
    const archives = SEQUENCE_ENCODERS[this.platform];
    if (!archives) throw new CreativeMediaError('creative_sequence_platform_unsupported');
    if (await this.binaries(true)) return;
    const parent = resolve(this.root, '..'); await mkdir(parent, { recursive: true });
    const disk = await statfs(parent); if (disk.bavail * disk.bsize < 3 * 1024 ** 3) throw new CreativeMediaError('creative_sequence_disk_full');
    const staging = await mkdtemp(join(parent, '.install-'));
    try {
      for (const [index, archive] of archives.entries()) {
        const response = await fetch(archive.url, { signal: AbortSignal.timeout(300000) });
        if (!response.ok || !response.body) throw new Error('download');
        const temporary = join(staging, `${index}.archive`), handle = await open(temporary, 'wx', 0o600);
        let size = 0; const hash = createHash('sha256');
        try { for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 450 * 1024 ** 2) throw new Error('size'); hash.update(chunk); await handle.writeFile(chunk); } }
        finally { await handle.close(); }
        if (hash.digest('hex') !== archive.sha256) throw new Error('integrity');
        // Same system tar used by embedded voice: bsdtar on macOS, tar.exe on
        // Windows 10+, GNU tar on Linux. Extract only pinned executable members.
        const suffix = this.platform.startsWith('win32') ? '.exe' : '';
        const members = archive.prefix ? [`${archive.prefix}/bin/ffmpeg${suffix}`, `${archive.prefix}/bin/ffprobe${suffix}`] : [archive.url.endsWith('/ffprobe.zip') ? 'ffprobe' : 'ffmpeg'];
        await encoderProcess('tar', ['-xf', temporary, '-C', staging, ...members], { timeout: 180000 });
        await rm(temporary);
      }
      const manifest: Record<string, unknown> = { platform: this.platform, archives };
      async function find(directory: string, name: string, depth = 0): Promise<string | null> {
        if (depth > 3) return null;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.isFile() && entry.name === name) return join(directory, entry.name);
          if (entry.isDirectory()) { const value = await find(join(directory, entry.name), name, depth + 1); if (value) return value; }
        } return null;
      }
      for (const name of ['ffmpeg', 'ffprobe']) {
        const path = await find(staging, name + (this.platform.startsWith('win32') ? '.exe' : ''));
        if (!path) throw new Error('missing');
        await chmod(path, 0o700); await encoderProcess(path, ['-version']);
        manifest[name] = { path: path.slice(staging.length + 1), hash: await hashFile(path) };
      }
      await writeFile(join(staging, 'installed.json'), JSON.stringify(manifest), { mode: 0o600 });
      await writeFile(join(staging, 'NOTICE.txt'), 'FFmpeg 9.0.1: separately downloaded executable, GPL-3.0-or-later.\nhttps://ffmpeg.org/legal.html\nSources and build recipes: https://git.martin-riedl.de/ffmpeg/build-script and https://github.com/BtbN/FFmpeg-Builds\nArchive URLs and integrity hashes are recorded in installed.json.\n');
      await rm(this.root, { recursive: true, force: true }); await rename(staging, this.root);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}
export const sequenceEncoderRuntime = new SequenceEncoderRuntime();
