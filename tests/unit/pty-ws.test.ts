import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePtyConnection, isAllowedPtyWsOrigin } from '$lib/modules/agent-room/infrastructure/pty/pty-ws.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

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
