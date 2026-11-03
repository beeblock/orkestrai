import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { ControlCenterService, controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { AgentFloor } from '$lib/modules/agent-room/domain/models/AgentFloor.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { AgentMessageEnvelope } from '$lib/modules/agent-room/domain/models/AgentMessageEnvelope.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { orchestrationStatsService } from '$lib/modules/agent-room/application/services/OrchestrationStatsService.js';

describe('ControlCenterService', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.restoreAllMocks());

  it('bounds transcript reconciliation to four reads and drains the remaining agents fairly', async () => {
    const service = new ControlCenterService();
    const workspace = await workspaceRepository.createWorkspace({ name: 'large quiet team', workingDir: '/tmp' });
    const sessions = new Map<string, any>();
    for (let i = 0; i < 9; i++) {
      const id = `quiet-${i}`;
      const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', payload: { provider: 'codex', sessionId: id } });
      sessions.set(id, { id, nodeId: node.id, workspaceId: workspace.id, provider: 'codex', agentSessionId: `conversation-${i}`,
        cwd: '/tmp', runtimeKey: 'native', waiting: true, exited: false, createdAt: '2026-11-03T12:00:00Z', lastActivityAt: '2026-11-03T13:00:00Z' });
    }
    vi.spyOn(ptySessionManager, 'get').mockImplementation(id => sessions.get(id) ?? null);
    const releases: Array<() => void> = [];
    let active = 0, peak = 0;
    const boundary = vi.spyOn(transcript, 'latestTurnBoundary').mockImplementation(() => {
      peak = Math.max(peak, ++active);
      return new Promise(resolve => releases.push(() => { active--; resolve({ ready: false, startedAt: Date.now(), finishedAt: null }); }));
    });
    for (const id of sessions.keys()) { service.queueTerminalActivity(id); service.queueTerminalActivity(id); }
    await vi.waitFor(() => expect(boundary).toHaveBeenCalledTimes(4));
    // A slow member occupies one read, leaving the remaining slots for its peers.
    for (let expected = 5; expected <= 9; expected++) {
      releases.shift()!();
      await vi.waitFor(() => expect(boundary).toHaveBeenCalledTimes(expected));
    }
    for (const release of releases.splice(0)) release();
    await vi.waitFor(async () => expect((await service.snapshot(workspace.id)).counts.working).toBe(9));
    expect(peak).toBe(4);
    expect(boundary).toHaveBeenCalledTimes(9); // Snapshot itself never reads a transcript.
  });

  it('does not multiply stalled UNC reads across retries or hold the status request', async () => {
    const service = new ControlCenterService();
    const workspace = await workspaceRepository.createWorkspace({ name: 'unavailable transcript', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', payload: { provider: 'codex', sessionId: 'unc-pty' } });
    const session = { id: 'unc-pty', nodeId: node.id, workspaceId: workspace.id, provider: 'codex', agentSessionId: 'conversation',
      cwd: '/home/worker/project', runtimeKey: 'wsl:Ubuntu', waiting: true, exited: false,
      createdAt: '2026-11-03T12:00:00Z', lastActivityAt: '2026-11-03T13:00:00Z' };
    vi.spyOn(ptySessionManager, 'get').mockReturnValue(session as never);
    let release!: (value: transcript.TranscriptTurnBoundary) => void;
    const boundary = vi.spyOn(transcript, 'latestTurnBoundary').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await service.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'working' });
    const first = service.reconcileTerminalActivity(session.id);
    await vi.waitFor(() => expect(boundary).toHaveBeenCalledTimes(1));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6_000);
    const retry = service.reconcileTerminalActivity(session.id);
    const before = performance.now();
    expect((await service.snapshot(workspace.id)).agents[0].state).toBe('working');
    expect(performance.now() - before).toBeLessThan(1_000);
    await Promise.all([first, retry]); // Caller timeout does not release the actual I/O slot.
    expect(boundary).toHaveBeenCalledTimes(1);
    release({ ready: null, startedAt: null, finishedAt: null });
    expect((await controlCenterRepository.latestActivity(node.id))?.state).toBe('working');
  });

  it('keeps a quiet provider working until its exact turn completes, then broadcasts idle without a terminal redraw', async () => {
    const service = new ControlCenterService();
    const workspace = await workspaceRepository.createWorkspace({ name: 'quiet inference', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal',
      payload: { provider: 'codex', sessionId: 'quiet-pty' } });
    const session = { id: 'quiet-pty', workspaceId: workspace.id, nodeId: node.id, provider: 'codex',
      cwd: '/tmp', runtimeKey: 'native', agentSessionId: 'exact-conversation', waiting: true, exited: false,
      createdAt: '2026-11-03T12:00:00Z', lastActivityAt: '2026-11-03T13:00:00Z' };
    vi.spyOn(ptySessionManager, 'get').mockImplementation(id => id === session.id ? session as never : null);
    const boundary = vi.spyOn(transcript, 'latestTurnBoundary').mockResolvedValue({ ready: false, startedAt: Date.parse(session.lastActivityAt), finishedAt: null });
    await service.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'working' });
    await service.recordLifecycleActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'idle', metadata: { sessionId: session.id } });
    expect((await service.snapshot(workspace.id)).agents[0].state).toBe('working');
    // Completion is written only to the transcript; no new PTY data wakes the quiet timer.
    boundary.mockResolvedValue({ ready: true, startedAt: Date.parse(session.lastActivityAt), finishedAt: Date.now() });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16_000);
    await service.reconcileTerminalActivity(session.id);
    expect((await service.snapshot(workspace.id)).agents[0].state).toBe('idle');
    expect(session.waiting).toBe(true); // Composer admission remains independent of the activity label.
    expect(boundary).toHaveBeenCalledWith('codex', '/tmp', 'exact-conversation', expect.objectContaining({ processStartedAt: Date.parse(session.createdAt), posixCwd: false }));
    await service.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'done', action: 'Delivery verified' });
    await service.reconcileTerminalActivity(session.id);
    expect((await service.snapshot(workspace.id)).agents[0].state).toBe('done');
    boundary.mockResolvedValue({ ready: false, startedAt: Date.now(), finishedAt: null });
    vi.mocked(Date.now).mockReturnValue(Date.now() + 16_000);
    await service.reconcileTerminalActivity(session.id);
    expect((await service.snapshot(workspace.id)).agents[0].state).toBe('working');
  });

  it('does not let slow transcript reads overwrite a newer terminal or an explicit blocker', async () => {
    const service = new ControlCenterService();
    const workspace = await workspaceRepository.createWorkspace({ name: 'stale observation', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', payload: { provider: 'claude', sessionId: 'old-pty' } });
    let session = { id: 'old-pty', workspaceId: workspace.id, nodeId: node.id, provider: 'claude',
      cwd: '/home/worker/project', transcriptHome: '/host/wsl/home/worker', runtimeKey: 'wsl:Ubuntu',
      agentSessionId: 'conversation', waiting: true, exited: false, createdAt: '2026-11-03T12:00:00Z', lastActivityAt: '2026-11-03T13:00:00Z' };
    vi.spyOn(ptySessionManager, 'get').mockImplementation(id => id === session.id ? session as never : null);
    vi.spyOn(ptySessionManager, 'transcriptStorageRoots').mockReturnValue({ claudeConfigDir: '/host/wsl/work-profile' });
    let resolve!: (value: transcript.TranscriptTurnBoundary) => void;
    const boundary = vi.spyOn(transcript, 'latestTurnBoundary').mockImplementation(() => new Promise(done => { resolve = done; }));
    await service.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'working' });
    const pending = service.recordLifecycleActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'idle', metadata: { sessionId: 'old-pty' } });
    await vi.waitFor(() => expect(boundary).toHaveBeenCalledTimes(1));
    session = { ...session, id: 'replacement-pty' };
    resolve({ ready: true, startedAt: 1, finishedAt: 2 });
    await pending;
    expect((await controlCenterRepository.latestActivity(node.id))?.state).toBe('working');
    expect(boundary).toHaveBeenCalledWith('claude', '/home/worker/project', 'conversation', expect.objectContaining({ homeDir: '/host/wsl/home/worker', claudeConfigDir: '/host/wsl/work-profile', posixCwd: true }));
    await workspaceRepository.updateNode(node.id, { payload: { provider: 'claude', sessionId: session.id } });
    boundary.mockResolvedValue({ ready: false, startedAt: Date.now(), finishedAt: null });
    await service.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'blocked', action: 'Explicit workspace gate' });
    await service.reconcileTerminalActivity(session.id);
    expect((await controlCenterRepository.latestActivity(node.id))?.state).toBe('blocked');
  });

  it('counts and finds queued messages after the former 5,000-envelope cutoff without loading content', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'stats pages', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Recipient' });
    const created = new Date(Date.now() - 10_000).toISOString();
    const rows = Array.from({ length: 5001 }, (_, i) => ({ id: uuidv7(), workspace_id: workspace.id, to_node_id: node.id,
      kind: 'ask', state: i === 5000 ? 'queued' : 'delivered', content: 'Do not load this body '.repeat(40), content_hash: 'test',
      metadata_json: JSON.stringify({ inbox: true }), created_at: created, updated_at: created,
      delivered_at: i === 5000 ? null : new Date(Date.parse(created) + 2000).toISOString() }));
    for (let i = 0; i < rows.length; i += 500) await AgentMessageEnvelope.query().insertMany(rows.slice(i, i + 500));
    const metrics = await orchestrationStatsService.workspace(workspace.id, 168);
    expect(metrics.messages).toMatchObject({ total: 5001, queued: 1, failed: 0, deliverySeconds: { p50: 2, p95: 2 } });
    expect(metrics.inboxes).toMatchObject([{ nodeId: node.id, queued: 1 }]);
    for await (const page of controlCenterRepository.inboxStatsPages(workspace.id, created, new Date().toISOString())) {
      expect(page.length).toBeLessThanOrEqual(500);
      for (const item of page) expect(item).not.toHaveProperty('content');
    }
  });

  it('does not let terminal redraws or silence erase a reported blocker', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'blocked terminal', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'blocked', action: 'Portal cannot load', attentionRequired: true });
    for (const state of ['idle', 'working'] as const) {
      await controlCenterService.recordLifecycleActivity({ workspaceId: workspace.id, nodeId: node.id, state });
    }
    expect(await controlCenterRepository.latestActivity(node.id)).toMatchObject({ state: 'blocked', action: 'Portal cannot load' });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'working', action: 'Portal repaired and verified' });
    expect(await controlCenterRepository.latestActivity(node.id)).toMatchObject({ state: 'working', action: 'Portal repaired and verified' });
  });

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

  it('oferece retomada a um agente que estava trabalhando quando a PTY caiu', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'resume interrupted work', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Currency' });
    const taskId = uuidv7();
    const now = new Date().toISOString();
    await AgentBoardTask.query().insert({
      id: taskId, workspace_id: workspace.id, title: 'Currency symbol upload', description: null, status: 'doing',
      assignee_node_id: agent.id, image_path: null, images_json: null, attachments_json: null, note_node_id: null,
      created_by: 'automation', created_at: now, updated_at: now,
    });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: agent.id, state: 'working', action: 'Wiring the upload', taskId });

    const recoveries: unknown[] = [];
    const lifecycle = globalThis as unknown as { __orkestraiRecoverBlockedTask?: (input: unknown) => void };
    const previousRecovery = lifecycle.__orkestraiRecoverBlockedTask;
    try {
      lifecycle.__orkestraiRecoverBlockedTask = (input) => recoveries.push(input);
      await controlCenterService.recordLifecycleActivity({
        workspaceId: workspace.id, nodeId: agent.id, state: 'starting', action: 'system:pty_resumed', metadata: { sessionId: 'resumed-session' },
      });
    } finally {
      if (previousRecovery) lifecycle.__orkestraiRecoverBlockedTask = previousRecovery;
      else delete lifecycle.__orkestraiRecoverBlockedTask;
    }
    expect(recoveries).toEqual([expect.objectContaining({ taskId, sessionId: 'resumed-session', previousState: 'working' })]);
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

  it('keeps a blocked agent on its own item while it exchanges messages', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'blocked messages', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Dev Plataforma', payload: { provider: 'claude' } });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: agent.id, state: 'blocked', action: 'Waiting for disk space' });
    // The leader's answer reaches the blocked agent, and the agent replies.
    for (const action of ['system:message_received', 'system:message_replied']) {
      await controlCenterService.recordActivity({
        workspaceId: workspace.id,
        nodeId: agent.id,
        state: 'blocked',
        action,
        category: 'message',
        objectTitle: 'Resposta de Claude à sua mensagem: feito',
        outcome: 'Recebido',
        correlationId: 'task:blocked-messages',
        sourceType: 'bridge',
        sourceId: uuidv7(),
      });
    }

    const open = await attentionService.list({ workspaceId: workspace.id });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ sourceType: 'agent_state', title: 'Waiting for disk space' });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: agent.id, state: 'working', action: 'Queue resumed' });
    expect(await attentionService.list({ workspaceId: workspace.id })).toEqual([]);
  });

  it('closes what a removed agent left for the owner, now and at startup', async () => {
    vi.spyOn(workspaceService as never as { reprovisionBridge: () => Promise<void> }, 'reprovisionBridge').mockResolvedValue(undefined);
    const workspace = await workspaceRepository.createWorkspace({ name: 'removed agents', workingDir: '/tmp' });
    const removed = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Naming', payload: { provider: 'claude' } });
    const earlier = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Brand Designer 2', payload: { provider: 'claude' } });
    const kept = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Claude', payload: { provider: 'claude' } });
    for (const node of [removed, earlier, kept]) {
      await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state: 'blocked', action: `${node.title} needs the owner`, attentionRequired: true });
    }

    await workspaceService.deleteNode(workspace.id, removed.id);
    expect((await attentionService.list({ workspaceId: workspace.id })).map((item) => item.nodeId).sort()).toEqual([earlier.id, kept.id].sort());

    // Removed before removal closed its items: startup closes them.
    await workspaceRepository.deleteNode(earlier.id);
    expect(await attentionService.resolveOrphaned()).toBe(1);
    expect((await attentionService.list({ workspaceId: workspace.id })).map((item) => item.nodeId)).toEqual([kept.id]);
  });

  it('hands a blocked teammate to the leader instead of the owner', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'team attention', workingDir: '/tmp' });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Claude', payload: { provider: 'claude', maestro: true } });
    const dev = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Dev Chat Realtime UI', payload: { provider: 'claude' } });
    const { agentInboxService } = await import('$lib/modules/agent-room/application/services/AgentInboxService.js');
    const enqueue = vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);

    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: dev.id, state: 'blocked', action: 'Docker daemon 500', attentionRequired: true });
    expect(await attentionService.list({ workspaceId: workspace.id })).toEqual([]);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ toNodeId: leader.id, fromNodeId: dev.id, content: expect.stringContaining('Dev Chat Realtime UI está bloqueado: Docker daemon 500') }));

    // The teammate's own approval request for the owner stays when it gets blocked again.
    await attentionService.raise({ workspaceId: workspace.id, nodeId: dev.id, category: 'review', severity: 'warning', title: 'Publicar o pacote?', sourceType: 'autonomy_gate', sourceId: 'gate-1', correlationId: 'gate:gate-1' });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: dev.id, state: 'blocked', action: 'Esperando a aprovação do dono', attentionRequired: true });
    expect((await attentionService.list({ workspaceId: workspace.id })).map((item) => item.sourceType)).toEqual(['autonomy_gate']);
    await attentionService.resolveSource(workspace.id, 'autonomy_gate', 'gate-1');

    // A terminal dialog waiting for a key press, and the leader's own state, still reach the owner.
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: dev.id, state: 'waiting_permission', action: 'Allow Bash?' });
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: leader.id, state: 'blocked', action: 'Precisa da chave da API', attentionRequired: true });
    expect((await attentionService.list({ workspaceId: workspace.id })).map((item) => item.nodeId).sort()).toEqual([dev.id, leader.id].sort());
  });

  it('hands to the leader, at startup, the teammate requests earlier versions raised', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'team startup', workingDir: '/tmp' });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Claude', payload: { provider: 'claude', maestro: true } });
    const dev = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Dev', payload: { provider: 'codex' } });
    const { attentionRepository } = await import('$lib/modules/agent-room/infrastructure/repositories/AttentionRepository.js');
    for (const node of [dev, leader]) {
      await attentionRepository.save({ workspaceId: workspace.id, nodeId: node.id, category: 'agent', severity: 'warning', title: 'Bloqueado', sourceType: 'agent_state', sourceId: node.id, correlationId: `agent:${node.id}:agent` });
    }
    expect(await attentionService.handTeammateItemsToLeader()).toBe(1);
    expect((await attentionService.list({ workspaceId: workspace.id })).map((item) => item.nodeId)).toEqual([leader.id]);
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
