import { describe, expect, it } from 'vitest';
import { parseSshConfig, sshTerminalArgs } from '../../src/lib/modules/agent-room/domain/ssh-machines.js';

describe('SSH machines', () => {
  it('reads concrete hosts and skips patterns', () => {
    const config = `
Host *
  ServerAliveInterval 30
Host build-box gpu
  HostName 10.0.0.5
  User dev
  Port 2222
# comment
Host !evil *.corp
Host mini = 
Host studio
  HostName studio.local`;
    expect(parseSshConfig(config)).toEqual([
      { alias: 'build-box', hostName: '10.0.0.5', user: 'dev', port: 2222 },
      { alias: 'gpu', hostName: '10.0.0.5', user: 'dev', port: 2222 },
      { alias: 'mini', hostName: null, user: null, port: null },
      { alias: 'studio', hostName: 'studio.local', user: null, port: null },
    ]);
  });

  it('builds a quoted remote command and refuses option-like hosts', () => {
    expect(sshTerminalArgs('build-box', "/srv/app's", 'claude')).toEqual(['-t', 'build-box', "cd '/srv/app'\\''s' && exec claude"]);
    expect(sshTerminalArgs('build-box', '', null)).toEqual(['-t', 'build-box', 'exec "${SHELL:-/bin/sh}" -l']);
    expect(() => sshTerminalArgs('-oProxyCommand=x', null, null)).toThrow();
    expect(() => sshTerminalArgs('box', null, 'rm -rf')).toThrow();
  });
});
