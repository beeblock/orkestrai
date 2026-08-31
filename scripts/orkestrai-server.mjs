#!/usr/bin/env node
/**
 * Servidor de producao do Orkestrai: HTTP (handler do adapter-node) +
 * WebSocket de PTY no mesmo processo/porta.
 *
 * Usado pelo Electron (electron/main.cjs) e por `npm run start`.
 * Requer `npm run build` antes. Roda com Node 24+ (type stripping para os
 * modulos .ts do PTY).
 */
import http from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { installOrkestraiShim, writeOrkestraiRuntimeFile } from './install-orkestrai-shim.mjs';

// App Electron aberto pelo Finder recebe um PATH minimo do macOS; sem os
// locais comuns de CLIs a deteccao e o spawn dos agentes falham com ENOENT.
// Estrategia em camadas: PATH do login shell do usuario (cobre nvm, mise,
// shims e setups custom) + diretorios conhecidos + globs do nvm.
async function pathFromLoginShell() {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const shell = process.env.SHELL ?? '/bin/zsh';
    const { stdout } = await promisify(execFile)(shell, ['-l', '-c', 'echo $PATH'], { timeout: 5_000 });
    return stdout.trim().split(delimiter).filter(Boolean);
  } catch {
    return [];
  }
}

function nvmBins() {
  try {
    const root = `${homedir()}/.nvm/versions/node`;
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${root}/${entry.name}/bin`)
      .filter((dir) => existsSync(dir));
  } catch {
    return [];
  }
}

{
  const staticExtras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    `${homedir()}/.local/bin`,
    `${homedir()}/.bun/bin`,
    `${homedir()}/.volta/bin`,
    `${homedir()}/.deno/bin`,
    `${homedir()}/.cargo/bin`,
    `${homedir()}/.npm-global/bin`,
    `${homedir()}/.kimi-code/bin`,
    `${homedir()}/bin`,
  ];
  const merged = new Set([
    ...(await pathFromLoginShell()),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...staticExtras,
    ...nvmBins(),
  ]);
  process.env.PATH = [...merged].join(delimiter);
}

function markPrivateChildEnv(...keys) {
  const current = (process.env.ORKESTRAI_PRIVATE_ENV_KEYS ?? '').split(',').filter(Boolean);
  process.env.ORKESTRAI_PRIVATE_ENV_KEYS = [...new Set([...current, ...keys.filter(Boolean)])].join(',');
}

// Carrega .env do projeto sem sobrescrever variaveis ja definidas
// (o handler do adapter-node nao carrega .env sozinho).
const dotEnvPath = resolve('.env');
const dotEnvKeys = [];
if (existsSync(dotEnvPath)) {
  for (const line of readFileSync(dotEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    dotEnvKeys.push(match[1]);
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

// Diretorio de dados do app empacotado (userData): o SQLite e os arquivos
// de runtime nao podem ficar dentro do asar (somente leitura).
if (process.env.ORKESTRAI_DATA_DIR) {
  const dataDir = process.env.ORKESTRAI_DATA_DIR;
  mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.DB_PATH ?? 'database.db';
  if (!isAbsolute(dbPath)) process.env.DB_PATH = resolve(dataDir, dbPath);
}

// Shim da CLI `orkestrai` no PATH dos terminais (ver install-orkestrai-shim.mjs).
installOrkestraiShim();

const dbFile = process.env.DB_PATH ?? resolve('database.db');

// Backup rotativo do SQLite no boot (mantem os ultimos 5) — protege contra
// corrupcao em quedas de energia/updates problematicos.
if (existsSync(dbFile)) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    copyFileSync(dbFile, `${dbFile}.bak-${stamp}`);
    const backups = readdirSync(dirname(dbFile))
      .filter((name) => name.startsWith(`${basename(dbFile)}.bak-`))
      .sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - 5))) {
      rmSync(resolve(dirname(dbFile), old), { force: true });
    }
  } catch {
    // backup e conveniencia; nao bloqueia o boot
  }
}

// Import tardio: o handler avalia APP_KEY e ORIGIN na carga, entao so depois
// do .env e da definicao de ORIGIN abaixo.

const { handlePtyConnection, isAllowedPtyWsOrigin, isPtyWsPath } = await import(
  '../src/lib/modules/agent-room/infrastructure/pty/pty-ws.ts'
);
const { ptySessionManager } = await import(
  '../src/lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts'
);

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);

// O adapter-node assume https por padrao ao derivar event.url; sem isso o
// middleware de origem do Svelar bloqueia POSTs same-origin (http vs https).
process.env.ORIGIN ??= `http://${host}:${port}`;

// O adapter-node limita requests a 512 KB por padrao. O ditado converte o
// audio para WAV PCM16 antes do upload (~32 KB/s), entao esse default rejeita
// gravacoes com cerca de 16 segundos. 32 MB comporta aproximadamente 17 min
// e ainda mantem um limite explicito para proteger a memoria do processo.
process.env.BODY_SIZE_LIMIT ??= '32M';
markPrivateChildEnv(
  ...dotEnvKeys,
  'APP_KEY',
  'INTERNAL_SECRET',
  'ELECTRON_RUN_AS_NODE',
  'HOST',
  'PORT',
  'ORIGIN',
  'BODY_SIZE_LIMIT',
  'DB_PATH',
  'ORKESTRAI_DATA_DIR',
  'ORKESTRAI_PTY_MODULE',
);

const { handler } = await import('../build/handler.js');

// Migrações no boot: em userData novo (primeira execucao empacotada) o banco
// nasce vazio — sobe o schema completo antes de abrir o handler.
{
  const migrationsDir = resolve('src/lib/database/migrations');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.ts')).sort();
  const migrations = [];
  for (const file of files) {
    // import() exige file:// URL para caminhos absolutos no Windows (a letra do
    // drive vira "scheme c:"); pathToFileURL funciona igual em POSIX.
    const mod = await import(pathToFileURL(resolve(migrationsDir, file)).href);
    migrations.push({ name: file.replace(/\.ts$/, ''), migration: new mod.default() });
  }
  const { Migrator } = await import('@beeblock/svelar/database');
  await new Migrator().run(migrations);
}

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
};

// The adapter serves immutable assets before SvelteKit hooks run. Set these
// headers at the HTTP boundary so Monaco/PDF workers are not blocked by COEP.
const server = http.createServer((request, response) => {
  for (const [header, value] of Object.entries(crossOriginIsolationHeaders)) {
    response.setHeader(header, value);
  }
  handler(request, response);
});
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', `http://${host}`).pathname;
  if (!isPtyWsPath(pathname)) {
    socket.destroy();
    return;
  }
  if (!isAllowedPtyWsOrigin(request.headers.origin, request.headers.host)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => handlePtyConnection(ws));
});

server.listen(port, host, () => {
  console.log(`Orkestrai ouvindo em http://${host}:${port}`);
  writeOrkestraiRuntimeFile(`http://${host}:${port}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Do this synchronously before awaiting anything: Electron may exit as soon
  // as it sends SIGTERM, and provider descendants must not survive the app.
  ptySessionManager.killAll();
  await globalThis.__orkestraiShutdownCollaboration?.().catch(() => undefined);
  await globalThis.__orkestraiShutdownDevices?.().catch(() => undefined);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 15_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void shutdown());
}

// IPC disconnect covers an Electron crash/forced close where no app-level
// before-quit hook runs. `exit` is the final synchronous safety net.
process.on('disconnect', () => void shutdown());
process.on('exit', () => ptySessionManager.killAll());
