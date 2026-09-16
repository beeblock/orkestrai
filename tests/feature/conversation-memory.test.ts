import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { createHash } from 'node:crypto';
import { ConversationMemoryService } from '$lib/modules/agent-room/application/services/ConversationMemoryService.js';
import { ComputerInboxService } from '$lib/modules/agent-room/application/services/ComputerInboxService.js';
import { conversationMemoryRepository } from '$lib/modules/agent-room/infrastructure/repositories/ConversationMemoryRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { computerReplyGrantSchema } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
import { AgentComputerAction } from '$lib/modules/agent-room/domain/models/AgentComputerAction.js';
import { AgentConversationMessage } from '$lib/modules/agent-room/domain/models/AgentConversationMessage.js';
import { AgentConversationMemory } from '$lib/modules/agent-room/domain/models/AgentConversationMemory.js';
import type { ComputerAccessibility } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
async function setup(enabled = true) {
  const workspace = await workspaceRepository.createWorkspace({ name: 'Private companion', workingDir: '/tmp' });
  const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Companion' });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['chat.test'] } } });
  const task = await taskBoardService.create(workspace.id, { title: 'Approved conversation', assigneeNodeId: agent.id, dispatch: false });
  const grant = computerReplyGrantSchema.parse({ id: uuidv7(), enabled: true, nodeId: node.id, agentId: agent.id, taskId: task.id, applicationId: 'chat.test', recipient: { id: '0.0.0', role: 'AXButton', name: 'Contact A' }, composer: { id: '0.0.1', role: 'AXTextArea', name: 'Message' }, send: { id: '0.0.2', role: 'AXButton', name: 'Send' }, incomingMarker: 'Incoming:', memoryEnabled: enabled });
  const previous = await autonomyPolicyService.get(workspace.id);
  const policy = await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...previous.policy, capabilities: ['computer'], allowedApps: ['chat.test'], computerReplyGrants: [grant] } });
  const service = new ConversationMemoryService();
  const actor = { actorType: 'agent' as const, actorId: agent.id, taskId: task.id };
  const search = () => service.execute(workspace.id, { command: 'memory_search', grantId: grant.id, query: '', limit: 50 }, actor);
  return { workspace, agent, node, task, grant, policy, service, actor, search };
}

describe('Private durable conversation memory', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.restoreAllMocks());

  it('retrieves sourced facts after two weeks and service restart without leaking private text into audit', async () => {
    const s = await setup();
    const text = 'Private preference: report every Monday, no olives.';
    await s.service.observe(s.workspace.id, s.grant, [{ digest: digest(text), text }]);
    const saved = await s.service.execute(s.workspace.id, { command: 'memory_save', grantId: s.grant.id, title: 'Food preference', content: 'No olives', sourceDigests: [digest(text)] }, s.actor);
    expect(saved.facts[0].sources[0].excerpt).toBe(text);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 86400000);
    const restarted = new ConversationMemoryService();
    const found = await restarted.execute(s.workspace.id, { command: 'memory_search', grantId: s.grant.id, query: 'olives', limit: 10 }, s.actor);
    expect(found.facts).toHaveLength(1); expect(found.messages).toHaveLength(1);
    const context = await restarted.context(s.workspace.id, s.grant, 'What food do I dislike?');
    expect(context.facts[0].content).toBe('No olives');
    expect(JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id))).not.toContain(text);
    expect(JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id))).not.toContain('No olives');
  });

  it('rejects foreign sources, agents, tasks and workspaces; preserves revision guards', async () => {
    const a = await setup(), b = await setup();
    await a.service.observe(a.workspace.id, a.grant, [{ digest: digest('A'), text: 'A' }]);
    const input = { command: 'memory_save' as const, grantId: a.grant.id, title: 'Fact', content: 'A', sourceDigests: [digest('A')] };
    await expect(a.service.execute(b.workspace.id, input, a.actor)).rejects.toThrow('not found');
    await expect(a.service.execute(a.workspace.id, input, b.actor)).rejects.toThrow('another agent');
    await expect(a.service.execute(a.workspace.id, { ...input, sourceDigests: [digest('invented')] }, a.actor)).rejects.toThrow('observed messages');
    const saved = (await a.service.execute(a.workspace.id, input, a.actor)).facts[0];
    const updated = (await a.service.execute(a.workspace.id, { ...input, id: saved.id, revision: 1, content: 'Corrected A' }, a.actor)).facts[0];
    expect(updated.revision).toBe(2);
    await expect(a.service.execute(a.workspace.id, { ...input, id: saved.id, revision: 1 }, a.actor)).rejects.toThrow('changed');
    expect((await b.search()).messages).toHaveLength(0);
  });

  it('archives only submitted outgoing actions, never failed, uncertain or human drafts', async () => {
    const s = await setup();
    for (const status of ['running', 'failed', 'succeeded']) {
      const id = uuidv7();
      await AgentComputerAction.create({ id, workspace_id: s.workspace.id, node_id: s.node.id, actor_type: 'agent', actor_id: s.agent.id, command: 'reply', idempotency_key: id, request_digest: digest(id), status, created_at: new Date(), updated_at: new Date() });
      await s.service.prepareReply(s.workspace.id, s.grant, id, `Outgoing ${status}`);
    }
    expect((await s.search()).messages.map(m => m.content)).toEqual(['Outgoing succeeded']);
  });

  it('requires opt-in and does not import initial or already seen history; owner can erase without replay', async () => {
    const s = await setup(false);
    const inbox = new ComputerInboxService();
    const tree = (...names: string[]): ComputerAccessibility => ({ available: true, truncated: false, elements: names.map((name,i) => ({ id: `0.0.${i+3}`, role: 'AXStaticText', name, value: '', enabled: true, protected: false, focused: false, actions: [] })) });
    await inbox.ingest(s.workspace.id, s.grant, tree('Old secret'));
    await inbox.ingest(s.workspace.id, s.grant, tree('Old secret', 'Before opt-in'));
    expect(await AgentConversationMessage.query().count()).toBe(0);
    await expect(s.search()).rejects.toThrow('not authorized');
    s.grant.memoryEnabled = true;
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [s.grant] } });
    await inbox.ingest(s.workspace.id, s.grant, tree('Old secret', 'Before opt-in', 'After opt-in'));
    expect((await s.search()).messages.map(m=>m.content)).toEqual(['After opt-in']);
    await expect(s.service.execute(s.workspace.id, { command: 'memory_forget', grantId: s.grant.id, all: true }, s.actor)).rejects.toThrow('Only the owner');
    const erased = await s.service.execute(s.workspace.id, { command: 'memory_forget', grantId: s.grant.id, all: true }, { actorType: 'user' });
    expect(erased.totalMessages).toBe(0);
    await inbox.ingest(s.workspace.id, s.grant, tree('Old secret', 'Before opt-in', 'After opt-in'));
    expect((await s.search()).messages).toHaveLength(0);
  });

  it('expires journal entries but retains explicitly sourced facts and removes all data on revocation', async () => {
    const s = await setup();
    await s.service.observe(s.workspace.id, s.grant, [{ digest: digest('fact'), text: 'fact' }]);
    await s.service.execute(s.workspace.id, { command: 'memory_save', grantId: s.grant.id, title: 'Fact', content: 'fact', sourceDigests: [digest('fact')] }, s.actor);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now()+366*86400000);
    await s.service.sweep();
    expect((await s.search()).messages).toHaveLength(0); expect((await s.search()).facts).toHaveLength(1);
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [] } });
    expect(await AgentConversationMessage.query().count()).toBe(0); expect(await AgentConversationMemory.query().count()).toBe(0);
  });
});
