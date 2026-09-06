import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { AgentFloor } from '$lib/modules/agent-room/domain/models/AgentFloor.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { AgentMessageEnvelope } from '$lib/modules/agent-room/domain/models/AgentMessageEnvelope.js';

describe('ControlCenterService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('reduz eventos append-only no estado atual sem apagar o histórico', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'control', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Codex',
      payload: { provider: 'codex', role: 'Reviewer' },
    });

    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'working',
      action: 'system:task_working',
      taskId: '019c-task',
      metadata: { taskTitle: 'Review delivery' },
    });
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'blocked',
      action: 'Waiting for API credentials',
      taskId: '019c-task',
    });

    const history = await controlCenterRepository.listActivity(workspace.id);
    const snapshot = await controlCenterService.snapshot(workspace.id);
    expect(history.map((event) => event.state)).toEqual(['working', 'blocked']);
    expect(snapshot.agents[0]).toMatchObject({
      nodeId: agent.id,
      state: 'disconnected',
      lastAction: 'Waiting for API credentials',
      sessionAlive: false,
    });
    expect(snapshot.counts.disconnected).toBe(1);
  });

  it('agrupa a trilha de entrega por messageId e conserva resposta confirmada', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'messages', workingDir: '/tmp' });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Leader' });
    const worker = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Worker' });
    const messageId = '019c-message';

    for (const state of ['queued', 'sent', 'delivered', 'acknowledged'] as const) {
      await controlCenterService.recordDelivery({
        messageId,
        workspaceId: workspace.id,
        fromNodeId: leader.id,
        toNodeId: worker.id,
        state,
        content: 'Review the change',
      });
    }
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId: workspace.id,
      fromNodeId: leader.id,
      toNodeId: worker.id,
      state: 'replied',
      content: 'Review the change',
      reply: 'Reviewed and approved',
    });

    const [thread] = (await controlCenterService.snapshot(workspace.id)).communications;
    expect(thread).toMatchObject({
      messageId,
      fromTitle: 'Leader',
      toTitle: 'Worker',
      state: 'replied',
      reply: 'Reviewed and approved',
    });
    expect(thread.events.map((event) => event.state)).toEqual([
      'queued',
      'sent',
      'delivered',
      'acknowledged',
      'replied',
    ]);
  });

  it('mantém um envelope canônico e torna retries idempotentes por estado', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'envelopes', workingDir: '/tmp' });
    const worker = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Worker' });
    const messageId = uuidv7();

    await controlCenterService.recordDelivery({
      messageId,
      workspaceId: workspace.id,
      toNodeId: worker.id,
      state: 'queued',
      content: 'Run the focused tests',
      metadata: { correlationId: 'task:focused-tests', dedupKey: 'focused-tests:worker' },
    });
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId: workspace.id,
      toNodeId: worker.id,
      state: 'sent',
      content: 'Run the focused tests',
      metadata: { correlationId: 'task:focused-tests', dedupKey: 'focused-tests:worker' },
    });
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId: workspace.id,
      toNodeId: worker.id,
      state: 'sent',
      content: 'Run the focused tests',
      metadata: { correlationId: 'task:focused-tests', dedupKey: 'focused-tests:worker' },
    });

    const envelope = await AgentMessageEnvelope.find(messageId);
    expect(envelope?.getAttribute('state')).toBe('sent');
    expect(envelope?.getAttribute('attempts')).toBe(1);
    expect(envelope?.getAttribute('content_hash')).toMatch(/^[a-f0-9]{64}$/);
    expect((await controlCenterRepository.listDeliveries(workspace.id)).map((event) => event.state)).toEqual(['queued', 'sent']);
  });

  it('abre e resolve atenção derivada de estado sem criar duplicatas', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'attention', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Reviewer' });

    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'blocked',
      action: 'Waiting for credentials',
      category: 'agent',
      verb: 'requested',
      objectType: 'permission',
      objectTitle: 'Credentials required',
      outcome: 'The review cannot continue without credentials.',
      severity: 'warning',
      attentionRequired: true,
    });
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'blocked',
      action: 'Waiting for credentials',
      category: 'agent',
      verb: 'requested',
      objectType: 'permission',
      objectTitle: 'Credentials required',
      outcome: 'The review cannot continue without credentials.',
      severity: 'warning',
      attentionRequired: true,
    });

    const open = await attentionService.list({ workspaceId: workspace.id });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      nodeId: agent.id,
      nodeTitle: 'Reviewer',
      title: 'Credentials required',
      status: 'open',
      severity: 'warning',
    });

    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'working',
      action: 'Review resumed',
    });
    expect(await attentionService.list({ workspaceId: workspace.id })).toEqual([]);
  });

  it('vincula a retomada da PTY à tarefa ativa e remove bloqueio obsoleto', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'resume blocked work', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Delivery lead' });
    const taskId = uuidv7();
    const now = new Date().toISOString();
    await AgentBoardTask.query().insert({
      id: taskId,
      workspace_id: workspace.id,
      title: 'Install and validate the build',
      description: null,
      status: 'doing',
      assignee_node_id: agent.id,
      image_path: null,
      images_json: null,
      attachments_json: null,
      note_node_id: null,
      created_by: 'automation',
      created_at: now,
      updated_at: now,
    });
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'blocked',
      action: 'Installed app must be closed',
      taskId,
      attentionRequired: true,
    });

    const recoveries: unknown[] = [];
    const lifecycle = globalThis as unknown as { __orkestraiRecoverBlockedTask?: (input: unknown) => void };
    const previousRecovery = lifecycle.__orkestraiRecoverBlockedTask;
    try {
      lifecycle.__orkestraiRecoverBlockedTask = (input) => recoveries.push(input);
      await controlCenterService.recordLifecycleActivity({
        workspaceId: workspace.id,
        nodeId: agent.id,
        state: 'disconnected',
        action: 'system:pty_disconnected',
        metadata: { sessionId: 'old-session' },
      });
      await controlCenterService.recordLifecycleActivity({
        workspaceId: workspace.id,
        nodeId: agent.id,
        state: 'starting',
        action: 'system:pty_resumed',
        metadata: { sessionId: 'resumed-session' },
      });
    } finally {
      if (previousRecovery) lifecycle.__orkestraiRecoverBlockedTask = previousRecovery;
      else delete lifecycle.__orkestraiRecoverBlockedTask;
    }

    const history = await controlCenterRepository.listActivity(workspace.id);
    expect(history.at(-1)).toMatchObject({ state: 'starting', taskId, action: 'system:pty_resumed' });
    expect(history.at(-1)?.metadata).toMatchObject({ taskTitle: 'Install and validate the build', lifecycle: true });
    expect(recoveries).toEqual([expect.objectContaining({ taskId, sessionId: 'resumed-session', previousState: 'blocked' })]);
    expect(await attentionService.list({ workspaceId: workspace.id })).toEqual([]);
  });

  it('preserva a recuperação até o TaskBoard registrar o handler global', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'pending recovery', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Release lead' });
    const taskId = uuidv7();
    const now = new Date().toISOString();
    await AgentBoardTask.query().insert({
      id: taskId,
      workspace_id: workspace.id,
      title: 'Resume release validation',
      description: null,
      status: 'doing',
      assignee_node_id: agent.id,
      image_path: null,
      images_json: null,
      attachments_json: null,
      note_node_id: null,
      created_by: 'automation',
      created_at: now,
      updated_at: now,
    });
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'blocked',
      action: 'Installed app was open',
      taskId,
    });

    const lifecycle = globalThis as unknown as {
      __orkestraiRecoverBlockedTask?: (input: unknown) => void;
      __orkestraiPendingTaskRecoveries?: unknown[];
    };
    const previousRecovery = lifecycle.__orkestraiRecoverBlockedTask;
    const previousPending = lifecycle.__orkestraiPendingTaskRecoveries;
    try {
      delete lifecycle.__orkestraiRecoverBlockedTask;
      lifecycle.__orkestraiPendingTaskRecoveries = [];
      await controlCenterService.recordLifecycleActivity({
        workspaceId: workspace.id,
        nodeId: agent.id,
        state: 'starting',
        action: 'system:pty_resumed',
        metadata: { sessionId: 'new-session' },
      });
      expect(lifecycle.__orkestraiPendingTaskRecoveries).toEqual([
        expect.objectContaining({ taskId, sessionId: 'new-session', previousState: 'blocked' }),
      ]);
    } finally {
      if (previousRecovery) lifecycle.__orkestraiRecoverBlockedTask = previousRecovery;
      else delete lifecycle.__orkestraiRecoverBlockedTask;
      lifecycle.__orkestraiPendingTaskRecoveries = previousPending;
    }
  });

  it('preserva a mensagem completa e desabilita navegação para um agente removido', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'attention source', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'QA Web' });
    const content = 'Revise toda a matriz de QA, incluindo operações, teclado, acessibilidade e os casos-limite descritos na tarefa.';

    await controlCenterService.recordDelivery({
      messageId: uuidv7(),
      workspaceId: workspace.id,
      toNodeId: agent.id,
      state: 'failed',
      content,
      error: 'Structured transcript could not be confirmed.',
    });

    const [beforeDelete] = await attentionService.list({ workspaceId: workspace.id });
    expect(beforeDelete).toMatchObject({
      nodeTitle: 'QA Web',
      sourceContent: content,
      actionAvailable: true,
    });

    await workspaceRepository.deleteNode(agent.id);
    const [afterDelete] = await attentionService.list({ workspaceId: workspace.id });
    expect(afterDelete).toMatchObject({
      nodeTitle: null,
      sourceContent: content,
      actionAvailable: false,
    });
  });

  it('reconstrói agentes desconectados sem criar ou acordar sessões PTY', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'restart', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Idle agent' });
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'idle',
      action: 'Waiting for work',
    });
    const sessionsBefore = ptySessionManager.list().length;

    const snapshot = await controlCenterService.snapshot(workspace.id);

    expect(ptySessionManager.list()).toHaveLength(sessionsBefore);
    expect(snapshot.agents[0].state).toBe('disconnected');
  });

  it('mostra o andar de agentes ativos e ignora registros de andares encerrados', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'floors', workingDir: '/tmp' });
    const floor = await AgentFloor.create({
      id: uuidv7(),
      workspace_id: workspace.id,
      name: 'Feature checkout',
      branch: 'orkestrai/feature-checkout',
      path: '/tmp/feature-checkout',
      status: 'active',
    });
    const agent = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      floorId: String(floor.getAttribute('id')),
      type: 'terminal',
      title: 'Frontend',
      payload: { provider: 'codex' },
    });

    expect((await controlCenterService.snapshot(workspace.id)).agents[0]).toMatchObject({
      nodeId: agent.id,
      floorId: floor.getAttribute('id'),
      floorName: 'Feature checkout',
    });

    await AgentFloor.query().where('id', floor.getAttribute('id')).update({ status: 'landed' });
    expect((await controlCenterService.snapshot(workspace.id)).agents).toEqual([]);
  });

  it('remove a telemetria antes de apagar o workspace', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'delete', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Agent' });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: agent.id, state: 'idle' });
    await controlCenterService.recordDelivery({
      workspaceId: workspace.id,
      toNodeId: agent.id,
      state: 'queued',
      content: 'hello',
    });

    expect(await workspaceRepository.deleteWorkspace(workspace.id)).toBe(true);
    expect(await controlCenterRepository.listActivity(workspace.id)).toEqual([]);
    expect(await controlCenterRepository.listDeliveries(workspace.id)).toEqual([]);
  });
});
