import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { tmpdir } from 'node:os';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { agentLearningService } from '$lib/modules/agent-room/application/services/AgentLearningService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { agentTerminalDeliveryService } from '$lib/modules/agent-room/application/services/AgentTerminalDeliveryService.js';
import { taskExecutionRepository } from '$lib/modules/agent-room/infrastructure/repositories/TaskExecutionRepository.js';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
import { AgentCanvasNode } from '$lib/modules/agent-room/domain/models/AgentCanvasNode.js';

async function team() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'Heavy creative workspace', workingDir: tmpdir() });
  const sessionId = uuidv7();
  const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Worker',
    payload: { provider: 'codex', command: 'codex', sessionId } });
  vi.spyOn(ptySessionManager, 'get').mockImplementation(id => id === sessionId ? {
    id, workspaceId: workspace.id, nodeId: agent.id, provider: 'codex', exited: false, command: 'codex', args: [],
    runtimeKey: 'native', cwd: tmpdir(), transcriptCwd: tmpdir(), agentSessionId: 'fixture-conversation',
    createdAt: new Date(Date.now() - 60000).toISOString(), waiting: true, hasOutput: true,
  } as never : null);
  vi.spyOn(agentInboxService, 'kick').mockImplementation(() => {});
  return { workspace, agent };
}

describe('task dispatch before optional context or Canvas payload work', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(async () => { await agentInboxService.sweepNow(); agentInboxService.reset(); vi.restoreAllMocks(); });

  it('queues an assigned task promptly even if optional learning never returns', async () => {
    const { workspace, agent } = await team();
    let resolveContext!: (value: string) => void;
    vi.spyOn(agentLearningService, 'context').mockImplementation(() => new Promise(resolve => { resolveContext = resolve; }));
    const pending = taskBoardService.create(workspace.id, { title: 'Deliver the assigned work', assigneeNodeId: agent.id });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const task = await Promise.race([pending, new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 1500); })]);
      expect(task, 'Optional recall must not keep a saved assignment outside the inbox').not.toBeNull();
      expect(await controlCenterRepository.inboxEnvelopes(agent.id, ['queued'])).toEqual([
        expect.objectContaining({ kind: 'task', metadata: expect.objectContaining({ taskId: task!.id }) }),
      ]);
    } finally { clearTimeout(deadline); resolveContext(''); await pending; }
  });

  it('automatically dispatches assigned work among 3,000 images without loading their payloads', async () => {
    const { workspace, agent } = await team();
    vi.spyOn(agentLearningService, 'context').mockResolvedValue('');
    const at = new Date().toISOString(), marker = 'UNRELATED_IMAGE_PAYLOAD';
    await AgentCanvasNode.query().insertMany(Array.from({ length: 3000 }, (_, i) => ({
      id: uuidv7(), workspace_id: workspace.id, type: 'image', title: `Asset ${i}`, x: i, y: 0,
      payload_json: JSON.stringify({ path: `generated/${i}.png`, marker, metadata: 'x'.repeat(256) }), created_at: at, updated_at: at,
    })));
    const parse = JSON.parse;
    let imagePayloadReads = 0;
    vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      if (typeof text === 'string' && text.includes(marker)) imagePayloadReads++;
      return parse(text, reviver);
    });
    vi.mocked(agentInboxService.kick).mockRestore();
    vi.spyOn(ptySessionManager, 'canAcceptAutomaticMessage').mockReturnValue(true);
    vi.spyOn(transcript, 'latestTurnBoundary').mockResolvedValue({ ready: true, startedAt: null, finishedAt: null });
    const deliver = vi.spyOn(agentTerminalDeliveryService, 'deliver').mockImplementation(async input => {
      input.onSubmitted?.({ revision: 0, length: 0, at: Date.now() } as never);
    });
    const task = await taskBoardService.create(workspace.id, { title: 'Work among generated images', assigneeNodeId: agent.id });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce(), { timeout: 1500 });
    await vi.waitFor(async () => expect(await taskExecutionRepository.current(workspace.id, task.id))
      .toMatchObject({ state: 'running', acceptedAt: expect.any(String) }));
    expect(await controlCenterRepository.inboxEnvelopes(agent.id, ['delivered']))
      .toEqual([expect.objectContaining({ kind: 'task', metadata: expect.objectContaining({ taskId: task.id }) })]);
    expect((await taskBoardService.list(workspace.id))[0].assigneeTitle).toBe('Worker');
    expect(imagePayloadReads, 'Agent routing must not deserialize image metadata to find agent names').toBe(0);
  });
});
