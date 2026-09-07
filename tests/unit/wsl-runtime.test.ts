import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceRuntimeLaunch,
  buildWslLaunch,
  guestWorkingDirectory,
  inferWslRuntimeFromPath,
  parseWslDistributionList,
  wslHostPath,
} from '$lib/modules/agent-room/infrastructure/WslRuntime.js';
import {
  terminalExecutionRuntime,
  workspaceExecutionRuntime,
} from '$lib/modules/agent-room/domain/runtime.js';

describe('WSL workspace runtime', () => {
  it('uses the workspace runtime by default and permits native or WSL terminal overrides', () => {
    const wslWorkspace = {
      runtimeKind: 'wsl' as const,
      wslDistribution: 'Ubuntu-24.04',
      wslWorkingDir: '/home/dev/project',
    };
    expect(workspaceExecutionRuntime(wslWorkspace)).toEqual({
      kind: 'wsl',
      distribution: 'Ubuntu-24.04',
      linuxWorkingDir: '/home/dev/project',
    });
    expect(terminalExecutionRuntime(wslWorkspace, {})).toEqual({
      kind: 'wsl',
      distribution: 'Ubuntu-24.04',
      linuxWorkingDir: '/home/dev/project',
    });
    expect(terminalExecutionRuntime(wslWorkspace, { executionRuntime: { kind: 'native' } })).toEqual({ kind: 'native' });

    const nativeWorkspace = {
      runtimeKind: 'native' as const,
      wslDistribution: null,
      wslWorkingDir: null,
    };
    expect(terminalExecutionRuntime(nativeWorkspace, {
      executionRuntime: {
        kind: 'wsl',
        distribution: 'Debian',
        linuxWorkingDir: '/srv/project',
      },
    })).toEqual({
      kind: 'wsl',
      distribution: 'Debian',
      linuxWorkingDir: '/srv/project',
    });
  });

  it('parses the UTF-16-shaped distro list without merging environments', () => {
    const encoded = `\uFEFF${['Ubuntu-24.04', 'Debian']
      .map((name) => [...name].map((character) => `${character}\0`).join(''))
      .join('\r\0\n\0')}\r\0\n\0`;
    expect(parseWslDistributionList(encoded)).toEqual([
      { name: 'Ubuntu-24.04' },
      { name: 'Debian' },
    ]);
  });

  it('infers both supported WSL UNC forms and preserves the exact distro', () => {
    expect(inferWslRuntimeFromPath('\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\app')).toEqual({
      distribution: 'Ubuntu-24.04',
      linuxWorkingDir: '/home/raoni/app',
    });
    expect(inferWslRuntimeFromPath('\\\\wsl$\\Ubuntu-22.04\\srv\\site')).toEqual({
      distribution: 'Ubuntu-22.04',
      linuxWorkingDir: '/srv/site',
    });
    expect(wslHostPath('Debian', '/home/dev/app')).toBe('\\\\wsl.localhost\\Debian\\home\\dev\\app');
  });

  it('builds one exact distro launch and forwards only bridge context through WSLENV', () => {
    const launch = buildWslLaunch({
      runtime: { kind: 'wsl', distribution: 'Ubuntu-24.04', linuxWorkingDir: '/home/raoni/app' },
      command: 'kimi',
      args: ['--continue'],
      hostCwd: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\app',
      workspaceRoot: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\app',
      hostEnv: {
        PATH: 'C:\\Windows',
        ORKESTRAI_API_URL: 'http://127.0.0.1:4321',
        ORKESTRAI_AGENT_TOKEN: 'terminal-token',
        ORKESTRAI_WORKSPACE_CONFIG: '/home/raoni/app/.orkestrai/workspace.json',
        ORKESTRAI_CLI_JS: 'C:\\Orkestrai\\orkestrai.js',
        CODEX_HOME: '/home/raoni/.codex-work',
      },
      forwardEnvToWsl: ['CODEX_HOME'],
    });

    expect(launch.command).toBe('wsl.exe');
    expect(launch.args).toEqual([
      '--distribution',
      'Ubuntu-24.04',
      '--cd',
      '/home/raoni/app',
      '--exec',
      '/bin/bash',
      '-lic',
      'export PATH="$ORKESTRAI_WORKSPACE_BIN:$PATH"; exec "$@"',
      'orkestrai-runtime',
      'kimi',
      '--continue',
    ]);
    expect(launch.env.ORKESTRAI_CLI).toBe('/home/raoni/app/.orkestrai/bin/orkestrai');
    expect(launch.env.WSLENV).toContain('ORKESTRAI_NODE_ID');
    expect(launch.env.WSLENV.split(':')).toContain('ORKESTRAI_WORKSPACE_CONFIG');
    expect(launch.env.WSLENV.split(':')).toContain('ORKESTRAI_AGENT_TOKEN');
    expect(launch.env.WSLENV.split(':')).toContain('CODEX_HOME');
    expect(launch.env.WSLENV.split(':')).not.toContain('PATH');
  });

  it('maps a native shell placeholder to bash inside WSL', () => {
    const launch = buildWslLaunch({
      runtime: { kind: 'wsl', distribution: 'Debian', linuxWorkingDir: '/srv/app' },
      command: 'wsl.exe',
      args: [],
      hostCwd: '\\\\wsl$\\Debian\\srv\\app',
      hostEnv: {},
    });
    expect(launch.args.at(-1)).toBe('/bin/bash');
  });

  it('translates workspace file arguments for Linux CLIs', () => {
    const launch = buildWslLaunch({
      runtime: { kind: 'wsl', distribution: 'Ubuntu-24.04', linuxWorkingDir: '/home/raoni/project' },
      command: 'kimi',
      args: ['--agent-file', '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\project\\.orkestrai\\roles\\qa\\AGENTS.md'],
      hostCwd: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\project',
      workspaceRoot: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\project',
      hostEnv: {},
    });

    expect(launch.args.at(-1)).toBe('/home/raoni/project/.orkestrai/roles/qa/AGENTS.md');
  });

  it('maps a floor path to the same relative directory inside WSL', () => {
    expect(guestWorkingDirectory(
      { kind: 'wsl', distribution: 'Ubuntu-24.04', linuxWorkingDir: '/home/raoni/project' },
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\project\\.orkestrai\\floors\\qa',
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\project',
    )).toBe('/home/raoni/project/.orkestrai/floors/qa');
  });

  it('runs workspace Git and worktree paths inside the selected WSL distribution', () => {
    const workspace = {
      workingDir: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\raoni\\project',
      runtimeKind: 'wsl' as const,
      wslDistribution: 'Ubuntu-24.04',
      wslWorkingDir: '/home/raoni/project',
    };
    const floorPath = `${workspace.workingDir}\\.orkestrai\\floors\\review`;
    const launch = buildWorkspaceRuntimeLaunch({
      workspace,
      command: 'git',
      args: ['worktree', 'add', '-b', 'orkestrai/review', floorPath],
      hostEnv: { PATH: 'C:\\Windows' },
    });

    expect(launch.command).toBe('wsl.exe');
    expect(launch.args).toContain('Ubuntu-24.04');
    expect(launch.args).toContain('git');
    expect(launch.args.at(-1)).toBe('/home/raoni/project/.orkestrai/floors/review');
    expect(launch.cwd).not.toBe(workspace.workingDir);
  });

  it('runs Floor hooks in the Floor cwd and forwards only their explicit context to WSL', () => {
    const workspace = {
      workingDir: '\\\\wsl.localhost\\Ubuntu-22.04\\srv\\project',
      runtimeKind: 'wsl' as const,
      wslDistribution: 'Ubuntu-22.04',
      wslWorkingDir: '/srv/project',
    };
    const launch = buildWorkspaceRuntimeLaunch({
      workspace,
      command: '/bin/sh',
      args: ['-c', 'printf "%s" "$ORKESTRAI_FLOOR_NAME"'],
      hostCwd: `${workspace.workingDir}\\.orkestrai\\floors\\qa`,
      hostEnv: { ORKESTRAI_FLOOR_NAME: 'QA' },
      forwardEnvToWsl: ['ORKESTRAI_FLOOR_NAME'],
    });

    expect(launch.args.slice(0, 4)).toEqual(['--distribution', 'Ubuntu-22.04', '--cd', '/srv/project/.orkestrai/floors/qa']);
    expect(launch.args).toContain('/bin/sh');
    expect(launch.args.at(-1)).toBe('printf "%s" "$ORKESTRAI_FLOOR_NAME"');
    expect(launch.env.WSLENV.split(':')).toContain('ORKESTRAI_FLOOR_NAME');
  });
});
