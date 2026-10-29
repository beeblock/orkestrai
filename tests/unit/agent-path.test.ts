import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fallbackCliLauncher, normalizeWindowsPath, resolveCommand } from '$lib/modules/agent-room/infrastructure/agent-path.js';

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('fallbackCliLauncher', () => {
  it('usa o launcher .cmd no Windows e nunca o JavaScript cru', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-launcher-'));
    temporaryDirs.push(dir);
    const launcher = join(dir, 'orkestrai.cmd');
    writeFileSync(launcher, '@echo off\r\n');

    expect(fallbackCliLauncher('win32', { ORKESTRAI_SHIM_DIR: dir }, 'C:\\app\\orkestrai.js')).toBe(launcher);
    expect(fallbackCliLauncher('win32', {}, 'C:\\app\\orkestrai.js')).toBeUndefined();
  });

  it('mantem o fallback por shebang no POSIX', () => {
    expect(fallbackCliLauncher('darwin', {}, '/app/orkestrai.js')).toBe('/app/orkestrai.js');
  });
});


describe('bundled Orkestrai agent startup', () => {
  it('starts the bundled CLI without PATH or cmd.exe, preserving quoted model arguments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai runtime & account '));
    temporaryDirs.push(dir);
    const cli = join(dir, 'orkestrai.js');
    writeFileSync(cli, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const args = ['model-access-agent', '--model', 'connection/offering/model', '--instructions', 'Task with spaces & "quotes" and ação'];
    const env = { PATH: '', ORKESTRAI_CLI_CONSOLE_RUNTIME: process.execPath, ORKESTRAI_CLI_JS: cli };
    const invocation = resolveCommand('orkestrai', args, env, 'win32');
    expect(invocation).toEqual({ command: process.execPath, args: [cli, ...args] });
    expect(JSON.parse(execFileSync(invocation.command, invocation.args, { encoding: 'utf8', env }))).toEqual(args);
  });

  it('keeps the POSIX launcher and unrelated provider commands unchanged', () => {
    const env = { PATH: '', ORKESTRAI_CLI_CONSOLE_RUNTIME: process.execPath, ORKESTRAI_CLI_JS: import.meta.filename };
    expect(resolveCommand('orkestrai', ['list'], env, 'darwin')).toEqual({ command: 'orkestrai', args: ['list'] });
    expect(resolveCommand('claude', ['--model', 'test'], env, 'win32')).toEqual({ command: 'claude', args: ['--model', 'test'] });
  });
});


describe('Windows PATH casing', () => {
  it('preserves inherited Path and removes conflicting casing before ConPTY startup', () => {
    expect(normalizeWindowsPath({}, 'win32')).toEqual({});
    const inherited = { Path: 'C:\\Windows;C:\\Tools', KEEP: 'unchanged' };
    expect(normalizeWindowsPath(inherited, 'win32')).toEqual({ PATH: inherited.Path, KEEP: 'unchanged' });
    expect(inherited).toHaveProperty('Path');
    expect(normalizeWindowsPath({ Path: 'stale', PATH: 'bundled;tools' }, 'win32')).toEqual({ PATH: 'bundled;tools' });
    const merged = { PATH: 'inherited', ...normalizeWindowsPath({ Path: 'explicit terminal path' }, 'win32') };
    expect(merged).toEqual({ PATH: 'explicit terminal path' });
  });
  it('preserves case-sensitive POSIX environment variables', () => {
    expect(normalizeWindowsPath({ Path: 'custom', PATH: '/bin' }, 'darwin')).toEqual({ Path: 'custom', PATH: '/bin' });
  });
});
