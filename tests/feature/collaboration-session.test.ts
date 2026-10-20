import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { createInviteUri } from '@orkestrai/collaboration-protocol';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { collaborationPolicy } from '$lib/modules/collaboration/domain/policies/CollaborationPolicy.js';
import { collaborationRepository } from '$lib/modules/collaboration/infrastructure/repositories/CollaborationRepository.js';
import { collaborationRuntime } from '$lib/modules/collaboration/application/services/CollaborationRuntime.js';
import { collaborationSessionManager } from '$lib/modules/collaboration/application/services/CollaborationSessionManager.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { createRelayServer } from '../../packages/orkestrai-relay/src/server.mjs';

async function eventually<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for collaboration state.');
}

describe('collaboration encrypted session', () => {
  useSvelarTest({ refreshDatabase: true });
  const relays: Array<ReturnType<typeof createRelayServer>> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    collaborationSessionManager.shutdown();
    await Promise.all(relays.splice(0).map((relay) => relay.close()));
  });

  it('pairs through the opaque relay and executes a scoped command on the host', async () => {
    const relay = createRelayServer();
    relays.push(relay);
    const address = await relay.listen(0, '127.0.0.1');
    if (!address || typeof address === 'string') throw new Error('Relay did not bind a TCP port.');

    const workspace = await workspaceRepository.createWorkspace({
      name: 'Remote product room',
      workingDir: mkdtempSync(join(tmpdir(), 'orkestrai-session-')),
    });
    const share = await collaborationRepository.createShare({
      workspaceId: workspace.id,
      defaultRole: 'operator',
      relayUrl: `ws://127.0.0.1:${address.port}/v1/connect`,
      maxPeers: 2,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const runtime = collaborationRuntime.create(share.id);
    await collaborationSessionManager.startHost(share.id);
    await eventually(() => collaborationSessionManager.hostStatus(share.id), (status) => status.state === 'connected');

    await collaborationSessionManager.join({
      inviteUri: createInviteUri(share.id, runtime.pairingSecret),
      relayUrl: share.relayUrl,
      displayName: 'Review laptop',
      platform: 'linux',
    });
    const requested = await eventually(
      () => collaborationRepository.listDevices(share.id),
      (devices) => devices.length === 1,
    );
    const approved = await collaborationRepository.approveDevice(
      requested[0].id,
      'operator',
      collaborationPolicy.scopesForRole('operator'),
    );
    await collaborationSessionManager.approvePeer(share.id, approved.id);

    const connected = await eventually(
      () => collaborationSessionManager.guestStatus(),
      (guest) => guest.status === 'connected' && Boolean(guest.snapshot),
    );
    expect(connected.snapshot?.workspace.name).toBe('Remote product room');
    expect(relay.metrics.framesForwarded).toBeGreaterThanOrEqual(4);

    const result = await collaborationSessionManager.sendGuestCommand({
      type: 'task.create',
      title: 'Review the remote handoff',
      description: 'Created through the encrypted companion channel.',
    });
    expect(result).toMatchObject({ accepted: true, errorCode: null });
    expect((await taskBoardService.list(workspace.id)).some((task) => task.title === 'Review the remote handoff')).toBe(true);
    await eventually(() => collaborationSessionManager.guestStatus(), (guest) => guest.revision === 1);

    await collaborationSessionManager.rejectPeer(share.id, approved.id, 'revoked');
    const revoked = await eventually(
      () => collaborationSessionManager.guestStatus(),
      (guest) => guest.status === 'revoked',
    );
    expect(revoked.errorCode).toBe('revoked');
  });

  it('answers Conversa reads with whole pages and refuses malformed or unauthorized commands', async () => {
    const relay = createRelayServer();
    relays.push(relay);
    const address = await relay.listen(0, '127.0.0.1');
    if (!address || typeof address === 'string') throw new Error('Relay did not bind a TCP port.');
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Remote conversation',
      workingDir: mkdtempSync(join(tmpdir(), 'orkestrai-session-chat-')),
    });
    const agent = await workspaceRepository.createNode({
      workspaceId: workspace.id, type: 'terminal', title: 'Lead', payload: { provider: 'claude', maestro: true },
    });
    const direct = `dm:${agent.id}`;
    await channelRepository.save({ workspaceId: workspace.id, channel: direct, authorKind: 'agent', authorNodeId: agent.id, body: `The full report: ${'detail '.repeat(600)}` });

    const pair = async (role: 'viewer' | 'operator') => {
      const share = await collaborationRepository.createShare({
        workspaceId: workspace.id, defaultRole: role, relayUrl: `ws://127.0.0.1:${address.port}/v1/connect`,
        maxPeers: 2, expiresAt: new Date(Date.now() + 60_000),
      });
      const runtime = collaborationRuntime.create(share.id);
      await collaborationSessionManager.startHost(share.id);
      await eventually(() => collaborationSessionManager.hostStatus(share.id), (status) => status.state === 'connected');
      await collaborationSessionManager.join({
        inviteUri: createInviteUri(share.id, runtime.pairingSecret), relayUrl: share.relayUrl, displayName: 'Phone', platform: 'ios',
      });
      const [requested] = await eventually(() => collaborationRepository.listDevices(share.id), (devices) => devices.length === 1);
      const approved = await collaborationRepository.approveDevice(requested.id, role, collaborationPolicy.scopesForRole(role));
      await collaborationSessionManager.approvePeer(share.id, approved.id);
      return eventually(() => collaborationSessionManager.guestStatus(), (guest) => guest.status === 'connected' && Boolean(guest.snapshot));
    };

    const operator = await pair('operator');
    expect(operator.snapshot?.chat?.channels.map((channel) => channel.id)).toEqual(['team', direct]);
    const page = await collaborationSessionManager.readGuestChat(direct);
    expect(page).toMatchObject({ kind: 'chat.page', channel: direct, hasOlder: false });
    expect(page.messages[0].body).toContain('The full report');
    expect(page.messages[0].clipped).toBe(false);
    await expect(collaborationSessionManager.readGuestChat(`dm:${uuidv7()}`)).rejects.toThrow('CHAT_UNAVAILABLE');

    const invalid = await collaborationSessionManager.sendGuestCommand({ type: 'chat.post', channel: '../team', body: 'Hi' } as never);
    expect(invalid).toMatchObject({ accepted: false, errorCode: 'INVALID_COMMAND' });
    vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    const posted = await collaborationSessionManager.sendGuestCommand({ type: 'chat.post', channel: direct, body: 'Thanks, ship it.' });
    expect(posted).toMatchObject({ accepted: true, errorCode: null });
    const updated = await eventually(
      () => collaborationSessionManager.guestStatus(),
      (guest) => Boolean(guest.snapshot?.chat?.messages.some((message) => message.body === 'Thanks, ship it.')),
    );
    expect(updated.snapshot?.chat?.messages.find((message) => message.body === 'Thanks, ship it.')).toMatchObject({ authorKind: 'owner', via: 'remote', delivery: 'queued' });

    collaborationSessionManager.shutdown();
    const viewer = await pair('viewer');
    expect(viewer.snapshot?.chat).toBeUndefined();
    await expect(collaborationSessionManager.readGuestChat(direct)).rejects.toThrow('SCOPE_DENIED');
  });
});
