import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { ComputerService } from '$lib/modules/agent-room/application/services/ComputerService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AgentComputerAction } from '$lib/modules/agent-room/domain/models/AgentComputerAction.js';
import { incomingConversation, incomingDigest } from '$lib/modules/agent-room/application/adapters/computers/reply-scope.js';
import type { ComputerAdapter } from '$lib/modules/agent-room/application/adapters/computers/types.js';
import type { ComputerAccessibility, ComputerSnapshot } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { companionProfileSchema } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
import { computerInboxService } from '$lib/modules/agent-room/application/services/ComputerInboxService.js';
import { NativeInteractionError } from '$lib/modules/agent-room/application/adapters/computers/native-interaction-error.js';

async function setup(windows = false) {
  const workspace = await workspaceRepository.createWorkspace({ name: 'Scoped replies', workingDir: '/tmp' });
  const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Operator' });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['test.chat'] } } });
  const task = await taskBoardService.create(workspace.id, { title: 'Reply to approved contact', assigneeNodeId: agent.id, dispatch: false });
  const button = windows ? 'ControlType.Button' : 'AXButton', field = windows ? 'ControlType.Edit' : 'AXTextArea';
  const tree: ComputerAccessibility = { available: true, truncated: false, elements: [
    { id: '0.0.0', role: button, name: 'Approved contact', value: '', enabled: true, protected: false, focused: false, actions: ['press'] },
    { id: '0.0.1', role: field, name: 'Composer', value: '', enabled: true, protected: false, focused: true, actions: ['fill'] },
    { id: '0.0.2', role: button, name: 'Send', value: '', enabled: true, protected: false, focused: false, actions: ['press'] },
    { id: '0.0.3', role: 'text', name: 'Received from approved: question', value: '', enabled: true, protected: false, focused: false, actions: [] },
    { id: '0.1.0', role: 'text', name: 'Received from other: unrelated', value: '', enabled: true, protected: false, focused: false, actions: [] },
  ] };
  const snapshot: ComputerSnapshot = { platform: 'linux', available: true, reason: 'ready', detail: null, permissions: { accessibility: 'granted', screenRecording: 'unknown' }, displays: [], windows: [{ id: 'chat', appId: 'test.chat', appName: 'Chat', title: 'Chat', focused: true, bounds: { x: 0, y: 0, width: 500, height: 500 } }], focusedWindowId: 'chat' };
  const interact = vi.fn(async (input) => { tree.elements[1].value = input.action === 'fill' ? input.text : ''; return structuredClone(tree); });
  const adapter = { platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', snapshot: async () => snapshot, read: async () => structuredClone(tree), interact, focus: vi.fn(), click: vi.fn(), type: vi.fn(), shortcut: vi.fn() } as unknown as ComputerAdapter;
  const service = new ComputerService([adapter]);
  const previous = await autonomyPolicyService.get(workspace.id);
  await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...previous.policy, capabilities: ['computer'], allowedApps: ['test.chat'] } });
  const select = (index: number) => { const e = tree.elements[index]; return { id: e.id, role: e.role, name: e.name }; };
  await service.execute(workspace.id, { command: 'authorize_replies', grant: { enabled: true, nodeId: node.id, agentId: agent.id, taskId: task.id, applicationId: 'test.chat', recipient: select(0), composer: select(1), send: select(2), incomingMarker: 'Received from approved:', maxCharacters: 100, maxPerHour: 1, memoryEnabled: false, memoryRetentionDays: 365, allowProactive: false } }, { actorType: 'user' });
  const policy = await autonomyPolicyService.get(workspace.id), grant = policy.policy.computerReplyGrants[0];
  const context = { actorType: 'agent' as const, actorId: agent.id, taskId: task.id };
  const fill = () => ({ command: 'interact' as const, targetId: 'chat', action: 'fill' as const, element: { ...select(1), value: '' }, guards: [select(0)], text: 'private-reply-fixture' });
  const send = () => ({ command: 'interact' as const, targetId: 'chat', action: 'press' as const, element: select(2), guards: [select(0), { ...select(1), value: tree.elements[1].value }] });
  const reply = () => ({ command: 'reply' as const, targetId: 'chat', grantId: grant.id, inReplyToDigest: incomingDigest(tree.elements[3]), text: 'private-reply-fixture' });
  return { workspace, agent, node, task, service, tree, interact, adapter, context, grant, policy, fill, send, reply };
}

