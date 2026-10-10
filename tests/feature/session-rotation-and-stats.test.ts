import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { agentSessionRotationService } from '$lib/modules/agent-room/application/services/AgentSessionRotationService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { orchestrationStatsService } from '$lib/modules/agent-room/application/services/OrchestrationStatsService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

const MIB = 1024 * 1024;

describe('Agent session rotation', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => {
    agentInboxService.reset();
    vi.restoreAllMocks();
  });

  it('opens a fresh conversation with a handoff when a stopped agent transcript is oversized', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'rotation', workingDir: '/tmp' });
    const leader = await workspaceRepository.createNode({
      workspaceId: workspace.id, type: 'terminal', title: 'Codex Lider',
      payload: { command: 'codex', provider: 'codex', agentSessionId: 'huge-conversation', maestro: true, role: 'líder' },
    });
    const small = await workspaceRepository.createNode({
      workspaceId: workspace.id, type: 'terminal', title: 'Codex Web',
      payload: { command: 'codex', provider: 'codex', agentSessionId: 'small-conversation' },
    });
    await taskBoardService.create(workspace.id, { title: 'Integrar logo e bio', assigneeNodeId: leader.id, dispatch: false });
    vi.spyOn(transcript, 'transcriptSizeBytes').mockImplementation((_provider, _cwd, sessionId) => (sessionId === 'huge-conversation' ? 1024 * MIB : 20 * MIB));

    const rotated = await agentSessionRotationService.rotateOversized();

    expect(rotated).toEqual([expect.objectContaining({ nodeId: leader.id, sizeBytes: 1024 * MIB })]);
    const payload = (await workspaceRepository.getNode(leader.id))?.payload as Record<string, unknown>;
    expect(payload.agentSessionId).toBeUndefined();
    expect(payload.sessionHandoff).toMatchObject({ previousAgentSessionId: 'huge-conversation' });
    expect((await workspaceRepository.getNode(small.id))?.payload).toMatchObject({ agentSessionId: 'small-conversation' });
    const handoff = (await controlCenterRepository.inboxEnvelopes(leader.id, ['queued'])).find((envelope) => envelope.kind === 'handoff')!;
    expect(handoff).toMatchObject({ kind: 'handoff', metadata: expect.objectContaining({ wake: false }) });
    expect(handoff.content).toContain('[orkestrai:handoff]');
    expect(handoff.content).toContain('Integrar logo e bio');
  });

  it('never rotates a conversation whose terminal is running', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'live', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id, type: 'terminal', title: 'Live agent',
      payload: { command: 'codex', provider: 'codex', agentSessionId: 'live-conversation' },
    });
    vi.spyOn(ptySessionManager, 'listLiveForNode').mockReturnValue([{ id: 'pty' } as never]);
    vi.spyOn(transcript, 'transcriptSizeBytes').mockReturnValue(2048 * MIB);
    expect(await agentSessionRotationService.rotateOversized()).toEqual([]);
    expect((await workspaceRepository.getNode(node.id))?.payload).toMatchObject({ agentSessionId: 'live-conversation' });
  });
});

describe('Orchestration stats', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => {
    agentInboxService.reset();
    vi.restoreAllMocks();
  });

  it('reports message latency, inbox depth and throughput', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'stats', workingDir: '/tmp' });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Lider', payload: { command: 'codex', provider: 'codex' } });
    const web = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Web', payload: { command: 'codex', provider: 'codex' } });
    vi.spyOn(agentInboxService, 'kick').mockImplementation(() => undefined);
    const answered = await agentInboxService.enqueue({ workspaceId: workspace.id, fromNodeId: web.id, toNodeId: leader.id, kind: 'ask', content: 'Revisar?', messageId: uuidv7() });
    await agentInboxService.recordDirect({ workspaceId: workspace.id, fromNodeId: leader.id, toNodeId: web.id, kind: 'ask', content: 'Ok', via: 'test' });
    await agentInboxService.routeReply(answered.id, 'Aprovado', { source: 'explicit', responderNodeId: leader.id });
    await agentInboxService.enqueue({ workspaceId: workspace.id, fromNodeId: leader.id, toNodeId: web.id, kind: 'ask', content: 'Ainda na fila' });
    const task = await taskBoardService.create(workspace.id, { title: 'Entregar', assigneeNodeId: web.id, dispatch: false });
    await taskBoardService.update(workspace.id, task.id, { status: 'done', notifyCompletion: false });

    const stats = await orchestrationStatsService.workspace(workspace.id, 24);

    expect(stats.messages).toMatchObject({ replied: 1, failed: 0 });
    expect(stats.messages.queued).toBeGreaterThanOrEqual(1);
    expect(stats.messages.replySeconds.p50).not.toBeNull();
    expect(stats.inboxes).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Web', queued: expect.any(Number) })]));
    expect(stats.tasks).toMatchObject({ created: 1, done: 1, open: 0 });
  });
});
