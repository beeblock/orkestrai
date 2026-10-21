import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { collaborationRepository } from '$lib/modules/collaboration/infrastructure/repositories/CollaborationRepository.js';
import { collaborationPolicy } from '$lib/modules/collaboration/domain/policies/CollaborationPolicy.js';
import { sharedWorkspaceQuery } from '$lib/modules/collaboration/application/queries/SharedWorkspaceQuery.js';
import { fitSharedWorkspaceSnapshot, MAX_SHARED_SNAPSHOT_BYTES, scopeSharedWorkspaceSnapshot } from '$lib/modules/collaboration/application/queries/SharedWorkspaceQuery.js';
import { sharedWorkspaceCommandBus } from '$lib/modules/collaboration/application/services/SharedWorkspaceCommandBus.js';
import { collaborationRuntime } from '$lib/modules/collaboration/application/services/CollaborationRuntime.js';
import { collaborationShareService } from '$lib/modules/collaboration/application/services/CollaborationShareService.js';
import { CreateCollaborationShareRequest } from '$lib/modules/collaboration/interface/http/requests/CreateCollaborationShareRequest.js';
import { ApproveCollaborationDeviceRequest } from '$lib/modules/collaboration/interface/http/requests/ApproveCollaborationDeviceRequest.js';
import { ExecuteCollaborationCommandDto } from '$lib/modules/collaboration/application/dto/CollaborationDto.js';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { ApplyDesignOperationsDto } from '$lib/modules/agent-room/application/dto/DesignDtos.js';
import { designOperationSchema } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { collaborationCommandSchema } from '$lib/modules/collaboration/contracts/schemas/collaboration.schema.js';
import { huddleService } from '$lib/modules/agent-room/application/services/HuddleService.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';

function command(): string {
  return `command_${uuidv7().replaceAll('-', '_')}`;
}

