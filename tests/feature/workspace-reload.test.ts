import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { getAgentAdapter } from '$lib/modules/agent-room/application/adapters/registry.js';
import { agentSessionTracker } from '$lib/modules/agent-room/infrastructure/pty/AgentSessionTracker.ts';
import { roleService } from '$lib/modules/agent-room/application/services/RoleService.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';

describe('WorkspaceService.reloadNode', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.restoreAllMocks());

  it('mata a sessao PTY e limpa o sessionId, mantendo o agentSessionId (resume)', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'reload', workingDir: '/tmp' });
    const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'T',
      payload: { command: '/bin/cat', sessionId: session.id, agentSessionId: 'sess-real-123', provider: 'claude' },
    });

    await workspaceService.reloadNode(workspace.id, node.id);

    const after = await workspaceRepository.getNode(node.id);
    const payload = (after!.payload ?? {}) as Record<string, unknown>;
    expect(payload.sessionId).toBeUndefined();
    expect(payload.agentSessionId).toBe('sess-real-123');
    expect(ptySessionManager.get(session.id)?.exited).not.toBe(false);
  });

  it('mata todos os PTYs do no ao recarregar mesmo quando o payload aponta para uma duplicata', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'reload duplicado', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Codex',
      payload: { command: 'codex', provider: 'codex', agentSessionId: 'conversation-1' },
    });
    const original = ptySessionManager.create({
      command: '/bin/cat',
      cwd: '/tmp',
      workspaceId: workspace.id,
      nodeId: node.id,
      provider: 'codex',
    });
    const duplicate = ptySessionManager.create({
      command: '/bin/cat',
      cwd: '/tmp',
      workspaceId: workspace.id,
      nodeId: node.id,
      provider: 'codex',
    });
    await workspaceRepository.updateNode(node.id, {
      payload: { command: 'codex', provider: 'codex', sessionId: duplicate.id, agentSessionId: 'conversation-1' },
    });

    await workspaceService.reloadNode(workspace.id, node.id);

    expect(ptySessionManager.get(original.id)).toBeNull();
    expect(ptySessionManager.get(duplicate.id)).toBeNull();
    expect(((await workspaceRepository.getNode(node.id))!.payload as Record<string, unknown>).sessionId).toBeUndefined();
  });

  it('reassocia o PTY original quando o sessionId persistido ficou obsoleto apos hibernacao', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'wake resume', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Codex',
      payload: { command: '/bin/cat', provider: 'codex', sessionId: 'pty-obsoleto' },
    });
    const original = ptySessionManager.create({
      command: '/bin/cat',
      cwd: '/tmp',
      workspaceId: workspace.id,
      nodeId: node.id,
      provider: 'codex',
    });

    const listed = await workspaceService.listNodes(workspace.id);

    expect((listed.find((candidate) => candidate.id === node.id)!.payload as Record<string, unknown>).sessionId)
      .toBe(original.id);
    expect(((await workspaceRepository.getNode(node.id))!.payload as Record<string, unknown>).sessionId)
      .toBe(original.id);
    ptySessionManager.kill(original.id);
  });

  it('encerra pelo id da conversa quando o PTY perdeu o vinculo do no', async () => {
    const conversationId = '01a04ef1-a6ca-72b1-bc4d-a80a00f5f897';
    const workspace = await workspaceRepository.createWorkspace({ name: 'lost binding', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Codex',
      payload: { command: '/bin/sh', provider: 'codex', agentSessionId: conversationId },
    });
    const unbound = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'cat', 'resume', conversationId],
      cwd: '/tmp',
      provider: 'codex',
    });

    await workspaceService.reloadNode(workspace.id, node.id);

    expect(ptySessionManager.get(unbound.id)).toBeNull();
  });

  it('falha com no inexistente ou de outro workspace', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'reload2', workingDir: '/tmp' });
    await expect(workspaceService.reloadNode(workspace.id, 'inexistente')).rejects.toThrow('nao encontrado');
  });

  it('repara terminais antigos de presets com o acesso total do adapter', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'preset antigo', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Claude',
      payload: { command: 'claude', args: [], provider: 'claude' },
    });

    const nodes = await workspaceService.listNodes(workspace.id);
    const payload = nodes.find((item) => item.id === node.id)!.payload as { args?: string[] };
    expect(payload.args).toContain('--dangerously-skip-permissions');

    const persisted = (await workspaceRepository.getNode(node.id))!.payload as { args?: string[] };
    expect(persisted.args).toContain('--dangerously-skip-permissions');
  });

  it('remove sessionId obsoleto no restart e preserva a conversa do provider', async () => {
    vi.spyOn(agentSessionTracker, 'isAgentSessionResumable').mockReturnValue(true);
    const workspace = await workspaceRepository.createWorkspace({ name: 'restart', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Claude',
      payload: {
        command: 'claude',
        args: ['--dangerously-skip-permissions'],
        provider: 'claude',
        sessionId: 'pty-do-processo-anterior',
        agentSessionId: 'conversa-real-123',
      },
    });

    const listed = await workspaceService.listNodes(workspace.id);
    const payload = listed.find((item) => item.id === node.id)!.payload as Record<string, unknown>;
    expect(payload.sessionId).toBeUndefined();
    expect(payload.agentSessionId).toBe('conversa-real-123');

    const persisted = (await workspaceRepository.getNode(node.id))!.payload as Record<string, unknown>;
    expect(persisted.sessionId).toBeUndefined();
    expect(persisted.agentSessionId).toBe('conversa-real-123');
  });

  it('preserva o ultimo diretorio valido de shell e descarta um caminho removido', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-shell-cwd-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'shell cwd', workingDir: '/tmp' });
    const valid = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Shell valido',
      payload: { command: '/bin/zsh', currentWorkingDir: dir },
    });
    const missing = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Shell removido',
      payload: { command: '/bin/zsh', currentWorkingDir: join(dir, 'missing') },
    });

    const listed = await workspaceService.listNodes(workspace.id);
    expect((listed.find((node) => node.id === valid.id)?.payload as Record<string, unknown>).currentWorkingDir).toBe(dir);
    expect((listed.find((node) => node.id === missing.id)?.payload as Record<string, unknown>).currentWorkingDir).toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });

  it('inicia conversa Claude ausente sem fallback especulativo e com a role nativa', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'recovery', workingDir: '/tmp' });
    await roleService.save(workspace.id, { name: 'Lider', prompt: 'Coordene o time.' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Claude',
      payload: {
        command: 'claude',
        provider: 'claude',
        sessionId: 'pty-antiga',
        agentSessionId: 'conversa-inexistente',
        role: 'Lider',
      },
    });
    vi.spyOn(agentSessionTracker, 'isAgentSessionResumable').mockReturnValue(false);

    const listed = await workspaceService.listNodes(workspace.id);
    const payload = listed.find((item) => item.id === node.id)!.payload as Record<string, unknown>;

    expect(payload.sessionId).toBeUndefined();
    expect(payload.agentSessionId).toBeUndefined();
    expect(payload.resumeRecovery).toBe(false);
    expect(payload.role).toBe('Lider');
    expect(payload.initialRoleArgs).toEqual(['--append-system-prompt', 'Coordene o time.']);
    expect(payload.roleConfiguredAtLaunch).toBe('Lider');
  });

  it('troca o provider e preserva a identidade organizacional do terminal', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'troca provider', workingDir: '/tmp' });
    const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Arquiteto',
      x: 345,
      y: 678,
      payload: {
        command: 'claude',
        args: ['--dangerously-skip-permissions'],
        provider: 'claude',
        sessionId: session.id,
        agentSessionId: 'claude-session',
        role: 'Arquiteto',
        maestro: true,
        floorId: 'floor-1',
        theme: 'emerald',
      },
    });
    vi.spyOn(getAgentAdapter('codex'), 'detect').mockResolvedValue({ installed: true, detail: 'test' });

    const changed = await workspaceService.changeTerminalProvider({
      workspaceId: workspace.id,
      nodeId: node.id,
      provider: 'codex',
    });
    const payload = changed!.payload as Record<string, unknown>;

    expect(payload.provider).toBe('codex');
    expect(payload.command).toBe('codex');
    expect(payload.args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(payload.sessionId).toBeUndefined();
    expect(payload.agentSessionId).toBeUndefined();
    expect(payload).toMatchObject({ role: 'Arquiteto', maestro: true, floorId: 'floor-1', theme: 'emerald' });
    expect(changed).toMatchObject({ title: 'Arquiteto', x: 345, y: 678 });
    expect(ptySessionManager.get(session.id)?.exited).not.toBe(false);
  });

  it('persiste somente a referencia do perfil, nunca seu ambiente resolvido', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'perfil seguro', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Codex perfil',
      payload: { command: 'claude', provider: 'claude' },
    });
    const profile = await providerProfileService.create({
      providerId: 'codex',
      name: 'Work',
      configDir: '/tmp/codex-work',
    });
    vi.spyOn(getAgentAdapter('codex'), 'detect').mockResolvedValue({ installed: true, detail: 'test' });

    const changed = await workspaceService.changeTerminalProvider({
      workspaceId: workspace.id,
      nodeId: node.id,
      provider: 'codex',
      profileId: profile.id,
    });
    const payload = changed!.payload as Record<string, unknown>;

    expect(payload.profileId).toBe(profile.id);
    expect(payload.env).not.toMatchObject({ CODEX_HOME: expect.anything() });
    expect(JSON.stringify(payload)).not.toContain('/tmp/codex-work');
  });

  it('altera o runtime de um unico terminal e preserva a sessao quando o ambiente efetivo nao muda', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-runtime-'));
    try {
      const workspace = await workspaceRepository.createWorkspace({ name: 'runtime misto', workingDir: dir });
      const session = ptySessionManager.create({ command: '/bin/cat', cwd: dir });
      const node = await workspaceRepository.createNode({
        workspaceId: workspace.id,
        type: 'terminal',
        title: 'Nativo',
        payload: {
          command: '/bin/cat',
          sessionId: session.id,
          agentSessionId: 'native-conversation',
          executionRuntime: { kind: 'native' },
        },
      });

      const changed = await workspaceService.changeTerminalRuntime({
        workspaceId: workspace.id,
        nodeId: node.id,
        mode: 'default',
        wslDistribution: null,
        wslWorkingDir: null,
      });
      const payload = changed!.payload as Record<string, unknown>;
      expect(payload.executionRuntime).toBeUndefined();
      expect(payload.sessionId).toBe(session.id);
      expect(payload.agentSessionId).toBe('native-conversation');
      expect(ptySessionManager.get(session.id)?.exited).toBe(false);
      ptySessionManager.kill(session.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('encerra somente o PTY afetado ao trocar de WSL para Windows nativo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-runtime-'));
    try {
      const workspace = await workspaceRepository.createWorkspace({ name: 'runtime wsl', workingDir: dir });
      const session = ptySessionManager.create({ command: '/bin/cat', cwd: dir });
      const untouchedSession = ptySessionManager.create({ command: '/bin/cat', cwd: dir });
      const node = await workspaceRepository.createNode({
        workspaceId: workspace.id,
        type: 'terminal',
        title: 'Misto',
        payload: {
          command: '/bin/cat',
          sessionId: session.id,
          agentSessionId: 'wsl-conversation',
          executionRuntime: {
            kind: 'wsl',
            distribution: 'Ubuntu-24.04',
            linuxWorkingDir: '/home/dev/project',
          },
        },
      });

      const changed = await workspaceService.changeTerminalRuntime({
        workspaceId: workspace.id,
        nodeId: node.id,
        mode: 'native',
        wslDistribution: null,
        wslWorkingDir: null,
      });
      const payload = changed!.payload as Record<string, unknown>;
      expect(payload.executionRuntime).toEqual({ kind: 'native' });
      expect(payload.sessionId).toBeUndefined();
      expect(payload.agentSessionId).toBeUndefined();
      expect(ptySessionManager.get(session.id)?.exited).not.toBe(false);
      expect(ptySessionManager.get(untouchedSession.id)?.exited).toBe(false);
      ptySessionManager.kill(untouchedSession.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
