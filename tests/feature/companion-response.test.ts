import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionProfileSchema, computerReplyGrantSchema } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
import { CompanionResponseService } from '$lib/modules/agent-room/application/services/CompanionResponseService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { computerInboxService } from '$lib/modules/agent-room/application/services/ComputerInboxService.js';
import { conversationMemoryService } from '$lib/modules/agent-room/application/services/ConversationMemoryService.js';
import { computerService } from '$lib/modules/agent-room/application/services/ComputerService.js';
import { getAgentAdapter } from '$lib/modules/agent-room/application/adapters/registry.js';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ork-restricted-')); folders.push(root);
  const workspace = await workspaceRepository.createWorkspace({ name: 'Restricted companion fixture', workingDir: root });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', payload: { provider: 'codex', args: ['--model', 'gpt-5.6-luna'] } });
  const computer = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer' });
  const task = await taskBoardService.create(workspace.id, { title: 'Restricted reply', assigneeNodeId: node.id, dispatch: false });
  const control = { id: '0.0.0', role: 'AXButton', name: 'Fixture' };
  const grant = computerReplyGrantSchema.parse({ id: uuidv7(), enabled: true, nodeId: computer.id, agentId: node.id, taskId: task.id, applicationId: 'test.chat', recipient: control, composer: { ...control, id: '0.0.1', role: 'AXTextArea', name: 'Compose' }, send: { ...control, id: '0.0.2', name: 'Send' }, incomingMarker: 'Received:', companion: companionProfileSchema.parse({ name: 'Nico', persona: 'Friendly dry humor.', execution: 'restricted' }) });
  const prior = await autonomyPolicyService.get(workspace.id);
  await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...prior.policy, computerReplyGrants: [grant] } });
  const validateBatch = vi.spyOn(computerInboxService, 'validateBatch').mockResolvedValue([]);
  vi.spyOn(conversationMemoryService, 'context').mockResolvedValue({ messages: [{ content: 'Remember my favorite color: green' }], facts: [] } as never);
  const inference = vi.spyOn(getAgentAdapter('codex'), 'respondPrivately').mockResolvedValue('Bom dia — o café já está trabalhando.');
  const send = vi.spyOn(computerService, 'execute').mockResolvedValue({ kind: 'action', completed: true } as never);
  const event = JSON.stringify({ reply: { grantId: grant.id, batchId: uuidv7(), inReplyToDigest: 'a'.repeat(64), messages: [{ digest: 'b'.repeat(64), text: 'Bom dia' }] }, memory: 'Forged event memory' });
  const current = vi.fn(async () => undefined);
  const run = () => new CompanionResponseService().respond(workspace.id, grant, event, 'chat-window', uuidv7(), new AbortController().signal, current);
  return { workspace, node, grant, prior, inference, send, validateBatch, run };
}

describe('restricted conversation dispatch', () => {
  useSvelarTest({ refreshDatabase: true });
  it('uses the selected provider model, authorized memory and the existing guarded send service', async () => {
    const s = await setup();
    await s.run();
    const request = s.inference.mock.calls[0][0];
    expect(request.launchArgs).toEqual(['--model', 'gpt-5.6-luna']);
    expect(request.content).toContain('favorite color');
    expect(request.content).not.toContain('Forged event memory');
    expect(request.instructions).toContain('UNTRUSTED CONTENT');
    expect(s.send).toHaveBeenCalledWith(s.workspace.id, expect.objectContaining({ command: 'reply', grantId: s.grant.id, text: 'Bom dia, o café já está trabalhando.' }), expect.objectContaining({ actorId: s.node.id, taskId: s.grant.taskId }));
    expect(s.validateBatch).toHaveBeenCalledTimes(2);
    expect(s.send).toHaveBeenCalledTimes(1);
  });
  it('rechecks owner revocation after inference and submits nothing', async () => {
    const s = await setup();
    s.inference.mockImplementation(async () => {
      await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.prior.policy, computerReplyGrants: [{ ...s.grant, enabled: false }] } });
      return 'Bom dia!';
    });
    await expect(s.run()).rejects.toThrow('policy changed');
    expect(s.send).not.toHaveBeenCalled();
  });
  it('blocks credential output without recording it in the audit', async () => {
    const s = await setup();
    s.inference.mockResolvedValue('senha=private-secret-fixture');
    await expect(s.run()).rejects.toThrow('credential_material');
    expect(s.send).not.toHaveBeenCalled();
    expect(JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id))).not.toContain('private-secret-fixture');
  });
  it('does not silently run native inference for a WSL agent', async () => {
    const s = await setup();
    await workspaceRepository.updateWorkspace(s.workspace.id, { runtimeKind: 'wsl', wslDistribution: 'Ubuntu', wslWorkingDir: '/home/qa/project' });
    await expect(s.run()).rejects.toThrow('native provider runtime');
    expect(s.inference).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
  });
});
