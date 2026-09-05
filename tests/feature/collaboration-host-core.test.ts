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
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { ApplyDesignOperationsDto } from '$lib/modules/agent-room/application/dto/DesignDtos.js';
import { designOperationSchema } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { collaborationCommandSchema } from '$lib/modules/collaboration/contracts/schemas/collaboration.schema.js';
import { huddleService } from '$lib/modules/agent-room/application/services/HuddleService.js';

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

  afterEach(() => vi.restoreAllMocks());

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

  it('routes leader messages through the correlated remote conversation flow', async () => {
    const { share, workspace, device, agent } = await setup('operator');
    vi.spyOn(bridgeService, 'listAgents').mockResolvedValue([{
      nodeId: agent.id,
      title: 'Leader',
      provider: 'claude',
      command: 'claude',
      sessionId: 'leader-session',
      sessionAlive: true,
      maestro: true,
    }]);
    const ask = vi.spyOn(bridgeService, 'ask').mockResolvedValue({
      to: 'Leader',
      reply: 'Done',
      delivered: true,
      replyConfirmed: true,
      timedOut: false,
      messageId: uuidv7(),
      deliveryState: 'replied',
    });

    const result = await sharedWorkspaceCommandBus.execute(share.id, device.id, new ExecuteCollaborationCommandDto(
      `command_${uuidv7().replaceAll('-', '_')}`,
      0,
      { type: 'leader.message', message: 'Review the release.' },
    ));

    expect(result).toMatchObject({ accepted: true, errorCode: null });
    expect(ask).toHaveBeenCalledWith(workspace.id, expect.objectContaining({
      to: agent.id,
      message: 'Review the release.',
      metadata: expect.objectContaining({
        remoteCollaboration: true,
        remoteShareId: share.id,
        remoteDeviceId: device.deviceId,
      }),
    }));
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
