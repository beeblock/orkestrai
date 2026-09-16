import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePtyConnection, isAllowedPtyWsOrigin } from '$lib/modules/agent-room/infrastructure/pty/pty-ws.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { agentSessionTracker } from '$lib/modules/agent-room/infrastructure/pty/AgentSessionTracker.ts';

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  frames: Array<Record<string, unknown>> = [];

  send(frame: string) {
    this.frames.push(JSON.parse(frame) as Record<string, unknown>);
  }
}

describe('PTY WebSocket protocol', () => {
  afterEach(() => {
    delete (globalThis as { __orkestraiResolveProviderProfileEnv?: unknown }).__orkestraiResolveProviderProfileEnv;
    delete (globalThis as { __orkestraiCanStartWorkspaceSession?: unknown }).__orkestraiCanStartWorkspaceSession;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('classifica attach de sessao inexistente com codigo estavel', () => {
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);

    socket.emit('message', JSON.stringify({ type: 'attach', sessionId: 'morta-123' }));

    expect(socket.frames).toContainEqual({
      type: 'error',
      code: 'PTY_SESSION_NOT_FOUND',
      sessionId: 'morta-123',
      message: 'Sessão PTY não encontrada: morta-123',
    });
    socket.emit('close');
  });

  it('redimensiona a PTY para o viewport que esta restaurando a sessao', () => {
    const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp', cols: 40, rows: 8 });
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);

    try {
      socket.emit('message', JSON.stringify({
        type: 'attach',
        sessionId: session.id,
        cols: 132,
        rows: 36,
      }));

      expect(ptySessionManager.get(session.id)).toMatchObject({ cols: 132, rows: 36 });
      expect(socket.frames.some((frame) => frame.type === 'attached')).toBe(true);
    } finally {
      socket.emit('close');
      ptySessionManager.kill(session.id);
    }
  });

  it('reutiliza o PTY vivo do mesmo workspace e no em vez de duplicar a conversa', async () => {
    const original = ptySessionManager.create({
      command: '/bin/cat',
      cwd: '/tmp',
      workspaceId: 'workspace-resume',
      nodeId: 'node-resume',
      provider: 'codex',
    });
    const create = vi.spyOn(ptySessionManager, 'create');
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);

    try {
      socket.emit('message', JSON.stringify({
        type: 'create',
        command: '/bin/cat',
        cwd: '/tmp',
        provider: 'codex',
        workspaceId: 'workspace-resume',
        nodeId: 'node-resume',
        conversationArgs: ['resume', 'conversation-resume'],
      }));

      await vi.waitFor(() => expect(socket.frames.some((frame) => frame.type === 'created')).toBe(true));
      expect(create).not.toHaveBeenCalled();
      expect(socket.frames.find((frame) => frame.type === 'created')).toMatchObject({
        reused: true,
        session: { id: original.id },
      });
      expect(ptySessionManager.listLiveForNode('workspace-resume', 'node-resume')).toHaveLength(1);
    } finally {
      socket.emit('close');
      ptySessionManager.kill(original.id);
    }
  });

  it('reassocia pela conversa confirmada quando o vinculo do no foi perdido', async () => {
    const conversationId = '01a04ef1-a6ca-72b1-bc4d-a80a00f5f897';
    const original = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'cat', 'resume', conversationId],
      cwd: '/tmp',
      provider: 'codex',
    });
    const create = vi.spyOn(ptySessionManager, 'create');
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);

    try {
      socket.emit('message', JSON.stringify({
        type: 'create',
        command: '/bin/sh',
        args: ['-c', 'cat'],
        cwd: '/tmp',
        provider: 'codex',
        workspaceId: 'workspace-recovered',
        nodeId: 'node-recovered',
        conversationArgs: ['resume', conversationId],
      }));

      await vi.waitFor(() => expect(socket.frames.some((frame) => frame.type === 'created')).toBe(true));
      expect(create).not.toHaveBeenCalled();
      expect(socket.frames.find((frame) => frame.type === 'created')).toMatchObject({
        reused: true,
        session: { id: original.id },
      });
      expect(ptySessionManager.listLiveForNode('workspace-recovered', 'node-recovered'))
        .toHaveLength(1);
    } finally {
      socket.emit('close');
      ptySessionManager.kill(original.id);
    }
  });

  it.each([
    ['codex', '11111111-1111-4111-8111-111111111111'],
    ['claude', '22222222-2222-4222-8222-222222222222'],
    ['kimi', 'session_exact_resume'],
  ])('keeps the exact %s resume identity instead of watching other modified transcripts', async (provider, conversationId) => {
    const watch = vi.spyOn(agentSessionTracker, 'watch');
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);
    let sessionId: string | undefined;
    try {
      socket.emit('message', JSON.stringify({
        type: 'create', command: '/bin/sh', args: ['-c', 'cat'], cwd: '/tmp',
        provider, workspaceId: `exact-${provider}`, nodeId: `node-${provider}`,
        agentSessionId: conversationId, conversationArgs: ['resume', conversationId],
      }));
      await vi.waitFor(() => expect(socket.frames.some(frame => frame.type === 'created')).toBe(true));
      sessionId = (socket.frames.find(frame => frame.type === 'created')!.session as { id: string }).id;
      expect(watch).not.toHaveBeenCalled();
      expect(agentSessionTracker.agentSessionIdForPty(sessionId)).toBe(conversationId);
      expect(ptySessionManager.get(sessionId)?.agentSessionId).toBe(conversationId);
      expect(socket.frames).toContainEqual({ type: 'agentSession', sessionId, agentSessionId: conversationId, provider });
    } finally {
      socket.emit('close');
      if (sessionId) {
        ptySessionManager.kill(sessionId);
        agentSessionTracker.forget(sessionId);
      }
    }
  });

  it.each([
    ['same-workspace', '/bin/sh'],
    ['different-workspace', '/bin/sh'],
    ['same-workspace', 'codex'],
  ])('does not steal a conversation owned by another node in %s using %s', async (workspaceId, command) => {
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const original = ptySessionManager.create({
      command: '/bin/sh', args: ['-c', 'cat', 'resume', conversationId], cwd: '/tmp',
      provider: 'codex', workspaceId: 'same-workspace', nodeId: 'original-node', agentSessionId: conversationId,
    });
    const create = vi.spyOn(ptySessionManager, 'create');
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);
    try {
      socket.emit('message', JSON.stringify({
        type: 'create', command, args: ['-c', 'cat'], cwd: '/tmp', provider: 'codex',
        workspaceId, nodeId: 'other-node', agentSessionId: conversationId, conversationArgs: ['resume', conversationId],
      }));
      await vi.waitFor(() => expect(socket.frames.some(frame => frame.code === 'AGENT_SESSION_IN_USE')).toBe(true));
      expect(create).not.toHaveBeenCalled();
      expect(ptySessionManager.get(original.id)).toMatchObject({ workspaceId: 'same-workspace', nodeId: 'original-node', exited: false });
      expect(socket.frames.some(frame => frame.type === 'created')).toBe(false);
    } finally {
      socket.emit('close');
      ptySessionManager.kill(original.id);
    }
  });

  it('resolve o perfil no servidor somente ao criar a PTY', async () => {
    const create = vi.spyOn(ptySessionManager, 'create');
    (globalThis as {
      __orkestraiResolveProviderProfileEnv?: (profileId: string, providerId: string) => Promise<Record<string, string>>;
    }).__orkestraiResolveProviderProfileEnv = vi.fn(async () => ({ TEST_PROFILE_SECRET: 'runtime-only' }));
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);

    socket.emit('message', JSON.stringify({
      type: 'create',
      command: '/bin/cat',
      cwd: '/tmp',
      provider: 'codex',
      profileId: 'profile-1',
      env: { SAFE_VALUE: 'kept' },
    }));

    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].env).toEqual({
      SAFE_VALUE: 'kept',
      TEST_PROFILE_SECRET: 'runtime-only',
    });
    expect(create.mock.calls[0][0].forwardEnvToWsl).toEqual(['TEST_PROFILE_SECRET']);
    const created = socket.frames.find((frame) => frame.type === 'created');
    expect(JSON.stringify(created)).not.toContain('runtime-only');
    const sessionId = String((created?.session as { id?: string } | undefined)?.id ?? '');
    if (sessionId) ptySessionManager.kill(sessionId);
    socket.emit('close');
  });

  it('injects the packaged MCP before the Codex resume subcommand', async () => {
    vi.stubEnv('ORKESTRAI_CLI_RUNTIME', '/Applications/Orkestrai.app/Contents/MacOS/Orkestrai');
    vi.stubEnv('ORKESTRAI_CLI_JS', '/Applications/Orkestrai.app/Contents/Resources/app/packages/orkestrai-cli/bin/orkestrai.js');
    vi.stubEnv('ORKESTRAI_CLI_RUNTIME_IS_ELECTRON', '1');
    const create = vi.spyOn(ptySessionManager, 'create');
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);

    socket.emit('message', JSON.stringify({
      type: 'create',
      command: '/bin/cat',
      args: ['--dangerously-bypass-approvals-and-sandbox'],
      conversationArgs: ['resume', 'conversation-1'],
      cwd: '/tmp',
      provider: 'codex',
    }));

    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    const args = create.mock.calls[0][0].args ?? [];
    expect(args[0]).toBe('--dangerously-bypass-approvals-and-sandbox');
    expect(args).toContain('mcp_servers.orkestrai.command="/Applications/Orkestrai.app/Contents/MacOS/Orkestrai"');
    expect(args.slice(-2)).toEqual(['resume', 'conversation-1']);
    expect(args.indexOf('mcp_servers.orkestrai.args=["/Applications/Orkestrai.app/Contents/Resources/app/packages/orkestrai-cli/bin/orkestrai.js", "mcp"]'))
      .toBeLessThan(args.indexOf('resume'));
    const created = socket.frames.find((frame) => frame.type === 'created');
    const sessionId = String((created?.session as { id?: string } | undefined)?.id ?? '');
    if (sessionId) ptySessionManager.kill(sessionId);
    socket.emit('close');
  });

  it('refuses to recreate a terminal while its workspace is suspended', async () => {
    const create = vi.spyOn(ptySessionManager, 'create');
    (globalThis as {
      __orkestraiCanStartWorkspaceSession?: (workspaceId: string) => Promise<boolean>;
    }).__orkestraiCanStartWorkspaceSession = vi.fn(async () => false);
    const socket = new FakeSocket();
    handlePtyConnection(socket as never);

    socket.emit('message', JSON.stringify({
      type: 'create',
      command: '/bin/cat',
      cwd: '/tmp',
      workspaceId: 'workspace-paused',
    }));

    await vi.waitFor(() => expect(socket.frames).toContainEqual({
      type: 'error',
      code: 'WORKSPACE_SUSPENDED',
      message: 'Workspace suspended.',
    }));
    expect(create).not.toHaveBeenCalled();
    socket.emit('close');
  });
});

describe('PTY WebSocket origin validation', () => {
  it('aceita a mesma origem e spellings loopback somente na mesma porta', () => {
    expect(isAllowedPtyWsOrigin('http://127.0.0.1:5199', '127.0.0.1:5199')).toBe(true);
    expect(isAllowedPtyWsOrigin('http://localhost:5199', '127.0.0.1:5199')).toBe(true);
    expect(isAllowedPtyWsOrigin('http://localhost:3000', '127.0.0.1:5199')).toBe(false);
    expect(isAllowedPtyWsOrigin('https://example.com', '127.0.0.1:5199')).toBe(false);
    expect(isAllowedPtyWsOrigin('not-a-url', '127.0.0.1:5199')).toBe(false);
  });
});