describe('Owner-approved conversation replies', () => {
  useSvelarTest({ refreshDatabase: true });

  it('opens the approved conversation before replying after a user selects another chat', async () => {
    const s = await setup();
    const expected = s.tree.elements[0].name;
    s.tree.elements[0].name = 'Another conversation';
    const openConversation = vi.fn(async () => { s.tree.elements[0].name = expected; return structuredClone(s.tree); });
    Object.assign(s.adapter, { backgroundInteraction: true, scopedForegroundInteraction: true, openConversation });
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowForegroundSend: true, allowConversationNavigation: true }] } });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).resolves.toMatchObject({ completed: true });
    expect(openConversation).toHaveBeenCalledExactlyOnceWith('chat', 'test.chat', { recipient: s.grant.recipient, composer: s.grant.composer, send: s.grant.send });
    expect(s.interact).toHaveBeenCalledTimes(2);
    const audit = await autonomyPolicyService.exportAudit(s.workspace.id);
    expect(audit.integrity.valid).toBe(true);
    expect(JSON.stringify(audit)).toContain('computer.open_conversation');
    expect(JSON.stringify(audit)).not.toContain('Another conversation');
    expect(JSON.stringify(audit)).not.toContain('private-reply-fixture');
  });

  it.each(['default-off', 'no-foreground', 'different-agent', 'wrong-window', 'revoked'])('refuses unauthorized navigation: %s', async kind => {
    const s = await setup(), openConversation = vi.fn();
    Object.assign(s.adapter, { backgroundInteraction: true, scopedForegroundInteraction: true, openConversation });
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, enabled: kind !== 'revoked', allowForegroundSend: kind !== 'no-foreground', allowConversationNavigation: kind !== 'default-off' }] } });
    await expect(s.service.execute(s.workspace.id, { command: 'open_conversation', grantId: s.grant.id, targetId: kind === 'wrong-window' ? 'other-window' : 'chat' }, { ...s.context, ...(kind === 'different-agent' ? { actorId: 'another-agent' } : {}) })).rejects.toThrow();
    expect(openConversation).not.toHaveBeenCalled();
    expect(s.interact).not.toHaveBeenCalled();
  });

  it.each(['wrong-header', 'revoked-during-navigation'])('does not compose after navigation yields %s', async kind => {
    const s = await setup();
    const expected = s.tree.elements[0].name; s.tree.elements[0].name = 'Another conversation';
    const grant = { ...s.grant, allowForegroundSend: true, allowConversationNavigation: true };
    Object.assign(s.adapter, { backgroundInteraction: true, scopedForegroundInteraction: true, openConversation: vi.fn(async () => {
      if (kind === 'revoked-during-navigation') {
        s.tree.elements[0].name = expected;
        await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...grant, enabled: false }] } });
      }
      return structuredClone(s.tree);
    }) });
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [grant] } });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow();
    expect(s.interact).not.toHaveBeenCalled();
  });

  it('uses background semantic controls only for a validated conversation transaction', async () => {
    const s = await setup();
    Object.assign(s.adapter, { backgroundInteraction: true });
    const snapshot = await s.adapter.snapshot(); snapshot.windows[0].focused = false;
    snapshot.focusedWindowId = 'another-application';
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).resolves.toMatchObject({ completed: true });
    expect(s.interact).toHaveBeenCalledTimes(2);
    for (const call of s.interact.mock.calls) expect(call[2]).toEqual({ background: true });
    expect(s.adapter.focus).not.toHaveBeenCalled();
    expect(s.adapter.type).not.toHaveBeenCalled();
    expect(s.adapter.shortcut).not.toHaveBeenCalled();
    expect(snapshot.focusedWindowId).toBe('another-application');
  });

  it('does not assume all native adapters can send in background', async () => {
    const s = await setup(); (await s.adapter.snapshot()).windows[0].focused = false;
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow('no native input was attempted');
    expect(s.interact).not.toHaveBeenCalled();
    expect(await AgentComputerAction.query().where('workspace_id', s.workspace.id).where('command', 'reply').count()).toBe(0);
  });

  it('uses driver-owned temporary focus per action only with explicit owner consent', async () => {
    const s = await setup();
    Object.assign(s.adapter, { backgroundInteraction: true, scopedForegroundInteraction: true });
    const snapshot = await s.adapter.snapshot();
    snapshot.windows[0].focused = false;
    snapshot.focusedWindowId = 'another-application';
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowForegroundSend: true }] } });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).resolves.toMatchObject({ completed: true, delivery: 'unconfirmed' });
    for (const call of s.interact.mock.calls) expect(call[2]).toEqual({ background: false });
    expect(s.adapter.focus).not.toHaveBeenCalled();
    const audit = JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id));
    expect(audit).not.toContain('computer.foreground_acquired');
    expect(audit).not.toContain('computer.foreground_restored');
    await s.service.execute(s.workspace.id, s.reply(), s.context);
    expect(s.interact).toHaveBeenCalledTimes(2);
  });

  it('does not let driver-owned focus bypass the default background-only grant', async () => {
    const s = await setup();
    Object.assign(s.adapter, { backgroundInteraction: true, scopedForegroundInteraction: true });
    (await s.adapter.snapshot()).windows[0].focused = false;
    await s.service.execute(s.workspace.id, s.reply(), s.context);
    for (const call of s.interact.mock.calls) expect(call[2]).toEqual({ background: true });
    expect(s.adapter.focus).not.toHaveBeenCalled();
  });

  it('borrows foreground only with owner authorization and restores it after submission', async () => {
    const s = await setup();
    const snapshot = await s.adapter.snapshot(); snapshot.windows[0].focused = false;
    const restore = vi.fn(async () => { snapshot.windows[0].focused = false; return 'restored' as const; });
    const acquire = vi.fn(async () => { snapshot.windows[0].focused = true; return { restore }; });
    Object.assign(s.adapter, { backgroundInteraction: true, acquireForeground: acquire });
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowForegroundSend: true }] } });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).resolves.toMatchObject({ completed: true });
    expect(acquire).toHaveBeenCalledWith('chat', 'test.chat');
    expect(restore).toHaveBeenCalledOnce();
    expect(snapshot.windows[0].focused).toBe(false);
    for (const call of s.interact.mock.calls) expect(call[2]).toEqual({ background: false });
    const audit = JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id));
    expect(audit).toContain('computer.foreground_acquired');
    expect(audit).toContain('computer.foreground_restored');
    expect(audit).not.toContain('private-reply-fixture');
    await s.service.execute(s.workspace.id, s.reply(), s.context);
    expect(acquire).toHaveBeenCalledOnce();
    expect(s.interact).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'skipped', 'throws'])('does not replay a submitted reply when restoring focus %s', async (state) => {
    const s = await setup();
    const restore = vi.fn(async () => { if (state === 'throws') throw new Error('Previous app closed'); return state; });
    Object.assign(s.adapter, { acquireForeground: vi.fn(async () => ({ restore })) });
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowForegroundSend: true }] } });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).resolves.toMatchObject({ completed: true });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).resolves.toMatchObject({ completed: true });
    expect(s.interact).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledOnce();
  });

  it('restores focus after a native failure but never activates over an existing draft', async () => {
    const s = await setup();
    const restore = vi.fn(async () => 'restored' as const);
    const acquire = vi.fn(async () => ({ restore }));
    Object.assign(s.adapter, { acquireForeground: acquire });
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowForegroundSend: true }] } });
    s.tree.elements[1].value = 'user draft';
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow('drafts are preserved');
    expect(acquire).not.toHaveBeenCalled();
    s.tree.elements[1].value = '';
    s.interact.mockRejectedValueOnce(new NativeInteractionError('focus_changed', false));
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow('no native input was attempted');
    expect(restore).toHaveBeenCalledOnce();
  });

  it('refuses temporary focus if the native adapter does not support restoration', async () => {
    const s = await setup();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowForegroundSend: true }] } });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow('Temporary foreground access is unavailable');
    expect(s.adapter.focus).not.toHaveBeenCalled();
    expect(s.interact).not.toHaveBeenCalled();
  });

  it('does not take focus when Computer access is revoked during preparation', async () => {
    const s = await setup();
    const acquire = vi.fn();
    Object.assign(s.adapter, { acquireForeground: acquire });
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowForegroundSend: true }] } });
    vi.spyOn(s.adapter, 'read').mockImplementationOnce(async () => {
      await workspaceRepository.updateNode(s.node.id, { payload: { computerConfig: { enabled: false, allowedApplications: ['test.chat'] } } });
      return structuredClone(s.tree);
    });
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow('access was revoked');
    expect(acquire).not.toHaveBeenCalled();
    expect(s.interact).not.toHaveBeenCalled();
  });

  it('keeps a failed preflight batch retryable without marking an unattempted send uncertain', async () => {
    const s = await setup();
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [] });
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [s.tree.elements[3]] });
    const batch = (await computerInboxService.claim(s.workspace.id, s.grant, 0))!;
    expect(batch.deliveryState).toBe('not_attempted');
    const input = { ...s.reply(), batchId: batch.batchId };
    const read = vi.spyOn(s.adapter, 'read').mockRejectedValueOnce(new Error('Native read temporarily unavailable'));
    await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow('no native input was attempted');
    expect(s.interact).not.toHaveBeenCalled();
    await expect(computerInboxService.validateBatch(s.workspace.id, s.grant, batch.batchId, batch.inReplyToDigest)).resolves.toHaveLength(1);
    read.mockRestore();
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ completed: true });
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ completed: true });
    expect(s.interact).toHaveBeenCalledTimes(2);
    expect(await computerInboxService.claim(s.workspace.id, s.grant, 0)).toBeNull();
  });

  it.each([false, true])('replies to a durable batch after its native history leaves the viewport (windows=%s)', async windows => {
    const s = await setup(windows);
    const original = s.tree.elements[3];
    const incoming = Array.from({ length: 10 }, (_, i) => ({ ...original, id: `0.0.${i + 3}`, name: `Received from approved: question ${i + 1}` }));
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [] });
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: incoming });
    const batch = (await computerInboxService.claim(s.workspace.id, s.grant, 0))!;
    const input = { ...s.reply(), batchId: batch.batchId, inReplyToDigest: batch.inReplyToDigest };
    const next = { ...original, name: 'Received from approved: a later question' };
    s.tree.elements[3] = next;
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [next] });
    const restarted = new ComputerService([s.adapter]);
    await expect(restarted.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ kind: 'reply', completed: true });
    expect(s.interact).toHaveBeenCalledTimes(2);
    expect((await computerInboxService.validateBatch(s.workspace.id, s.grant, batch.batchId, batch.inReplyToDigest)).every(m => m.status === 'replied')).toBe(true);
    await expect(restarted.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ completed: true });
    expect(s.interact).toHaveBeenCalledTimes(2);
    const pending = (await computerInboxService.claim(s.workspace.id, s.grant, 0))!;
    expect(pending.messages).toHaveLength(1);
    expect(pending.messages[0].digest).toBe(incomingDigest(next));
    const audit = await autonomyPolicyService.exportAudit(s.workspace.id);
    expect(audit.integrity.valid).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/private-reply-fixture|question [0-9]/);
  });

  it.each(['unbatched', 'unknown-batch', 'wrong-digest', 'other-agent', 'uncertain', 'skipped', 'wrong-contact', 'truncated', 'draft'])('rejects invalid durable reply evidence: %s', async reason => {
    const s = await setup();
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [] });
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [s.tree.elements[3]] });
    const batch = (await computerInboxService.claim(s.workspace.id, s.grant, 0))!;
    const input = { ...s.reply(), batchId: reason === 'unbatched' ? undefined : reason === 'unknown-batch' ? s.task.id : batch.batchId,
      inReplyToDigest: reason === 'wrong-digest' ? '0'.repeat(64) : batch.inReplyToDigest };
    s.tree.elements.splice(3, 1);
    if (reason === 'uncertain') await computerInboxService.acknowledge(s.workspace.id, s.grant, batch.batchId, batch.inReplyToDigest, 'uncertain');
    if (reason === 'skipped') await computerInboxService.skipBatch(s.workspace.id, s.grant, batch.batchId, batch.inReplyToDigest, 'no_response_needed');
    if (reason === 'wrong-contact') s.tree.elements[0].name = 'Another contact';
    if (reason === 'truncated') s.tree.truncated = true;
    if (reason === 'draft') s.tree.elements[1].value = 'Human draft';
    await expect(s.service.execute(s.workspace.id, input, { ...s.context, ...(reason === 'other-agent' ? { actorId: s.node.id } : {}) })).rejects.toThrow();
    expect(s.interact).not.toHaveBeenCalled();
  });

  it('audits a no-reply decision without native input and rejects another agent or task', async () => {
    const s = await setup();
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [] });
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [s.tree.elements[3]] });
    const batch = (await computerInboxService.claim(s.workspace.id, s.grant, 0))!;
    const input = { command: 'inbox_acknowledge' as const, grantId: s.grant.id, batchId: batch.batchId, inReplyToDigest: batch.inReplyToDigest, reason: 'no_response_needed' as const };
    for (const context of [{ ...s.context, actorId: s.node.id }, { ...s.context, taskId: s.node.id }, { actorType: 'user' as const }]) await expect(s.service.execute(s.workspace.id, input, context)).rejects.toThrow('authorization');
    expect(await s.service.execute(s.workspace.id, input, s.context)).toMatchObject({ kind: 'inbox_acknowledgment', count: 1, sent: false, resolution: 'no_response_needed' });
    expect(s.interact).not.toHaveBeenCalled();
    expect(await computerInboxService.claim(s.workspace.id, s.grant, 0)).toBeNull();
    const audit = await autonomyPolicyService.exportAudit(s.workspace.id);
    expect(audit.integrity.valid).toBe(true);
    expect(JSON.stringify(audit)).toContain('computer.inbox_acknowledged');
    expect(JSON.stringify(audit)).not.toContain('Received from approved: question');
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, halted: true } });
    await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow('authorization');
  });

  it('retries the identical native pre-input rejection without poisoning the batch or replaying Send', async () => {
    const s = await setup();
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [] });
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [s.tree.elements[3]] });
    const batch = (await computerInboxService.claim(s.workspace.id, s.grant, 0))!;
    const input = { ...s.reply(), batchId: batch.batchId };
    s.interact.mockRejectedValueOnce(new NativeInteractionError('Native input rejected before mutation', false));
    await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow('no native input was attempted');
    await expect(computerInboxService.validateBatch(s.workspace.id, s.grant, batch.batchId, batch.inReplyToDigest)).resolves.toHaveLength(1);
    const action = await AgentComputerAction.query().where('workspace_id', s.workspace.id).where('command', 'interact').first();
    expect(action?.getAttribute('status')).toBe('gated');
    expect(JSON.parse(String(action?.getAttribute('result_json')))).toEqual({ nativeInput: 'not_attempted' });
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ completed: true });
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ completed: true });
    expect(s.interact).toHaveBeenCalledTimes(3);
    expect(await computerInboxService.claim(s.workspace.id, s.grant, 0)).toBeNull();
  });

  it('does not reclassify a failed Send or an untyped error as safe to replay', async () => {
    const s = await setup();
    s.interact.mockImplementationOnce(async input => { s.tree.elements[1].value = input.text; return structuredClone(s.tree); });
    s.interact.mockRejectedValueOnce(new NativeInteractionError('Send preflight failed', false));
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow('Send preflight failed');
    await expect(s.service.execute(s.workspace.id, s.reply(), s.context)).rejects.toThrow('uncertain reply');
    expect(s.interact).toHaveBeenCalledTimes(2);
  });

  it('blocks sensitive public output before native effects and keeps rejected content out of audit', async () => {
    const s = await setup();
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwx';
    await expect(s.service.execute(s.workspace.id, { ...s.reply(), text: secret }, s.context)).rejects.toThrow('credential_material');
    expect(s.interact).not.toHaveBeenCalled();
    const audit = await autonomyPolicyService.exportAudit(s.workspace.id);
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(JSON.stringify(audit)).toContain('companion.publication_blocked');
    expect(await AgentComputerAction.query().where('workspace_id', s.workspace.id).get()).toHaveLength(0);
  });

  it('applies owner punctuation before digesting and rejects operational narration', async () => {
    const s = await setup();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, companion: companionProfileSchema.parse({ name: 'Nico', persona: 'Friendly AI companion.' }) }] } });
    await expect(s.service.execute(s.workspace.id, { ...s.reply(), text: 'computer_reply grantId failed' }, s.context)).rejects.toThrow('operational_details');
    await s.service.execute(s.workspace.id, { ...s.reply(), text: 'Bom dia — café pronto!' }, s.context);
    expect(s.interact.mock.calls[0][0].text).toBe('Bom dia, café pronto!');
    await s.service.execute(s.workspace.id, { ...s.reply(), text: 'Bom dia — café pronto!' }, s.context);
    expect(s.interact).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('lets only the owner reopen a verified pre-Send failure (empty draft=%s)', async (empty) => {
    const s = await setup();
    Object.assign(s.adapter, { backgroundInteraction: true });
    (await s.adapter.snapshot()).windows[0].focused = false;
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [] });
    await computerInboxService.ingest(s.workspace.id, s.grant, { ...s.tree, elements: [s.tree.elements[3]] });
    const batch = await computerInboxService.claim(s.workspace.id, s.grant, 0);
    if (!batch) throw new Error('Expected conversation batch');
    const input = { ...s.reply(), batchId: batch.batchId };
    s.interact.mockImplementation(async () => { s.tree.elements[1].value = empty ? '' : input.text.slice(0,8); throw new Error('Native accessibility check failed (element_changed).'); });
    await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow('element_changed');
    const inspect = { command: 'reply_recovery' as const, grantId: s.grant.id, targetId: 'chat' };
    await expect(s.service.execute(s.workspace.id, inspect, s.context)).rejects.toThrow('Only the owner');
    const review = await s.service.execute(s.workspace.id, inspect, { actorType: 'user' });
    expect(review).toMatchObject({ kind: 'reply_recovery', state: 'available', draftCharacters: empty ? 0 : 8 });
    if (review.kind !== 'reply_recovery' || !review.actionId) throw new Error('Expected recoverable draft');
    const recover = { ...inspect, actionId: review.actionId, expectedDraftHash: review.draftHash };
    s.tree.elements[1].value += 'human edit';
    await expect(s.service.execute(s.workspace.id, recover, { actorType: 'user' })).rejects.toThrow('draft changed');
    s.tree.elements[1].value = empty ? '' : input.text.slice(0,8);
    await expect(s.service.execute(s.workspace.id, recover, { actorType: 'user' })).resolves.toMatchObject({ state: 'repaired' });
    expect(await computerInboxService.claim(s.workspace.id, s.grant, 0)).toMatchObject({ batchId: batch.batchId, inReplyToDigest: input.inReplyToDigest, deliveryState: 'not_attempted', dispatchAttempt: 1 });
    await expect(s.service.execute(s.workspace.id, { ...input, text: 'Different response' }, s.context)).rejects.toThrow('different reply');
    s.interact.mockImplementation(async command => { s.tree.elements[1].value = command.action === 'fill' ? command.text : ''; return structuredClone(s.tree); });
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ kind: 'reply', completed: true });
    expect(s.interact.mock.calls.filter(([c]) => c.action === 'press')).toHaveLength(1);
    await s.service.execute(s.workspace.id, input, s.context);
    expect(s.interact.mock.calls.filter(([c]) => c.action === 'press')).toHaveLength(1);
  });

  it.each([false, true])('recovers an interrupted proactive draft without changing its source or text (empty=%s)', async empty => {
    const s = await setup();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowProactive: true }] } });
    const input = { command: 'send' as const, grantId: s.grant.id, targetId: 'chat', source: { kind: 'task' as const, id: s.task.id }, text: 'Scheduled reminder' };
    s.interact.mockImplementation(async () => { s.tree.elements[1].value = empty ? '' : input.text; throw new Error('Draft control shifted'); });
    await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow('Draft control shifted');
    const inspect = { command: 'reply_recovery' as const, grantId: s.grant.id, targetId: 'chat' };
    await expect(s.service.execute(s.workspace.id, inspect, s.context)).rejects.toThrow('Only the owner');
    const review = await s.service.execute(s.workspace.id, inspect, { actorType: 'user' });
    if (review.kind !== 'reply_recovery' || !review.actionId) throw new Error('Expected recoverable proactive draft');
    expect(review.state).toBe('available');
    await expect(s.service.execute(s.workspace.id, { ...inspect, actionId: review.actionId, expectedDraftHash: review.draftHash }, { actorType: 'user' })).resolves.toMatchObject({ state: 'repaired' });
    await expect(s.service.execute(s.workspace.id, { ...input, text: 'Different message' }, s.context)).rejects.toThrow('different reply');
    s.interact.mockImplementation(async command => { s.tree.elements[1].value = command.action === 'fill' ? command.text : ''; return structuredClone(s.tree); });
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ completed: true });
    await s.service.execute(s.workspace.id, input, s.context);
    expect(s.interact.mock.calls.filter(([c]) => c.action === 'press')).toHaveLength(1);
  });

  it.each(['reply', 'send'] as const)('never authorizes draft recovery after Send has been attempted (%s)', async command => {
    const s = await setup(), input = s.reply();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowProactive: true }] } });
    s.interact.mockImplementation(async command => { if (command.action === 'fill') s.tree.elements[1].value = command.text; return structuredClone(s.tree); });
    const request = command === 'reply' ? input : { command, grantId: s.grant.id, targetId: 'chat', source: { kind: 'task' as const, id: s.task.id }, text: input.text };
    await expect(s.service.execute(s.workspace.id, request, s.context)).rejects.toThrow('did not clear');
    expect(await s.service.execute(s.workspace.id, { command: 'reply_recovery', grantId: s.grant.id, targetId: 'chat' }, { actorType: 'user' })).toMatchObject({ state: 'uncertain' });
  });

  it('requires a new owner inspection to recover a second pre-Send interruption', async () => {
    const s = await setup(), input = s.reply();
    s.interact.mockImplementation(async () => { s.tree.elements[1].value = input.text.slice(0,8); throw new Error('Native accessibility check failed (focus_changed).'); });
    await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow('focus_changed');
    const inspect = { command: 'reply_recovery' as const, grantId: s.grant.id, targetId: 'chat' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const review = await s.service.execute(s.workspace.id, inspect, { actorType: 'user' });
      if (review.kind !== 'reply_recovery' || !review.actionId) throw new Error('Expected recoverable draft');
      expect(review.state).toBe('available');
      await s.service.execute(s.workspace.id, { ...inspect, actionId: review.actionId, expectedDraftHash: review.draftHash }, { actorType: 'user' });
      if (attempt === 0) await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow('focus_changed');
    }
    s.interact.mockImplementation(async command => { s.tree.elements[1].value = command.action === 'fill' ? command.text : ''; return structuredClone(s.tree); });
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ completed: true });
    expect(s.interact.mock.calls.filter(([c]) => c.action === 'press')).toHaveLength(1);
  });

  it('recognizes native WhatsApp reply metadata without treating outgoing quotes as incoming', async () => {
    const s = await setup();
    const grant = { ...s.grant, applicationId: 'net.whatsapp.WhatsApp', incomingMarker: '\u200emessage,' };
    const quoted = '\u200eReplying to \u200eYou.\n\u200emessage, Three questions about the list, 14:34, \u200eReceived from Approved contact.\n\u200eQuoted message.\nEarlier text';
    const names = [quoted, '\u200eYour message, own reply\n' + quoted, '\u200eReplying to someone.\n\u200eYour message, own reply\n\u200emessage, quoted incoming', '\u200emessage, next question, 14:35, \u200eReceived from Approved contact'];
    s.tree.elements.splice(3, 1, ...names.map((name, i) => ({ ...s.tree.elements[3], id: `0.0.${i + 3}`, name })));
    expect(incomingConversation(s.tree, grant).elements.map(e => e.name)).toEqual([names[0], names[3]]);
    expect(incomingConversation(s.tree, { ...grant, applicationId: 'another.chat' }).elements.map(e => e.name)).toEqual([names[3]]);
  });

  it.each([false, true])('sends only the owned draft without a per-message gate (Windows roles=%s)', async (windows) => {
    const s = await setup(windows);
    const send = s.reply();
    await s.service.execute(s.workspace.id, send, { ...s.context, idempotencyKey: 'send-1', risk: 'external_publication' });
    await s.service.execute(s.workspace.id, send, { ...s.context, idempotencyKey: 'send-1', risk: 'external_publication' });
    expect(s.interact).toHaveBeenCalledTimes(2);
    expect(await autonomyPolicyService.listGates(s.workspace.id)).toHaveLength(0);
    expect(s.tree.elements[1].value).toBe('');
    const records = await AgentComputerAction.query().where('workspace_id', s.workspace.id).get();
    expect(JSON.stringify(records)).not.toContain('private-reply-fixture');
    const audit = await autonomyPolicyService.exportAudit(s.workspace.id);
    expect(JSON.stringify(audit)).not.toContain('private-reply-fixture');
    expect(audit.integrity.valid).toBe(true);
    s.tree.elements[3].name += ' next';
    await expect(s.service.execute(s.workspace.id, s.reply(), { ...s.context, idempotencyKey: 'compose-2' })).rejects.toThrow('rate limit');
  });

  it('refuses a changed recipient and coordinate/keyboard escape, even with risk omitted', async () => {
    const s = await setup();
    const fill = s.reply(); s.tree.elements[0].name = 'Other contact';
    await expect(s.service.execute(s.workspace.id, fill, { ...s.context, idempotencyKey: 'wrong' })).rejects.toThrow('conversation changed');
    await expect(s.service.execute(s.workspace.id, { command: 'type', targetId: 'chat', text: 'bad' }, { ...s.context, idempotencyKey: 'raw' })).rejects.toThrow('raw keyboard');
    await expect(s.service.execute(s.workspace.id, { command: 'shortcut', targetId: 'chat', keys: ['enter'] }, { ...s.context, idempotencyKey: 'enter' })).rejects.toThrow('raw keyboard');
    expect(s.interact).not.toHaveBeenCalled();
  });

  it('preserves human drafts and rejects messages not composed under this authorization', async () => {
    const s = await setup(); s.tree.elements[1].value = 'human text';
    await expect(s.service.execute(s.workspace.id, s.reply(), { ...s.context, idempotencyKey: 'fill' })).rejects.toThrow('drafts are preserved');
    await expect(s.service.execute(s.workspace.id, s.send(), { ...s.context, idempotencyKey: 'send' })).rejects.toThrow('cannot bypass');
    await expect(s.service.execute(s.workspace.id, s.fill(), { ...s.context, idempotencyKey: 'raw-fill' })).rejects.toThrow('cannot bypass');
    expect(s.interact).not.toHaveBeenCalled();
  });

  it('keeps reviewer gates and respects revocation before native input', async () => {
    const s = await setup();
    const request = s.reply();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, gates: { ...s.policy.policy.gates, external_publication: 'reviewer' } } });
    await expect(s.service.execute(s.workspace.id, request, { ...s.context, idempotencyKey: 'send' })).rejects.toThrow('approval gate');
    expect(s.interact).not.toHaveBeenCalled();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [] } });
    await expect(s.service.execute(s.workspace.id, request, { ...s.context, idempotencyKey: 'after-revoke', risk: 'external_publication' })).rejects.toThrow('owner-approved');
  });

  it('rejects wrong task and foreign workspace authorization', async () => {
    const s = await setup();
    await expect(s.service.execute(s.workspace.id, s.fill(), { ...s.context, taskId: s.node.id, idempotencyKey: 'wrong-task' })).rejects.toThrow('another task');
    await expect(autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, agentId: s.node.id }] } })).rejects.toThrow('new conversation authorization');
    await expect(s.service.execute(s.workspace.id, { command: 'authorize_replies', grant: s.grant }, s.context)).rejects.toThrow();
  });

  it('filters observation to incoming conversation text, excluding other contacts and sent receipts', async () => {
    const s = await setup();
    s.tree.elements.push({ ...s.tree.elements[3], id: '0.0.4', name: 'Your message: Delivered' });
    const incoming = incomingConversation(s.tree, s.grant);
    expect(incoming.elements.map(e => e.name)).toEqual(['Received from approved: question']);
    s.tree.elements.push({ ...s.tree.elements[3], id: '0.0.5', name: 'Your message: Received from approved: copied text' });
    expect(incomingConversation(s.tree, s.grant).elements).toHaveLength(1);
    s.tree.truncated = true;
    expect(() => incomingConversation(s.tree, s.grant)).toThrow('complete native');
  });

  it.each([false, true])('submits in one command and deduplicates across retry keys (Windows=%s)', async windows => {
    const s = await setup(windows);
    const read = await s.service.execute(s.workspace.id, { command: 'read', targetId: 'chat' }, s.context);
    expect(read.kind).toBe('accessibility');
    if (read.kind !== 'accessibility') throw new Error('Expected native read');
    expect(read.replyTargets?.[0]).toMatchObject({ grantId: s.grant.id, digest: incomingDigest(s.tree.elements[3]) });
    const input = { command: 'reply' as const, targetId: 'chat', grantId: s.grant.id, inReplyToDigest: read.replyTargets![0].digest, text: 'private-reply-fixture' };
    const result = await s.service.execute(s.workspace.id, input, { ...s.context, idempotencyKey: 'one-call' });
    expect(result).toMatchObject({ kind: 'reply', completed: true, delivery: 'unconfirmed' });
    await s.service.execute(s.workspace.id, input, { ...s.context, idempotencyKey: 'new-key-must-not-resend' });
    expect(s.interact).toHaveBeenCalledTimes(2);
    expect(s.interact.mock.calls[0][0]).toMatchObject({ action: 'fill', guards: [s.grant.recipient] });
    expect(await autonomyPolicyService.listGates(s.workspace.id)).toHaveLength(0);
    expect(JSON.stringify(await AgentComputerAction.query().where('workspace_id', s.workspace.id).get())).not.toContain(input.text);
    expect((await autonomyPolicyService.exportAudit(s.workspace.id)).integrity.valid).toBe(true);
  });

  it('does not type into a group when the approved contact is still visible in the sidebar', async () => {
    const s = await setup();
    s.tree.elements.push({ ...s.tree.elements[0], id: '0.1.1', name: 'Approved contact' });
    s.tree.elements[0].name = 'Beeblock community';
    await expect(s.service.execute(s.workspace.id, { command: 'reply', targetId: 'chat', grantId: s.grant.id, inReplyToDigest: incomingDigest(s.tree.elements[3]), text: 'must not type' }, { ...s.context, idempotencyKey: 'wrong-group' })).rejects.toThrow('conversation changed');
    expect(s.interact).not.toHaveBeenCalled();
    expect(s.tree.elements[1].value).toBe('');
  });

  it.each([
    [false, 'reindexed'], [true, 'reindexed'],
    [false, 'offscreen'], [true, 'offscreen'],
    [false, 'new-arrival'], [true, 'new-arrival'],
  ] as const)('finishes the validated reply when history becomes %s/%s during composition', async (windows, change) => {
    const s = await setup(windows);
    const input = { command: 'reply' as const, targetId: 'chat', grantId: s.grant.id, inReplyToDigest: incomingDigest(s.tree.elements[3]), text: 'First paragraph.\n\nSecond paragraph.' };
    s.interact.mockImplementation(async command => {
      if (command.action === 'fill') {
        s.tree.elements[1].value = command.text;
        if (change === 'reindexed') s.tree.elements[3].id = '0.0.9';
        if (change === 'offscreen') s.tree.elements.splice(3, 1);
        if (change === 'new-arrival') s.tree.elements.push({ ...s.tree.elements[3], id: '0.0.9', name: 'Received from approved: another question' });
        // A multiline editor changes layout during native input, not just between calls.
        for (const guard of command.guards) {
          const current = s.tree.elements.find(e => e.id === guard.id);
          if (!current || current.role !== guard.role || current.name !== guard.name) throw new Error('element_changed');
        }
        s.tree.elements[1].id = '0.0.7';
        s.tree.elements[2].id = '0.0.8';
      } else {
        expect(command.element.id).toBe('0.0.8');
        expect(command.guards).toContainEqual(expect.objectContaining({ id: '0.0.7', value: input.text }));
        s.tree.elements[1].value = '';
      }
      return structuredClone(s.tree);
    });
    await expect(s.service.execute(s.workspace.id, input, s.context)).resolves.toMatchObject({ kind: 'reply', completed: true });
    await s.service.execute(s.workspace.id, input, s.context);
    expect(s.interact).toHaveBeenCalledTimes(2);
    expect(s.tree.elements[1].value).toBe('');
  });

  it.each(['partial-draft', 'send-no-op'])('never claims success or replays a %s', async failure => {
    const s = await setup();
    const input = { command: 'reply' as const, targetId: 'chat', grantId: s.grant.id, inReplyToDigest: incomingDigest(s.tree.elements[3]), text: 'The complete reply' };
    s.interact.mockImplementation(async command => {
      if (command.action === 'fill') s.tree.elements[1].value = failure === 'partial-draft' ? 'The complete' : input.text;
      return structuredClone(s.tree);
    });
    await expect(s.service.execute(s.workspace.id, input, s.context)).rejects.toThrow(failure === 'partial-draft' ? 'draft did not match' : 'did not clear');
    const calls = s.interact.mock.calls.length;
    expect(s.interact.mock.calls.filter(([command]) => command.action === 'press')).toHaveLength(failure === 'partial-draft' ? 0 : 1);
    await expect(s.service.execute(s.workspace.id, input, { ...s.context, idempotencyKey: 'do-not-replay' })).rejects.toThrow('uncertain reply');
    expect(s.interact).toHaveBeenCalledTimes(calls);
    expect(s.tree.elements[1].value).not.toBe('');
  });

  it.each(['draft', 'stale', 'ambiguous', 'changed-between-steps', 'revoked-between-steps'])('fails closed for %s, without sending or replaying', async reason => {
    const s = await setup();
    const input = { command: 'reply' as const, targetId: 'chat', grantId: s.grant.id, inReplyToDigest: incomingDigest(s.tree.elements[3]), text: 'private-reply-fixture' };
    if (reason === 'draft') s.tree.elements[1].value = 'human draft';
    if (reason === 'stale') s.tree.elements.push({ ...s.tree.elements[3], id: '0.0.4', name: 'Received from approved: newer message' });
    if (reason === 'ambiguous') s.tree.elements.push({ ...s.tree.elements[3], id: '0.0.4' });
    if (reason === 'changed-between-steps' || reason === 'revoked-between-steps') s.interact.mockImplementationOnce(async input => {
      s.tree.elements[1].value = input.text;
      if (reason === 'changed-between-steps') s.tree.elements[0].name = 'Other person';
      else await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [] } });
      return structuredClone(s.tree);
    });
    await expect(s.service.execute(s.workspace.id, input, { ...s.context, idempotencyKey: reason })).rejects.toThrow();
    expect(s.interact.mock.calls.filter(([input]) => input.action === 'press')).toHaveLength(0);
    await expect(s.service.execute(s.workspace.id, input, { ...s.context, idempotencyKey: 'different-retry-key' })).rejects.toThrow();
    if (reason === 'draft') expect(s.tree.elements[1].value).toBe('human draft');
  });

  it('asks for a stronger reviewer gate before writing a draft', async () => {
    const s = await setup();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, gates: { ...s.policy.policy.gates, external_publication: 'reviewer' } } });
    await expect(s.service.execute(s.workspace.id, { command: 'reply', targetId: 'chat', grantId: s.grant.id, inReplyToDigest: incomingDigest(s.tree.elements[3]), text: 'review me' }, { ...s.context, idempotencyKey: 'reviewer-required' })).rejects.toThrow('approval gate');
    expect(s.interact).not.toHaveBeenCalled();
  });

  it('allows emergency halt and revocation after the task is reassigned', async () => {
    const s = await setup();
    await taskBoardService.update(s.workspace.id, s.task.id, { assigneeNodeId: null });
    await expect(autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, halted: true } })).resolves.toMatchObject({ policy: { halted: true } });
    await expect(autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, enabled: false }] } })).resolves.toMatchObject({ policy: { computerReplyGrants: [expect.objectContaining({ enabled: false })] } });
  });

  it('does not downgrade a previously gated reply risk on retry', async () => {
    const s = await setup();
    const input = { command: 'reply' as const, targetId: 'chat', grantId: s.grant.id, inReplyToDigest: incomingDigest(s.tree.elements[3]), text: 'review this purchase' };
    await expect(s.service.execute(s.workspace.id, input, { ...s.context, idempotencyKey: 'purchase-1', risk: 'purchase' })).rejects.toThrow('approval gate');
    await expect(s.service.execute(s.workspace.id, input, { ...s.context, idempotencyKey: 'changed-risk' })).rejects.toThrow('different reply attempt');
    expect(s.interact).not.toHaveBeenCalled();
  });

  it.each([false, true])('sends later task results only with proactive authorization and deduplicates after restart (Windows=%s)', async windows => {
    const s = await setup(windows);
    const request = { command: 'send' as const, grantId: s.grant.id, targetId: 'chat', source: { kind: 'task' as const, id: s.task.id }, text: 'Scheduled reminder' };
    await expect(s.service.execute(s.workspace.id, request, s.context)).rejects.toThrow('Proactive delivery');
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowProactive: true }] } });
    s.tree.elements.splice(3); // No new message is needed for a scheduled result.
    await expect(s.service.execute(s.workspace.id, request, s.context)).resolves.toMatchObject({ kind: 'publication', completed: true, delivery: 'unconfirmed' });
    const restarted = new ComputerService([s.adapter]);
    await restarted.execute(s.workspace.id, request, { ...s.context, idempotencyKey: 'new-key' });
    expect(s.interact).toHaveBeenCalledTimes(2);
    await expect(restarted.execute(s.workspace.id, { ...request, text: 'Different result' }, s.context)).rejects.toThrow('different reply attempt');
  });

  it('does not send if proactive authorization changes after composing', async () => {
    const s = await setup();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, allowProactive: true }] } });
    s.interact.mockImplementationOnce(async input => {
      s.tree.elements[1].value = input.text;
      await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: s.policy.policy });
      return structuredClone(s.tree);
    });
    await expect(s.service.execute(s.workspace.id, { command: 'send', grantId: s.grant.id, targetId: 'chat', source: { kind: 'task', id: s.task.id }, text: 'Reminder' }, s.context)).rejects.toThrow();
    expect(s.interact).toHaveBeenCalledTimes(1);
    expect(s.tree.elements[1].value).toBe('Reminder');
  });

  it('discovers existing resources without claiming unsupported delivery or leaking other conversations', async () => {
    const s = await setup();
    const result = await s.service.execute(s.workspace.id,{command:'capabilities'},s.context);
    expect(result).toMatchObject({kind:'capabilities',conversations:[{grantId:s.grant.id,allowProactive:false,memoryEnabled:false}]});
    if (result.kind !== 'capabilities') throw Error('Expected capabilities');
    expect(result.capabilities.find(c=>c.id==='native_attachment')?.state).toBe('unsupported');
    expect(result.capabilities.find(c=>c.id==='audio_file')?.tools).toContain('artifact_speech');
    await expect(s.service.execute(s.workspace.id,{command:'capabilities'},{...s.context,actorId:s.node.id})).rejects.toThrow('assigned task');
  });

  it.each([false,true])('recovers one verified partial draft before Send, never another message (diverged=%s)', async diverged => {
    const s = await setup();
    s.interact.mockImplementationOnce(async input => {
      s.tree.elements[1].value = diverged ? 'Human changed the text' : input.text.slice(0,8);
      throw Error('Native accessibility check failed (element_changed). No automatic retry; inspect the current target.');
    });
    const attempt = s.service.execute(s.workspace.id,s.reply(),s.context);
    if (diverged) { await expect(attempt).rejects.toThrow('element_changed'); expect(s.interact).toHaveBeenCalledTimes(1); }
    else {
      await expect(attempt).resolves.toMatchObject({kind:'reply',completed:true});
      expect(s.interact.mock.calls.map(([input])=>input.action)).toEqual(['fill','fill','press']);
      expect(s.interact.mock.calls[1][0].element.value).toBe('private-');
      expect(s.tree.elements[1].value).toBe('');
    }
  });
});