async function setup(role: 'viewer' | 'operator' | 'administrator' = 'operator') {
  const workingDir = mkdtempSync(join(tmpdir(), 'orkestrai-collaboration-'));
  const workspace = await workspaceRepository.createWorkspace({
    name: 'Shared workspace',
    workingDir,
    instructions: 'Never expose ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 or /Users/host/private.',
  });
  const agent = await workspaceRepository.createNode({
    workspaceId: workspace.id,
    type: 'terminal',
    title: 'Leader /Users/host/private',
    x: 120,
    y: 80,
    payload: {
      provider: 'claude', role: 'Lead', maestro: true,
      sessionId: 'secret-session', env: { API_KEY: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' },
    },
  });
  await workspaceRepository.createNode({
    workspaceId: workspace.id,
    type: 'portal',
    title: 'Private portal',
    payload: { url: 'http://127.0.0.1:3000', token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' },
  });
  await taskBoardService.create(workspace.id, {
    title: 'Check /Users/host/private/file.ts',
    description: 'Use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 at http://localhost:3000.',
    assigneeNodeId: agent.id,
    createdBy: 'collaboration-test',
    dispatch: false,
  });
  const share = await collaborationRepository.createShare({
    workspaceId: workspace.id,
    defaultRole: role,
    relayUrl: 'wss://relay.example.test/v1/connect',
    maxPeers: 5,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const device = await collaborationRepository.requestDevice({
    shareId: share.id,
    workspaceId: workspace.id,
    deviceId: `device_${role}_01`,
    displayName: 'Remote reviewer',
    platform: 'darwin',
    fingerprint: 'AAAA-BBBB-CCCC-DDDD',
    role,
  });
  const approved = await collaborationRepository.approveDevice(device.id, role, collaborationPolicy.scopesForRole(role));
  return { workspace, share, device: approved, agent };
}

describe('collaboration host core', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('projects only allowlisted workspace data and redacts paths, secrets, and private URLs', async () => {
    const { share } = await setup();
    const snapshot = await sharedWorkspaceQuery.snapshot(share.id);
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.nodes.some((node) => node.type === 'agent')).toBe(true);
    expect(snapshot.nodes.some((node) => (node.type as string) === 'portal')).toBe(false);
    expect(serialized).not.toContain('secret-session');
    expect(serialized).not.toContain('API_KEY');
    expect(serialized).not.toContain('/Users/host/private');
    expect(serialized).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456');
    expect(serialized).not.toContain('http://localhost:3000');
    expect(serialized).toContain('[redacted-path]');
    expect(serialized).toContain('[redacted-secret]');
    expect(serialized).toContain('[redacted-private-url]');
  });

  it('projects only collaboration-originated conversations for the active share', async () => {
    const { share, workspace, agent } = await setup();
    await controlCenterService.recordDelivery({
      messageId: uuidv7(), workspaceId: workspace.id, toNodeId: agent.id,
      state: 'replied', content: 'Remote question', reply: 'Remote answer',
      metadata: { remoteCollaboration: true, remoteShareId: share.id, remoteDeviceId: 'remote_device_01' },
    });
    await controlCenterService.recordDelivery({
      messageId: uuidv7(), workspaceId: workspace.id, toNodeId: agent.id,
      state: 'replied', content: 'Internal secret', reply: 'Internal answer',
    });
    const snapshot = await sharedWorkspaceQuery.snapshot(share.id);
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.conversations[0]).toMatchObject({ message: 'Remote question', reply: 'Remote answer' });
    expect(JSON.stringify(snapshot.conversations)).not.toContain('Internal secret');
  });

  it('projects a bounded agent work summary without exposing internal message bodies', async () => {
    const { share, workspace, agent } = await setup();
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'working',
      category: 'task',
      verb: 'implementing',
      objectType: 'task',
      objectTitle: 'Implement checkout from /Users/host/private/spec.md',
      action: 'internal:verbose_action_that_is_not_shared',
    });
    await controlCenterService.recordDelivery({
      messageId: uuidv7(), workspaceId: workspace.id, toNodeId: agent.id,
      state: 'replied', content: 'Internal instructions must stay on the host', reply: 'Internal result',
    });

    const snapshot = await sharedWorkspaceQuery.snapshot(share.id);
    const summary = snapshot.agents.find((candidate) => candidate.id === agent.id)?.workSummary;
    expect(summary).toMatchObject({
      coordination: { received: 1, replied: 1, failed: 0 },
      recentActivity: [{ category: 'task', verb: 'implementing', state: 'working' }],
    });
    expect(summary?.recentActivity[0]?.objectTitle).toContain('[redacted-path]');
    expect(JSON.stringify(summary)).not.toContain('Internal instructions');
    expect(JSON.stringify(summary)).not.toContain('Internal result');
    expect(JSON.stringify(summary)).not.toContain('verbose_action');

    const withoutActivityScope = scopeSharedWorkspaceSnapshot(snapshot, ['workspace.view']);
    expect(withoutActivityScope.agents.every((candidate) => candidate.workSummary === null)).toBe(true);
    expect(withoutActivityScope.activity).toEqual([]);
  });

  it('removes design data from snapshots when the device has no design scope', async () => {
    const { share, workspace } = await setup();
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'design', title: 'Private design', payload: {} });
    const snapshot = await sharedWorkspaceQuery.snapshot(share.id);
    expect(snapshot.designs).toHaveLength(1);
    expect(snapshot.nodes.some((node) => node.type === 'design')).toBe(true);

    const scoped = scopeSharedWorkspaceSnapshot(snapshot, ['workspace.view']);
    const nodeIds = new Set(scoped.nodes.map((node) => node.id));
    expect(scoped.designs).toEqual([]);
    expect(scoped.nodes.some((node) => node.type === 'design')).toBe(false);
    expect(scoped.edges.every((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))).toBe(true);
  });

  it('puts messages from guests built before the shared Conversa into the agent direct conversation', async () => {
    const { share, workspace, device, agent } = await setup('operator');
    const enqueue = vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);

    const result = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      command(), 0, { type: 'leader.message', message: 'Review the release.' },
    ));
    expect(result).toMatchObject({ accepted: true, errorCode: null });
    const [stored] = await channelRepository.list(workspace.id, `dm:${agent.id}`);
    expect(stored).toMatchObject({ authorKind: 'owner', body: 'Review the release.', meta: { via: 'remote', deliverTo: [agent.id] } });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ toNodeId: agent.id, kind: 'owner', content: expect.stringContaining('Review the release.') }));

    // A message is never refused for a snapshot a moment old.
    const stale = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      command(), 0, { type: 'agent.message', agentNodeId: agent.id, message: 'And the changelog.' },
    ));
    expect(stale).toMatchObject({ accepted: true, errorCode: null });
    const missing = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      command(), 0, { type: 'agent.message', agentNodeId: uuidv7(), message: 'Anyone?' },
    ));
    expect(missing).toMatchObject({ accepted: false, errorCode: 'COMMAND_FAILED' });

    // Those guests read the exchange as a message and its reply.
    await channelService.postAgent(workspace.id, agent.id, { body: 'Release reviewed.' });
    const snapshot = scopeSharedWorkspaceSnapshot(await sharedWorkspaceQuery.snapshot(share.id), device.scopes);
    expect(snapshot.conversations[0]).toMatchObject({ agentNodeId: agent.id, message: 'And the changelog.', reply: 'Release reviewed.', state: 'replied' });
    expect(snapshot.conversations[1]).toMatchObject({ message: 'Review the release.', reply: null, state: 'queued' });
  });

  it('shares the Conversa with operators, who post, answer and page it without the agents talking to each other', async () => {
    const { share, workspace, device, agent } = await setup('operator');
    vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    // The answer really lands in the agent's inbox; no terminal is opened to deliver it.
    vi.spyOn(agentInboxService, 'kick').mockImplementation(() => undefined);
    const direct = `dm:${agent.id}`;
    const question = await channelService.askOwner(workspace.id, { nodeId: agent.id, title: 'Leader' }, { question: 'Publish to the store?', options: ['Yes', 'Not yet'] });
    // Messages of one millisecond are ordered by id, not by creation: keep the question the oldest.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await controlCenterService.recordDelivery({
      messageId: uuidv7(), workspaceId: workspace.id, toNodeId: agent.id,
      state: 'replied', content: 'Internal agent ask', reply: 'Internal agent reply',
    });

    const posted = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      command(), 0, { type: 'chat.post', channel: direct, body: 'Ship the beta from /Users/host/private/notes.md' },
    ));
    expect(posted).toMatchObject({ accepted: true, errorCode: null });
    const answered = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      command(), 0, { type: 'chat.post', channel: direct, body: 'Not yet', replyToId: question.id },
    ));
    expect(answered).toMatchObject({ accepted: true, errorCode: null });
    expect((await channelRepository.find(workspace.id, question.id))?.answeredAt).toBeTruthy();
    const twice = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      command(), 0, { type: 'chat.post', channel: direct, body: 'Yes', replyToId: question.id },
    ));
    expect(twice).toMatchObject({ accepted: false, errorCode: 'COMMAND_FAILED' });

    const snapshot = scopeSharedWorkspaceSnapshot(await sharedWorkspaceQuery.snapshot(share.id), device.scopes);
    expect(snapshot.chat?.channels[0]).toMatchObject({ id: 'team', kind: 'team' });
    expect(snapshot.chat?.channels.find((channel) => channel.nodeId === agent.id)).toMatchObject({ id: direct, kind: 'dm', leader: true, openQuestions: 0 });
    const messages = snapshot.chat?.messages ?? [];
    expect(messages.find((message) => message.kind === 'question')).toMatchObject({ body: 'Publish to the store?', options: ['Yes', 'Not yet'], answeredAt: expect.any(String) });
    expect(messages.find((message) => message.kind === 'answer')).toMatchObject({ authorKind: 'owner', via: 'remote', replyToId: question.id, body: 'Not yet' });
    expect(messages.some((message) => message.body.includes('[redacted-path]'))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('Internal agent');
    expect(JSON.stringify(snapshot)).not.toContain('/Users/host/private');

    // Older history comes in pages of whole messages.
    for (let index = 0; index < 70; index += 1) {
      await channelRepository.save({ workspaceId: workspace.id, channel: direct, authorKind: 'agent', authorNodeId: agent.id, body: `progress ${index} ${'detail '.repeat(150)}` });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const total = (await channelRepository.list(workspace.id, direct, { limit: 200 })).length;
    const latest = await sharedWorkspaceQuery.chatPage(share.id, direct, null);
    expect(latest).toMatchObject({ kind: 'chat.page', channel: direct, before: null, hasOlder: true });
    expect(latest.messages).toHaveLength(60);
    expect(latest.messages.at(-1)?.body.startsWith('progress 69 ')).toBe(true);
    expect(latest.messages.every((message) => !message.clipped)).toBe(true);
    const earlier = await sharedWorkspaceQuery.chatPage(share.id, direct, latest.messages[0].createdAt, latest.messages[0].id);
    expect(earlier.hasOlder).toBe(false);
    expect(earlier.messages).toHaveLength(total - 60);
    expect(earlier.messages[0].body).toBe('Publish to the store?');
    // A companion that sends only the time gets that instant again, never less.
    const legacy = await sharedWorkspaceQuery.chatPage(share.id, direct, latest.messages[0].createdAt);
    expect(legacy.messages.map((message) => message.id)).toEqual([...earlier.messages.map((message) => message.id), latest.messages[0].id]);
    await expect(sharedWorkspaceQuery.chatPage(share.id, `dm:${uuidv7()}`, null)).rejects.toThrow('CHAT_CHANNEL_NOT_FOUND');
  });

  it('pages through messages written in the same millisecond without skipping or repeating one', async () => {
    const { share, workspace, agent } = await setup('operator');
    const direct = `dm:${agent.id}`;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T16:00:00.000Z'));
    for (let index = 0; index < 65; index += 1) {
      await channelRepository.save({ workspaceId: workspace.id, channel: direct, authorKind: 'agent', authorNodeId: agent.id, body: `Mensagem ${index}` });
    }
    // The team channel mixes its posts with the agents' asks to each other.
    for (let index = 0; index < 20; index += 1) {
      await channelRepository.save({ workspaceId: workspace.id, channel: 'team', authorKind: 'agent', authorNodeId: agent.id, body: `Equipe ${index}` });
      await controlCenterService.recordDelivery({ messageId: uuidv7(), workspaceId: workspace.id, fromNodeId: agent.id, toNodeId: agent.id, state: 'queued', content: `Pedido ${index}` });
    }
    vi.useRealTimers();
    const stored = await channelRepository.list(workspace.id, direct, { limit: 200 });
    expect(new Set(stored.map((message) => message.createdAt)).size).toBe(1);

    const latest = await sharedWorkspaceQuery.chatPage(share.id, direct, null);
    expect(latest.messages).toHaveLength(60);
    expect(latest.hasOlder).toBe(true);
    const oldest = latest.messages[0];
    const older = await sharedWorkspaceQuery.chatPage(share.id, direct, oldest.createdAt, oldest.id);
    expect(older.messages).toHaveLength(5);
    expect(older.hasOlder).toBe(false);
    const seen = [...older.messages, ...latest.messages].map((message) => message.id);
    expect(new Set(seen).size).toBe(65);
    expect(seen).toEqual(stored.map((message) => message.id).reverse());

    // The app's own Conversa pages the same way.
    const page = await channelService.listMessages(workspace.id, direct, { limit: 40 });
    const last = page.at(-1)!;
    const rest = await channelService.listMessages(workspace.id, direct, { before: last.createdAt, beforeId: last.id, limit: 40 });
    expect(rest).toHaveLength(25);
    expect(new Set([...page, ...rest].map((message) => message.id)).size).toBe(65);

    const team: string[] = [];
    let cursor: { before?: string; beforeId?: string } = {};
    for (let read = 0; read < 10; read += 1) {
      const chunk = await channelService.listMessages(workspace.id, 'team', { ...cursor, limit: 15 });
      team.push(...chunk.map((message) => message.id));
      if (chunk.length < 15) break;
      cursor = { before: chunk.at(-1)!.createdAt, beforeId: chunk.at(-1)!.id };
    }
    // Page by page reads exactly what one long read does, in the same order.
    expect(team).toEqual((await channelService.listMessages(workspace.id, 'team', { limit: 200 })).map((message) => message.id));
    expect(team.filter((id) => id.startsWith('envelope:'))).toHaveLength(20);
    expect(team.filter((id) => !id.startsWith('envelope:')).length).toBeGreaterThanOrEqual(20);
  });

  it('keeps the shared Conversa inside one frame beside a large workspace', async () => {
    const { share, workspace, agent } = await setup('operator');
    for (let index = 0; index < 30; index += 1) {
      await channelRepository.save({ workspaceId: workspace.id, channel: 'team', authorKind: 'agent', authorNodeId: agent.id, body: `update ${index} ${'context '.repeat(900)}` });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const snapshot = await sharedWorkspaceQuery.snapshot(share.id);
    const oversized = {
      ...snapshot,
      tasks: Array.from({ length: 200 }, (_, index) => ({
        ...snapshot.tasks[0],
        id: uuidv7(),
        title: `Large task ${index}`,
        description: 'safe context '.repeat(4_000),
      })),
    };
    const fitted = fitSharedWorkspaceSnapshot(oversized);
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(MAX_SHARED_SNAPSHOT_BYTES);
    expect(fitted.chat?.channels).toHaveLength(2);
    expect(fitted.chat?.messages.length).toBeGreaterThan(0);
    expect(fitted.chat?.messages.at(-1)?.body.startsWith('update 29 ')).toBe(true);
  });

  it('keeps raw terminal access off by default and only grants an explicit administrator opt-in', () => {
    expect(collaborationPolicy.scopesForRole('administrator')).not.toContain('terminal.control');
    expect(collaborationPolicy.scopesForRole('operator')).toContain('voice.transcribe');
    expect(collaborationPolicy.scopesForRole('collaborator')).not.toContain('voice.transcribe');
    expect(collaborationPolicy.scopesForApproval('operator', true)).not.toContain('terminal.control');
    expect(collaborationPolicy.scopesForApproval('administrator', true)).toContain('terminal.control');
  });

  it('separates huddle viewing, speaking, and lifecycle management by role', () => {
    expect(collaborationPolicy.scopesForRole('viewer')).toContain('huddles.view');
    expect(collaborationPolicy.scopesForRole('viewer')).not.toContain('huddles.speak');
    expect(collaborationPolicy.scopesForRole('collaborator')).toEqual(expect.arrayContaining(['huddles.view', 'huddles.speak']));
    expect(collaborationPolicy.scopesForRole('collaborator')).not.toContain('huddles.manage');
    expect(collaborationPolicy.scopesForRole('operator')).toContain('huddles.manage');
    expect(collaborationPolicy.commandScope('huddle.create')).toBe('huddles.manage');
    expect(collaborationPolicy.commandScope('huddle.turn')).toBe('huddles.speak');
    expect(collaborationPolicy.commandScope('huddle.end')).toBe('huddles.manage');
  });

  it('grants design permissions independently from the collaboration role', () => {
    expect(collaborationPolicy.scopesForApproval('administrator', false, 'none')).not.toContain('design.view');
    expect(collaborationPolicy.scopesForApproval('viewer', false, 'view')).toContain('design.view');
    expect(collaborationPolicy.scopesForApproval('viewer', false, 'comment')).toEqual(expect.arrayContaining([
      'design.view',
      'design.comment',
    ]));
    expect(collaborationPolicy.scopesForApproval('viewer', false, 'comment')).not.toContain('design.propose');
    expect(collaborationPolicy.scopesForApproval('viewer', false, 'propose')).toEqual(expect.arrayContaining([
      'design.view',
      'design.comment',
      'design.propose',
    ]));
    expect(collaborationPolicy.scopesForApproval('viewer', false, 'edit')).toEqual(expect.arrayContaining([
      'design.view',
      'design.comment',
      'design.propose',
      'design.decide',
      'design.edit',
    ]));
    expect(collaborationPolicy.commandScope('design.proposal.create')).toBe('design.propose');
    expect(collaborationPolicy.commandScope('design.element.update')).toBe('design.edit');
  });

  it('validates bounded remote design mutations with strict payloads', () => {
    const changes = { x: 20, y: 30, width: 320, height: 180, opacity: 0.8, fill: '#2563eb' };
    expect(collaborationCommandSchema.parse({
      type: 'design.proposal.create', nodeId: uuidv7(), elementId: uuidv7(), title: 'Refine card', changes,
    })).toMatchObject({ type: 'design.proposal.create', changes });
    expect(() => collaborationCommandSchema.parse({
      type: 'design.element.update', nodeId: uuidv7(), elementId: uuidv7(), changes: { ...changes, fill: 'red' },
    })).toThrow();
    expect(() => collaborationCommandSchema.parse({
      type: 'design.element.update', nodeId: uuidv7(), elementId: uuidv7(), changes, unexpected: true,
    })).toThrow();
  });

  it('creates, approves, and directly applies remote design changes', async () => {
    const { share, workspace, device } = await setup('administrator');
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id, type: 'design', title: 'Remote review', payload: {},
    });
    const initial = await designDocumentService.get(workspace.id, node.id);
    const elementId = uuidv7();
    await designDocumentService.apply(new ApplyDesignOperationsDto(
      workspace.id,
      node.id,
      initial.revision,
      [designOperationSchema.parse({
        kind: 'create',
        element: {
          id: elementId, pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Card',
          x: 0, y: 0, width: 200, height: 120,
        },
      })],
      { kind: 'user', id: null, name: null, taskId: null },
      'Create remote test layer',
    ));
    const proposal = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      `command_${uuidv7().replaceAll('-', '_')}`,
      0,
      {
        type: 'design.proposal.create', nodeId: node.id, elementId, title: 'Move card',
        changes: { x: 24, y: 32, width: 240, height: 140, opacity: 0.9, fill: '#2563eb' },
      },
    ));
    expect(proposal).toMatchObject({ accepted: true, revision: 1, errorCode: null });
    let document = await designDocumentService.get(workspace.id, node.id);
    expect(document.proposals).toHaveLength(1);
    expect(document.elements.find((element) => element.id === elementId)).toMatchObject({ x: 0, y: 0 });

    const decision = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      `command_${uuidv7().replaceAll('-', '_')}`,
      1,
      { type: 'design.proposal.decide', nodeId: node.id, proposalId: document.proposals[0].id, status: 'approved' },
    ));
    expect(decision).toMatchObject({ accepted: true, revision: 2, errorCode: null });
    document = await designDocumentService.get(workspace.id, node.id);
    expect(document.proposals[0].status).toBe('approved');
    expect(document.elements.find((element) => element.id === elementId)).toMatchObject({ x: 24, y: 32, width: 240, height: 140 });

    const direct = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      `command_${uuidv7().replaceAll('-', '_')}`,
      2,
      {
        type: 'design.element.update', nodeId: node.id, elementId,
        changes: { x: 48, y: 64, width: 280, height: 160, opacity: 1, fill: '#059669' },
      },
    ));
    expect(direct).toMatchObject({ accepted: true, revision: 3, errorCode: null });
    document = await designDocumentService.get(workspace.id, node.id);
    expect(document.elements.find((element) => element.id === elementId)).toMatchObject({ x: 48, y: 64, width: 280, height: 160 });
  });

  it('starts a disconnected agent through an authorized remote command', async () => {
    const { share, workspace, device } = await setup('administrator');
    const shell = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Remote shell',
      payload: { command: '/bin/sh', args: [] },
    });
    try {
      const result = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
        `command_${uuidv7().replaceAll('-', '_')}`,
        0,
        { type: 'agent.invoke', agentNodeId: shell.id },
      ));
      expect(result).toMatchObject({ accepted: true, errorCode: null });
      const fresh = await workspaceRepository.getNode(shell.id);
      const sessionId = (fresh?.payload as { sessionId?: string }).sessionId;
      expect(sessionId).toBeTruthy();
      expect(ptySessionManager.get(sessionId!)?.exited).toBe(false);
    } finally {
      ptySessionManager.killAll();
    }
  });

  it('enforces scope, revision, and command idempotency before mutating tasks', async () => {
    const operator = await setup('operator');
    const commandId = `command_${uuidv7().replaceAll('-', '_')}`;
    const command = new ExecuteCollaborationCommandDto(commandId, 0, {
      type: 'task.create', title: 'Remote task', description: 'Traceable remote mutation',
    });
    const accepted = await sharedWorkspaceCommandBus.execute(operator.share.id, operator.device.id, command);
    expect(accepted).toMatchObject({ accepted: true, revision: 1, errorCode: null });
    const replay = await sharedWorkspaceCommandBus.execute(operator.share.id, operator.device.id, command);
    expect(replay).toEqual(accepted);
    expect((await taskBoardService.list(operator.workspace.id)).filter((task) => task.title === 'Remote task')).toHaveLength(1);

    const stale = await sharedWorkspaceCommandBus.execute(operator.share.id, operator.device.id, new ExecuteCollaborationCommandDto(
      `command_${uuidv7().replaceAll('-', '_')}`, 0, { type: 'task.create', title: 'Stale task' },
    ));
    expect(stale).toMatchObject({ accepted: false, errorCode: 'REVISION_CONFLICT', revision: 1 });

    const viewer = await setup('viewer');
    const denied = await sharedWorkspaceCommandBus.execute(viewer.share.id, viewer.device.id, new ExecuteCollaborationCommandDto(
      `command_${uuidv7().replaceAll('-', '_')}`, 0, { type: 'task.create', title: 'Forbidden task' },
    ));
    expect(denied).toMatchObject({ accepted: false, errorCode: 'SCOPE_DENIED' });
    expect((await taskBoardService.list(viewer.workspace.id)).some((task) => task.title === 'Forbidden task')).toBe(false);
    expect((await collaborationRepository.listAudit(operator.workspace.id)).some((event) => event.eventType === 'command.accepted')).toBe(true);
    expect((await collaborationRepository.listAudit(viewer.workspace.id)).some((event) => event.eventType === 'command.rejected')).toBe(true);
  });

  it('creates, projects, and ends a persistent huddle through authorized remote commands', async () => {
    const operator = await setup('operator');
    const created = await sharedWorkspaceCommandBus.execute(
      operator.share.id,
      operator.device.id,
      new ExecuteCollaborationCommandDto(`command_${uuidv7().replaceAll('-', '_')}`, 0, {
        type: 'huddle.create',
        title: 'Remote release room',
        agenda: 'Agree on the release gate.',
        agentNodeIds: [operator.agent.id],
        facilitatorNodeId: operator.agent.id,
      }),
    );
    expect(created).toMatchObject({
      accepted: true,
      revision: 1,
      errorCode: null,
    });
    const huddleId = String(created.result?.huddleId);
    expect((await huddleService.snapshot(operator.workspace.id, huddleId)).selected).toMatchObject({
      id: huddleId,
      status: 'active',
      createdByKind: 'remote',
    });
    const projection = await sharedWorkspaceQuery.snapshot(operator.share.id);
    expect(projection.huddles).toEqual([expect.objectContaining({ id: huddleId, title: 'Remote release room' })]);
    expect(scopeSharedWorkspaceSnapshot(projection, ['workspace.view']).huddles).toEqual([]);

    const ended = await sharedWorkspaceCommandBus.execute(
      operator.share.id,
      operator.device.id,
      new ExecuteCollaborationCommandDto(`command_${uuidv7().replaceAll('-', '_')}`, 1, {
        type: 'huddle.end',
        huddleId,
      }),
    );
    expect(ended).toMatchObject({
      accepted: true,
      revision: 2,
      errorCode: null,
    });
    expect((await huddleService.snapshot(operator.workspace.id, huddleId)).selected?.status).toBe('ended');

    const viewer = await setup('viewer');
    const denied = await sharedWorkspaceCommandBus.execute(
      viewer.share.id,
      viewer.device.id,
      new ExecuteCollaborationCommandDto(`command_${uuidv7().replaceAll('-', '_')}`, 0, {
        type: 'huddle.create',
        title: 'Forbidden room',
        agentNodeIds: [viewer.agent.id],
      }),
    );
    expect(denied).toMatchObject({
      accepted: false,
      errorCode: 'SCOPE_DENIED',
    });
  });

  it('fits large sanitized projections within the encrypted frame budget', async () => {
    const { share } = await setup();
    const snapshot = await sharedWorkspaceQuery.snapshot(share.id);
    const oversized = {
      ...snapshot,
      tasks: Array.from({ length: 200 }, (_, index) => ({
        ...snapshot.tasks[0],
        id: uuidv7(),
        title: `Large task ${index}`,
        description: 'safe context '.repeat(4_000),
      })),
    };
    const fitted = fitSharedWorkspaceSnapshot(oversized);
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(MAX_SHARED_SNAPSHOT_BYTES);
    expect(fitted.tasks.length).toBeLessThan(oversized.tasks.length);
  });

  it('offers the host default role instead of trusting a guest request', async () => {
    const { share } = await setup('operator');
    collaborationRuntime.create(share.id);
    try {
      const requested = await collaborationShareService.requestDevice(share.id, {
        deviceId: 'guest_default_role',
        displayName: 'Remote guest',
        platform: 'linux',
        requestedRole: 'viewer',
        guestNonce: 'a'.repeat(43),
        appVersion: '0.0.0',
      });
      expect(requested.role).toBe('operator');
    } finally {
      collaborationRuntime.remove(share.id);
    }
  });

  it('validates strict request bodies together with Svelar route parameters', async () => {
    const workspaceId = uuidv7();
    const shareId = uuidv7();
    const deviceId = uuidv7();
    const create = await CreateCollaborationShareRequest.validate({
      params: { id: workspaceId },
      url: new URL(`http://localhost/workspaces/${workspaceId}/collaboration`),
      request: new Request('http://localhost/collaboration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          defaultRole: 'collaborator',
          expiresInMinutes: 30,
          maxPeers: 3,
          relayUrl: 'wss://relay.example.test/v1/connect',
        }),
      }),
    } as never);
    expect(create).toEqual({
      defaultRole: 'collaborator',
      expiresInMinutes: 30,
      maxPeers: 3,
      relayUrl: 'wss://relay.example.test/v1/connect',
    });

    const approval = await ApproveCollaborationDeviceRequest.validate({
      params: { id: workspaceId, shareId, deviceId },
      url: new URL(`http://localhost/workspaces/${workspaceId}/collaboration/${shareId}/devices/${deviceId}`),
      request: new Request('http://localhost/collaboration-device', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true, role: 'operator' }),
      }),
    } as never);
    expect(approval).toEqual({ approved: true, role: 'operator', terminalAccess: false, designAccess: 'inherited' });
  });
});
