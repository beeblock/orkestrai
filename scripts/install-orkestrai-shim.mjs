import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Shim da CLI `orkestrai` no PATH dos terminais: os agentes invocam
 * `orkestrai ...` na shell, entao o binario precisa existir fora do repo/app
 * (o pacote empacotado nao instala nada globalmente). Regravado a cada boot
 * (dev pelo vite.config, empacotado pelo orkestrai-server.mjs).
 * Exporta ORKESTRAI_SHIM_DIR para o PtySessionManager incluir no PATH do PTY.
 */
export function installOrkestraiShim() {
  try {
    const cliEntry = resolve('packages/orkestrai-cli/bin/orkestrai.js');
    if (!existsSync(cliEntry)) return null;
    const runtime = process.execPath;
    const electronRuntime = Boolean(process.versions.electron);
    if (!electronRuntime) {
      process.env.ORKESTRAI_CLI_CONSOLE_RUNTIME = runtime;
    } else if (process.platform === 'win32' && !process.env.ORKESTRAI_CLI_CONSOLE_RUNTIME) {
      try {
        const systemNode = execFileSync('where.exe', ['node.exe'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2_000,
        }).split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry && existsSync(entry));
        if (systemNode) process.env.ORKESTRAI_CLI_CONSOLE_RUNTIME = systemNode;
      } catch {
        // Packaged Windows builds inject the bundled console runtime instead.
      }
    }
    const configuredConsoleRuntime = process.env.ORKESTRAI_CLI_CONSOLE_RUNTIME;
    const launcherRuntime = configuredConsoleRuntime && existsSync(configuredConsoleRuntime)
      ? configuredConsoleRuntime
      : runtime;
    const launcherUsesElectron = launcherRuntime === runtime && electronRuntime;
    const shimDir = process.env.ORKESTRAI_DATA_DIR
      ? resolve(process.env.ORKESTRAI_DATA_DIR, 'bin')
      : resolve('storage', 'bin');
    mkdirSync(shimDir, { recursive: true });
    const posixShim = resolve(shimDir, 'orkestrai');
    const cmdShim = resolve(shimDir, 'orkestrai.cmd');
    const shellQuote = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;
    const electronEnv = launcherUsesElectron ? 'ELECTRON_RUN_AS_NODE=1 ' : '';
    writeFileSync(posixShim, `#!/bin/sh\n${electronEnv}exec ${shellQuote(launcherRuntime)} ${shellQuote(cliEntry)} "$@"\n`);
    chmodSync(posixShim, 0o755);
    writeFileSync(
      cmdShim,
      `@echo off\r\n${launcherUsesElectron ? 'set "ELECTRON_RUN_AS_NODE=1"\r\n' : ''}"${launcherRuntime}" "${cliEntry}" %*\r\n`
    );
    process.env.ORKESTRAI_SHIM_DIR = shimDir;
    // ORKESTRAI_CLI = launcher que o agente pode executar DIRETO (sem prefixo de
    // runtime). No Windows apontar para o .js cru fazia o shell abri-lo pela
    // associacao de arquivo (.js -> Windows Script Host, "Caractere invalido" no
    // shebang `#!`); o launcher .cmd/sh invoca o runtime correto internamente.
    process.env.ORKESTRAI_CLI = process.platform === 'win32' ? cmdShim : posixShim;
    // ORKESTRAI_CLI_JS = caminho do .js cru, para quem o passa como ARGUMENTO de
    // um runtime (configs MCP: `<electron/node> <js> mcp`).
    process.env.ORKESTRAI_CLI_JS = cliEntry;
    process.env.ORKESTRAI_CLI_RUNTIME = launcherRuntime;
    process.env.ORKESTRAI_CLI_RUNTIME_IS_ELECTRON = launcherUsesElectron ? '1' : '0';
    return shimDir;
  } catch (error) {
    console.warn('[orkestrai] falha ao instalar o shim da CLI:', error?.message ?? error);
    return null;
  }
}

/**
 * Anuncia a URL atual da API em ~/.orkestrai/runtime.json: a porta do app
 * empacotado e LIVRE (muda a cada execucao), entao o apiUrl gravado no
 * workspace.json pode ficar obsoleto — a CLI le este arquivo primeiro.
 */
export function writeOrkestraiRuntimeFile(apiUrl) {
  try {
    const dir = resolve(homedir(), '.orkestrai');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'runtime.json'), JSON.stringify({ apiUrl, updatedAt: new Date().toISOString() }, null, 2));
  } catch (error) {
    console.warn('[orkestrai] falha ao gravar runtime.json:', error?.message ?? error);
  }
}
