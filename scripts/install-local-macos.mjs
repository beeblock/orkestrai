#!/usr/bin/env node
/** Verified local installation, with a compact rollback outside LaunchServices. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
async function run(command, args) {
  return (await exec(command, args, { maxBuffer: 2 * 1024 * 1024 })).stdout;
}

export async function installLocalMacos(source, options = {}) {
  const execute = options.run ?? run;
  const applications = options.applications ?? '/Applications';
  const cache = options.cache ?? join(homedir(), 'Library/Caches/Orkestrai/local-install');
  const installed = join(applications, 'Orkestrai.app');
  const candidate = resolve(source);
  if (candidate === installed || !candidate.endsWith('/Orkestrai.app') || !(await lstat(candidate)).isDirectory()) {
    throw new Error('Provide an unpacked Orkestrai.app directory distinct from the installed app.');
  }
  const version = JSON.parse(await readFile(join(candidate, 'Contents/Resources/app/package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version ?? '')) throw new Error('Candidate version is invalid.');
  const identifier = await execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(candidate, 'Contents/Info.plist')]);
  if (identifier.trim() !== 'com.orkestrai.desktop') throw new Error('Candidate is not the Orkestrai desktop bundle.');
  const binary = await execute('/usr/bin/file', [join(candidate, 'Contents/MacOS/Orkestrai')]);
  if (!binary.includes(options.arch ?? (process.arch === 'arm64' ? 'arm64' : 'x86_64'))) throw new Error('Candidate architecture does not match this Mac.');
  await mkdir(cache, { recursive: true });
  if ((await lstat(cache)).isSymbolicLink()) throw new Error('Rollback cache must not be a symbolic link.');
  const disk = await (options.statfs ?? statfs)(cache);
  if (disk.bavail * disk.bsize < 3 * 1024 ** 3) throw new Error('At least 3 GiB free is required for a verified copy and compact rollback.');
  // No live .app backup remains under /Applications, even during verification.
  const stage = await mkdtemp(join(cache, 'staging-'));
  const staged = join(stage, 'Orkestrai.app');
  const previous = join(stage, 'previous.app');
  let swapped = false;
  let confirmed = false;
  let hasPrevious = false;
  try {
    await execute('/usr/bin/ditto', ['--rsrc', '--extattr', candidate, staged]);
    // Await BOTH copying and signature verification; never open a partial copy.
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    await execute(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), 'validate-macos-permissions.mjs'), staged]);
    const processes = await execute('/bin/ps', ['-axo', 'pid=,comm=']);
    if (processes.split('\n').some(line => line.includes(`${installed}/Contents/`))) {
      throw new Error('Close Orkestrai and wait for its Core/helpers to exit before replacing the app.');
    }
    const old = await lstat(installed).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (old?.isSymbolicLink() || (old && !old.isDirectory())) throw new Error('Installed app target is not a regular bundle directory.');
    if (old) { await rename(installed, previous); hasPrevious = true; }
    await rename(staged, installed);
    swapped = true;
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
    await execute(lsregister, ['-f', installed]);
    await execute('/usr/bin/open', ['-n', installed]);
    await (options.health ?? waitForInstalledCore)(version, installed);
    confirmed = true;
    if (hasPrevious) {
      const archive = join(cache, `rollback-${version}-${Date.now()}.zip`);
      await execute('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', previous, archive]);
      await execute('/usr/bin/unzip', ['-tqq', archive]);
      // Archive succeeded and the replacement is healthy: old bundle is recoverable.
      await rm(previous, { recursive: true });
      const archives = (await readdir(cache)).filter(name => /^rollback-\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?-\d+\.zip$/.test(name)).sort((a, b) => Number(b.match(/-(\d+)\.zip$/)[1]) - Number(a.match(/-(\d+)\.zip$/)[1]));
      for (const name of archives.slice(1)) {
        const target = join(cache, name);
        if ((await lstat(target)).isFile()) await rm(target);
      }
    }
    await rm(stage, { recursive: true });
    return { version, installed, rollback: hasPrevious ? cache : null };
  } catch (error) {
    // A failed health check may leave a process running. Never remove a live bundle.
    const processes = swapped ? await execute('/bin/ps', ['-axo', 'pid=,comm=']).catch(() => null) : '';
    const live = processes === null || processes.split('\n').some(line => line.includes(`${installed}/Contents/`));
    if (!confirmed && !live) {
      if (swapped) await rm(installed, { recursive: true });
      if (hasPrevious) await rename(previous, installed);
      await execute(lsregister, ['-f', installed]).catch(() => {});
      await rm(stage, { recursive: true });
    } else if (!hasPrevious) await rm(stage, { recursive: true });
    // Preserve a rollback on any uncertain startup or archive failure.
    throw new Error(`${error.message}${hasPrevious && (live || confirmed) ? `; recoverable previous bundle: ${previous}` : ''}`);
  }
}

async function waitForInstalledCore(version, installed) {
  const deadline = Date.now() + 90_000;
  const runtimePath = join(homedir(), '.orkestrai/runtime.json');
  while (Date.now() < deadline) {
    try {
      const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
      const executable = await run('/bin/ps', ['-p', String(runtime.pid), '-o', 'comm=']);
      const url = new URL(runtime.apiUrl);
      if (runtime.version === version && executable.trim() === join(installed, 'Contents/MacOS/Orkestrai')
        && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        const response = await fetch(new URL('/api/agent-room/settings', url), { signal: AbortSignal.timeout(3000) });
        if (response.ok) return;
      }
    } catch { /* Cold boot may still be initializing. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  throw new Error('Installed Core did not report the expected executable/version and healthy API.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin' || !process.argv[2]) throw new Error('Usage on macOS: node scripts/install-local-macos.mjs /exact/path/Orkestrai.app');
  console.log(JSON.stringify(await installLocalMacos(process.argv[2])));
}
