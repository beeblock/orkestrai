import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let [executable, appRoot] = process.argv.slice(2);
if (!appRoot) { appRoot = executable; executable = process.execPath; }
if (!appRoot || !executable) throw new Error('Usage: run-packaged-startup-smoke.mjs [executable] <app-root>');
const executablePath = resolve(executable), applicationRoot = resolve(appRoot);
const directory = await mkdtemp(join(tmpdir(), 'orkestrai-startup-smoke-'));
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  PATH: process.env.PATH, SHELL: process.env.SHELL, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  HOME: directory, USERPROFILE: directory, APPDATA: join(directory, 'AppData/Roaming'),
  LOCALAPPDATA: join(directory, 'AppData/Local'), XDG_CONFIG_HOME: join(directory, '.config'),
  CODEX_HOME: join(directory, '.codex'), TMPDIR: directory, TMP: directory, TEMP: directory,
  ORKESTRAI_DATA_DIR: join(directory, 'data'), DB_PATH: join(directory, 'data/database.db'),
  ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '',
};
/** @type {import('node:child_process').ChildProcess | undefined} */
let child;
/** @type {NodeJS.Timeout | undefined} */
let timer;
/** @type {Error | undefined} */
let timeoutError;
try {
  const code = await new Promise((done, reject) => {
    const spawned = spawn(executablePath, ['--conditions=import', join(project, 'tests/fixtures/packaged-startup-upgrade.mjs'), applicationRoot], {
      cwd: project, env, stdio: 'inherit', windowsHide: true,
    });
    child = spawned;
    timer = setTimeout(() => { timeoutError = new Error('Packaged startup smoke exceeded three minutes'); spawned.kill('SIGTERM'); }, 180_000);
    spawned.once('error', reject);
    spawned.once('exit', code => timeoutError ? reject(timeoutError) : done(code ?? 1));
  });
  process.exitCode = typeof code === 'number' ? code : 1;
} finally {
  clearTimeout(timer);
  if (child?.exitCode === null && !child.signalCode) child.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true });
}
