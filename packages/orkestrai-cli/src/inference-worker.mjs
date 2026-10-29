/** Parent-owned worker broker. Losing the Core IPC connection terminates the provider tree. */
import { spawn } from 'node:child_process';
import { rm, realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
let child, stopping = false, directory, killTimer, ownsDirectory = false;
async function cleanup() {
  if (!ownsDirectory || !directory || !basename(directory).startsWith('orkestrai-inference-')) return;
  try { if (await realpath(dirname(directory)) === await realpath(tmpdir())) await rm(directory, { recursive: true, force: true }); } catch {}
}
function signalTree(signal) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid',String(child.pid),'/T','/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill());
  } else { try { process.kill(-child.pid, signal); } catch { child.kill(signal); } }
}
function stop() {
  if (stopping) return; stopping = true;
  if (!child) { void cleanup().finally(() => process.exit(1)); return; }
  signalTree('SIGTERM'); killTimer = setTimeout(() => signalTree('SIGKILL'), 500); killTimer.unref();
}
process.once('disconnect', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop);
process.once('message', config => {
  if (stopping || !config || typeof config.command !== 'string' || !Array.isArray(config.args) || typeof config.cwd !== 'string' || !config.env || typeof config.env !== 'object') { stop(); return; }
  directory = config.cwd;
  ownsDirectory = config.cleanupDirectory === true;
  child = spawn(config.command, config.args, { cwd: directory, env: config.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe','pipe','pipe'] });
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.stdin.on('error', () => {}); process.stdout.on('error', stop); process.stderr.on('error', stop);
  let finished = false;
  const finish = async code => {
    if (finished) return; finished = true; clearTimeout(killTimer);
    // The provider can exit before a surviving child. Its private process group still belongs to us.
    signalTree('SIGKILL'); await cleanup();
    if (process.connected) process.disconnect(); process.stdin.destroy(); process.exitCode = typeof code === 'number' ? code : 1;
  };
  child.once('error', () => { void finish(1); }); child.once('close', code => { void finish(code); });
});
