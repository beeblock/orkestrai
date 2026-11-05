import { afterEach, describe, expect, it, vi } from 'vitest';
import { foregroundDescendants, launcherArguments, parseShellProcesses, windowsConsoleForeground, type ShellForegroundProcess } from '$lib/modules/agent-room/infrastructure/pty/ShellAgentProcess.js';
import { shellAgentService, shellProcessProvider } from '$lib/modules/agent-room/application/services/ShellAgentService.js';
import { tmpdir } from 'node:os';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { listAgentAdapters } from '$lib/modules/agent-room/application/adapters/registry.js';

const process = (executable: string, argv: string[]): ShellForegroundProcess => ({ pid: 42, parent: 1, key: '42:now', cwd: '/project', executable, argv });
describe('manual Shell process attribution', () => {
  afterEach(() => vi.restoreAllMocks());
  it('accepts only the owned foreground group, excluding background providers and other PTYs', () => {
    const rows = parseShellProcesses(`
      10 1 10 20 Thu Nov  5 09:00:00 2026 /bin/bash
      20 10 20 20 Thu Nov  5 09:01:00 2026 /usr/bin/node
      21 20 20 20 Thu Nov  5 09:01:00 2026 /opt/claude
      30 10 30 20 Thu Nov  5 09:00:00 2026 /opt/claude
      40 1 40 40 Thu Nov  5 09:00:00 2026 /opt/claude
    `);
    expect(foregroundDescendants(rows, 10).map(p => p.pid)).toEqual([20, 21]);
    expect(() => foregroundDescendants(rows, 999)).toThrow('no longer available');
  });

  it('limits Windows discovery to descendants in the same ConPTY console', () => {
    const record = (id: number, parent: number, executable: string) => ({ ProcessId: id, ParentProcessId: parent, CreationDate: '/Date(123)/', ExecutablePath: executable, CommandLine: executable });
    const rows = windowsConsoleForeground([
      record(10, 1, 'cmd.exe'), record(20, 10, 'claude.exe'),
      record(30, 10, 'claude.exe'), record(40, 1, 'claude.exe'),
    ], [10, 20, 40], 10, 'C:/project/subdir');
    expect(rows.map(row => row.pid)).toEqual([10, 20]);
    expect(rows[1]).toMatchObject({ key: '20:/Date(123)/', cwd: 'C:/project/subdir' });
    expect(() => windowsConsoleForeground([{ ProcessId: '20' }], [20], 20, '/')).toThrow('identity');
  });

  it('keeps configured WSL cwd and host profile paths together and refuses an unlinked guest', async () => {
    vi.spyOn(ptySessionManager, 'get').mockReturnValue({ id: 'pty', workspaceId: 'w', nodeId: 'n', provider: null, exited: false,
      transcriptHome: '//wsl.localhost/Ubuntu/home/user', runtimeKey: 'wsl:Ubuntu' } as never);
    vi.spyOn(ptySessionManager, 'transcriptStorageRoots').mockReturnValue({ claudeConfigDir: '//wsl.localhost/Ubuntu/home/user/.claude-work' });
    const foreground = vi.spyOn(ptySessionManager, 'shellForeground').mockResolvedValue([
      { ...process('/usr/bin/node', ['node', '/opt/node_modules/@anthropic-ai/claude-code/cli.js']), cwd: '/project/another-folder' },
    ]);
    expect(await shellAgentService.detect('w', 'n', 'pty')).toMatchObject({ provider: 'claude', cwd: '/project/another-folder',
      options: { posixCwd: true, homeDir: '//wsl.localhost/Ubuntu/home/user', claudeConfigDir: '//wsl.localhost/Ubuntu/home/user/.claude-work' } });
    foreground.mockResolvedValue([process('C:/Windows/System32/wsl.exe', ['wsl.exe'])]);
    await expect(shellAgentService.detect('w', 'n', 'pty')).rejects.toThrow('unlinked WSL guest');
  });

  it('never types an automatic prompt cancelled during asynchronous process validation', async () => {
    const session = ptySessionManager.create({ command: globalThis.process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], cwd: tmpdir() });
    let output = '';
    const { detach } = ptySessionManager.attach(session.id, data => { output += data; });
    let inspected!: () => void, release!: () => void;
    const inspection = new Promise<void>(resolve => { inspected = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const controller = new AbortController();
    try {
      const pending = ptySessionManager.writeWithConfirmedSubmit(session.id, 'CANCELLED_PROMPT_MUST_NOT_RUN', {
        signal: controller.signal, isStillRelevant: async beforeWrite => { if (beforeWrite) { inspected(); await gate; } return true; },
      });
      const rejected = expect(pending).rejects.toBeInstanceOf(Error);
      await inspection;
      controller.abort(); release();
      await rejected;
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(output).not.toContain('CANCELLED_PROMPT_MUST_NOT_RUN');
    } finally { release(); detach(); ptySessionManager.kill(session.id); }
  });

  it('recognizes Windows native and published Node launchers without matching prompt arguments', () => {
    const adapters = listAgentAdapters();
    expect(shellProcessProvider(process('C:\\Tools\\claude.exe', ['claude']), adapters)).toBe('claude');
    expect(shellProcessProvider(process('C:\\Program Files\\nodejs\\node.exe', ['node', 'C:\\Users\\Dev\\node_modules\\@anthropic-ai\\claude-code\\cli.js']), adapters)).toBe('claude');
    expect(shellProcessProvider(process('/usr/bin/node', ['node', '/opt/node_modules/@openai/codex/bin/codex.js']), adapters)).toBe('codex');
    expect(shellProcessProvider(process('/usr/bin/echo', ['echo', 'claude']), adapters)).toBeNull();
    expect(shellProcessProvider(process('/usr/bin/node', ['node', '/tmp/unrelated.js']), adapters)).toBeNull();
    expect(launcherArguments('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Dev\\node_modules\\@anthropic-ai\\claude-code\\cli.js" --api-key PRIVATE')).toEqual([
      'C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Dev\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
    ]);
  });
});
