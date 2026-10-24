import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const markers = {
  'test-portal-capture-lifecycle.cjs': 'portalCaptureLifecycle',
  'test-terminal-renderer-lifecycle.cjs': 'terminalRendererLifecycle',
};
const script = resolve(process.argv[2] ?? '');
const marker = markers[basename(script)];
if (!marker) throw new Error('Unknown native lifecycle fixture');
const profile = await mkdtemp(join(tmpdir(), 'orkestrai-native-lifecycle-'));
let code = 1;
try {
  const env = { ...process.env, ORKESTRAI_TEST_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), script, ...process.argv.slice(3),
  ], { env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  let pending = '', passed = false;
  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    pending = (pending + chunk.toString()).slice(-65536);
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      try { passed ||= JSON.parse(line)[marker] === 'passed'; } catch { /* Native diagnostics are not JSON. */ }
    }
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
  try {
    const exit = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', (status, signal) => done({ status, signal }));
    });
    code = exit.status === 0 && !exit.signal && passed ? 0 : 1;
    if (code) console.error('Native lifecycle failed:', { ...exit, completionMarker: passed });
  } finally { clearTimeout(timer); }
} finally {
  // Chromium holds profile files until process exit, especially on Windows.
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
process.exitCode = code;
