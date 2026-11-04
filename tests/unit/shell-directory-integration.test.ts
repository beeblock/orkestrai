import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { integrateNativeShellDirectory, wslDirectoryShellScript } from '$lib/modules/agent-room/infrastructure/pty/ShellDirectoryIntegration.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { workingDirectoryFromWindowsOsc } from '$lib/modules/agent-room/domain/terminal-working-directory.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }))); });

describe('session-only shell directory integration', () => {
  it('wraps only a default interactive PowerShell prompt and preserves explicit commands and POSIX shells', () => {
    const args = integrateNativeShellDirectory('powershell.exe', [], {}, 'win32').args;
    expect(args.slice(0, 2)).toEqual(['-NoExit', '-EncodedCommand']);
    expect(Buffer.from(args[2], 'base64').toString('utf16le')).toContain('$global:__OrkestraiOriginalPrompt');
    for (const command of ['claude', 'codex', 'node', '/bin/bash']) expect(integrateNativeShellDirectory(command, [], {}, 'win32').args).toEqual([]);
    expect(integrateNativeShellDirectory('powershell.exe', ['-File', 'startup.ps1'], {}, 'win32').args).toEqual(['-File', 'startup.ps1']);
    expect(integrateNativeShellDirectory('pwsh', [], {}, 'linux').args).toEqual([]);
  });
  it('extends only the child CMD prompt and preserves WSL forwarding rules', () => {
    const env = { PROMPT: '$P custom$G', WSLENV: 'EXISTING/u' };
    expect(integrateNativeShellDirectory('cmd.exe', [], env, 'win32').env.PROMPT).toBe('$e]9;9;$P$e\\$P custom$G');
    const wsl = integrateNativeShellDirectory('wsl.exe', [], env, 'win32');
    expect(wsl.env.WSLENV).toBe('EXISTING/u:PROMPT_COMMAND');
    expect(env).toEqual({ PROMPT: '$P custom$G', WSLENV: 'EXISTING/u' });
  });
  it.skipIf(process.platform === 'win32')('runs the managed Bash prompt integration while preserving the existing bashrc', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orkestrai-bash-cwd-')); roots.push(home);
    await writeFile(join(home, '.bashrc'), 'PROMPT_COMMAND="printf ORIGINAL_PROMPT_MARKER"\\n'.replace('\\n', '\n'));
    const result = spawnSync('/bin/bash', ['-lc', wslDirectoryShellScript], { input: 'exit\n', cwd: home, env: { ...process.env, HOME: home, ORKESTRAI_WORKSPACE_BIN: home }, encoding: 'utf8', timeout: 10_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('ORIGINAL_PROMPT_MARKER');
    expect(result.stdout).toContain('\x1b]9;9;');
    expect(await import('node:fs/promises').then(fs => fs.readFile(join(home, '.bashrc'), 'utf8'))).toContain('PROMPT_COMMAND="printf ORIGINAL_PROMPT_MARKER"');
  });
  it.skipIf(process.platform !== 'win32')('receives real PowerShell cwd changes in the native Windows PTY', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orkestrai-pwsh-cwd-'))); roots.push(root);
    const child = join(root, 'work folder'); await mkdir(child);
    const session = ptySessionManager.create({ command: 'powershell.exe', cwd: root });
    expect(session.windowsPty).toMatchObject({ backend: 'conpty' });
    let output = '';
    let exited = false;
    const { detach, scrollback } = ptySessionManager.attach(session.id, data => { output = (output + data).slice(-32768); }, () => { exited = true; });
    output = scrollback + output;
    try {
      await vi.waitFor(() => expect(output).toContain('\x1b]9;9;'), { timeout: 15_000 });
      ptySessionManager.writeHumanInput(session.id, "Set-Location -LiteralPath '" + child.replaceAll("'", "''") + "'\r");
      await vi.waitFor(() => {
        const paths = [...output.matchAll(/\x1b\]9;9;([^\x07\x1b]+)(?:\x07|\x1b\\)/g)].map(match => workingDirectoryFromWindowsOsc('9;' + match[1]));
        expect(paths.some(path => path?.toLowerCase() === child.toLowerCase())).toBe(true);
      }, { timeout: 15_000 });
    } finally {
      ptySessionManager.kill(session.id);
      try { await vi.waitFor(() => expect(exited).toBe(true), { timeout: 5_000 }); }
      finally { detach(); }
    }
  }, 35_000);
});
