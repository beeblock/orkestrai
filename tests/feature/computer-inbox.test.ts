import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { ComputerInboxService } from '$lib/modules/agent-room/application/services/ComputerInboxService.js';
import { computerInboxRepository } from '$lib/modules/agent-room/infrastructure/repositories/ComputerInboxRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AgentComputerAction } from '$lib/modules/agent-room/domain/models/AgentComputerAction.js';
import type { ComputerReplyGrant } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
import type { ComputerAccessibility } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';

function tree(...messages: string[]): ComputerAccessibility {
  return { available: true, truncated: false, elements: messages.map((name, i) => ({ id: `0.0.${i}`, role: 'AXStaticText', name, value: '', protected: false, enabled: true, focused: false, actions: [] })) };
}
async function setup() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'Conversation inbox', workingDir: '/tmp' });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer' });
  const select = (id: string, role: string, name: string) => ({ id, role, name });
  const grant: ComputerReplyGrant = { id: uuidv7(), nodeId: node.id, agentId: uuidv7(), taskId: uuidv7(), enabled: true, applicationId: 'test.chat',
    recipient: select('0.0.0', 'AXButton', 'Approved'), composer: select('0.0.1', 'AXTextArea', 'Composer'), send: select('0.0.2', 'AXButton', 'Send'), incomingMarker: 'Received:', maxCharacters: 2000, maxPerHour: 60, memoryEnabled: false, memoryRetentionDays: 365, allowProactive: false };
  const inbox = new ComputerInboxService();
  await inbox.ingest(workspace.id, grant, tree('Historical message'));
  return { workspace, grant, inbox };
}
describe('Durable native conversation inbox', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.restoreAllMocks());

  it('preserves ten questions, collects arrivals while busy, and resumes after service restart', async () => {
    const { workspace, grant, inbox } = await setup();
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const questions = Array.from({ length: 10 }, (_, i) => `Question ${i + 1}: topic ${i % 3}`);
    for (let i = 1; i <= 10; i++) { now += 200; await inbox.ingest(workspace.id, grant, tree(...questions.slice(0, i))); }
    expect(await inbox.claim(workspace.id, grant, 1000)).toBeNull();
    now += 1000;
    const first = (await inbox.claim(workspace.id, grant, 1000))!;
    expect(first.messages.map(m => m.text)).toEqual(questions);
    expect(first.pendingAfter).toBe(0);
    expect(await inbox.claim(workspace.id, grant, 1000)).toBeNull();
    await inbox.ingest(workspace.id, grant, tree(...questions, 'Question 11 while generating image', 'Question 12'));
    const restarted = new ComputerInboxService();
    expect(await restarted.validateBatch(workspace.id, grant, first.batchId, first.inReplyToDigest)).toHaveLength(10);
    await restarted.acknowledge(workspace.id, grant, first.batchId, first.inReplyToDigest, 'replied');
    now += 1000;
    const second = (await restarted.claim(workspace.id, grant, 1000))!;
    expect(second.messages.map(m => m.text)).toEqual(['Question 11 while generating image', 'Question 12']);
    expect(second.context.map(m => m.text)).toEqual(questions);
    await restarted.acknowledge(workspace.id, grant, second.batchId, second.inReplyToDigest, 'replied');
    await restarted.ingest(workspace.id, grant, tree(...questions, 'Question 11 while generating image', 'Question 12'));
    expect(await restarted.claim(workspace.id, grant, 0)).toBeNull();
  });

  it('does not silently discard duplicate identities, truncated input, overflow or uncertain sends', async () => {
    const { workspace, grant, inbox } = await setup();
    await expect(inbox.ingest(workspace.id, grant, tree('same', 'same'))).rejects.toThrow('ambiguous');
    await expect(inbox.ingest(workspace.id, grant, { ...tree('question'), truncated: true })).rejects.toThrow('Complete');
    await inbox.ingest(workspace.id, grant, tree('Question'));
    const first = (await inbox.claim(workspace.id, grant, 0))!;
    await inbox.acknowledge(workspace.id, grant, first.batchId, first.inReplyToDigest, 'uncertain');
    await inbox.ingest(workspace.id, grant, tree('Question', 'Next question'));
    await expect(inbox.claim(workspace.id, grant, 0)).rejects.toThrow('uncertain');
    expect((await computerInboxRepository.read(workspace.id, grant.id))?.messages).toHaveLength(2);
    await expect(inbox.ingest(workspace.id, grant, tree(...Array.from({ length: 129 }, (_, i) => `Question ${i}`)))).rejects.toThrow('full');
    expect((await computerInboxRepository.read(workspace.id, grant.id))?.messages).toHaveLength(2);
  });

  it('distinguishes recovery of the original request from a new unanswered batch', async () => {
    const { workspace, grant, inbox } = await setup();
    await inbox.ingest(workspace.id, grant, tree('Question'));
    const first = (await inbox.claim(workspace.id, grant, 0))!;
    expect(first).toMatchObject({ deliveryState: 'not_attempted', originalRequestRequired: false });
    await AgentComputerAction.create({ id: uuidv7(), workspace_id: workspace.id, node_id: grant.nodeId, actor_type: 'agent', actor_id: grant.agentId, command: 'reply', idempotency_key: `reply:${grant.id}:${first.inReplyToDigest}`, request_digest: 'a'.repeat(64), status: 'gated', result_json: JSON.stringify({ submission: 'not_attempted', recoveryDraftHash: 'b'.repeat(64) }), created_at: new Date(), updated_at: new Date() });
    await inbox.reopenUnsubmitted(workspace.id, grant, first.inReplyToDigest);
    const recovered = await inbox.claim(workspace.id, grant, 0);
    expect(recovered).toMatchObject({ batchId: first.batchId, inReplyToDigest: first.inReplyToDigest, deliveryState: 'not_attempted', originalRequestRequired: true });
    expect(recovered).not.toHaveProperty('recoveryDraftHash');
  });

  it('bounds batches without truncating messages and rejects cross-conversation acknowledgments', async () => {
    const { workspace, grant, inbox } = await setup();
    const questions = Array.from({ length: 25 }, (_, i) => `Question ${i}`);
    await inbox.ingest(workspace.id, grant, tree(...questions));
    const first = (await inbox.claim(workspace.id, grant, 0))!;
    expect(first.messages).toHaveLength(20); expect(first.pendingAfter).toBe(5);
    await expect(inbox.validateBatch(workspace.id, { ...grant, agentId: uuidv7() }, first.batchId, first.inReplyToDigest)).rejects.toThrow('identity');
    await expect(inbox.validateBatch(workspace.id, grant, uuidv7(), first.inReplyToDigest)).rejects.toThrow('missing');
    await inbox.acknowledge(workspace.id, grant, first.batchId, first.inReplyToDigest, 'replied');
    const second = (await inbox.claim(workspace.id, grant, 0))!;
    expect(second.messages.map(m => m.text)).toEqual(questions.slice(20));
  });

  it('does not redispatch a batch acknowledged between its read and CAS update', async () => {
    const { workspace, grant, inbox } = await setup();
    await inbox.ingest(workspace.id, grant, tree('Question'));
    const batch = (await inbox.claim(workspace.id, grant, 0))!;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121_000);
    const change = computerInboxRepository.change.bind(computerInboxRepository);
    vi.spyOn(computerInboxRepository, 'change').mockImplementationOnce(async (workspaceId, grantId, update) => {
      await change(workspaceId, grantId, state => {
        for (const message of state!.messages) message.status = 'replied';
        return state!;
      });
      return change(workspaceId, grantId, update);
    });
    expect(await inbox.claim(workspace.id, grant, 0)).toBeNull();
    expect((await inbox.validateBatch(workspace.id, grant, batch.batchId, batch.inReplyToDigest))[0].status).toBe('replied');
  });

  it('releases a rejected dispatch immediately without consuming retry attempts', async () => {
    const { workspace, grant, inbox } = await setup();
    await inbox.ingest(workspace.id, grant, tree('Question one', 'Question two'));
    const first = (await inbox.claim(workspace.id, grant, 0))!;
    await expect(inbox.validateUnbatched(workspace.id, grant, first.inReplyToDigest)).rejects.toThrow('batchId');
    await inbox.releaseUndispatched(workspace.id, grant, first.batchId);
    const second = (await inbox.claim(workspace.id, grant, 0))!;
    expect(second.messages).toEqual(first.messages);
    expect((await computerInboxRepository.read(workspace.id, grant.id))!.messages.every(m => m.attempts === 1)).toBe(true);
    await inbox.acknowledge(workspace.id, grant, second.batchId, second.inReplyToDigest, 'replied');
    await inbox.releaseUndispatched(workspace.id, grant, second.batchId);
    expect(await inbox.claim(workspace.id, grant, 0)).toBeNull();
  });

  it('records a deliberate no-reply decision and immediately releases the next batch', async () => {
    const { workspace, grant, inbox } = await setup();
    await inbox.ingest(workspace.id, grant, tree('Already answered question'));
    const first = (await inbox.claim(workspace.id, grant, 0))!;
    await inbox.ingest(workspace.id, grant, tree('Already answered question', 'New unanswered question'));
    expect(await inbox.skipBatch(workspace.id, grant, first.batchId, first.inReplyToDigest, 'already_answered')).toBe(1);
    expect(await inbox.skipBatch(workspace.id, grant, first.batchId, first.inReplyToDigest, 'already_answered')).toBe(1);
    const next = (await new ComputerInboxService().claim(workspace.id, grant, 0))!;
    expect(next.messages.map(m => m.text)).toEqual(['New unanswered question']);
    expect(next.context).toEqual([]);
    const state = await computerInboxRepository.read(workspace.id, grant.id);
    expect(state!.messages[0]).toMatchObject({ status: 'skipped', resolution: 'already_answered' });
    await expect(inbox.reopenUnsubmitted(workspace.id, grant, first.inReplyToDigest)).rejects.toThrow('cannot be reopened');
  });

  it('never clears another batch, unclaimed questions, or uncertain/replied sends with no-reply acknowledgment', async () => {
    const { workspace, grant, inbox } = await setup();
    await inbox.ingest(workspace.id, grant, tree('Question'));
    const first = (await inbox.claim(workspace.id, grant, 0))!;
    await expect(inbox.skipBatch(workspace.id, grant, first.batchId, '0'.repeat(64), 'no_response_needed')).rejects.toThrow('exact dispatched');
    await expect(inbox.skipBatch(workspace.id, grant, uuidv7(), first.inReplyToDigest, 'no_response_needed')).rejects.toThrow('exact dispatched');
    await expect(inbox.skipBatch(workspace.id, { ...grant, agentId: uuidv7() }, first.batchId, first.inReplyToDigest, 'no_response_needed')).rejects.toThrow('identity');
    for (const status of ['uncertain', 'replied'] as const) {
      await inbox.acknowledge(workspace.id, grant, first.batchId, first.inReplyToDigest, status);
      await expect(inbox.skipBatch(workspace.id, grant, first.batchId, first.inReplyToDigest, 'already_answered')).rejects.toThrow('exact dispatched');
    }
  });
});
