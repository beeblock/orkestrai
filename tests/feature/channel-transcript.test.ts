import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { ChannelTranscriptService, channelTranscriptService } from '$lib/modules/agent-room/application/services/ChannelTranscriptService.js';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

describe('public terminal updates reach Conversation without a bridge post', () => {
  useSvelarTest({ refreshDatabase: true });
  const services: ChannelTranscriptService[] = [];
  afterEach(() => { for (const service of services.splice(0)) service.reset(); channelTranscriptService.reset(); vi.restoreAllMocks(); });
  async function fixture(delivered = true) {
    const workspace = await workspaceRepository.createWorkspace({ name: 'public replies', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Leader',
      payload: { provider: 'codex', maestro: true, agentSessionId: 'exact-session' } });
    const channel = `dm:${node.id}`;
    const owner = await channelRepository.save({ workspaceId: workspace.id, channel, authorKind: 'owner', body: 'Where is the delivery?',
      meta: delivered ? { deliveredAt: '2026-11-04T13:55:19.627Z' } : {} });
    vi.spyOn(agentInboxService, 'transcriptFor').mockResolvedValue({ provider: 'codex', cwd: '/tmp', agentSessionId: 'exact-session', options: {} });
    const read = vi.spyOn(transcript, 'publicTranscriptUpdates').mockResolvedValue({ complete: false,
      messages: [{ key: 'public-1', text: 'Deployment readiness failed; diagnosing the worker.', at: '2026-11-04T13:58:43.008Z' }] });
    const service = new ChannelTranscriptService(); services.push(service);
    const replies = async () => (await channelRepository.list(workspace.id, channel)).filter(message => message.authorKind === 'agent');
    return { workspace, node, channel, owner, service, read, replies };
  }

  it('publishes commentary during a long turn, without waiting for task_complete or calling the model', async () => {
    const f = await fixture();
    const enqueue = vi.spyOn(agentInboxService, 'enqueue');
    await f.service.follow(f.workspace.id, f.node.id);
    expect(await f.replies()).toMatchObject([{ authorNodeId: f.node.id, body: 'Deployment readiness failed; diagnosing the worker.',
      createdAt: '2026-11-04T13:58:43.008Z', meta: { via: 'terminal', transcriptSessionId: 'exact-session' } }]);
    expect(f.read).toHaveBeenCalledWith('codex', '/tmp', 'exact-session', Date.parse('2026-11-04T13:55:19.627Z'), {});
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('deduplicates simultaneous readers and a restarted follower durably', async () => {
    const f = await fixture();
    await Promise.all([f.service.follow(f.workspace.id, f.node.id), f.service.follow(f.workspace.id, f.node.id)]);
    f.service.reset();
    const next = new ChannelTranscriptService(); services.push(next);
    await Promise.all([next.follow(f.workspace.id, f.node.id), f.service.follow(f.workspace.id, f.node.id)]);
    expect(await f.replies()).toHaveLength(1);
  });

  it('does not duplicate the same update already explicitly posted through the bridge', async () => {
    const f = await fixture();
    await channelRepository.save({ workspaceId: f.workspace.id, channel: f.channel, authorKind: 'agent', authorNodeId: f.node.id,
      body: 'Deployment readiness failed; diagnosing the worker.', createdAt: '2026-11-04T13:58:44.000Z' });
    await f.service.follow(f.workspace.id, f.node.id);
    expect(await f.replies()).toHaveLength(1);
  });

  it('does not repeat database writes for an unchanged public update', async () => {
    const f = await fixture();
    const save = vi.spyOn(channelRepository, 'saveTranscriptUpdate');
    await f.service.follow(f.workspace.id, f.node.id);
    await f.service.follow(f.workspace.id, f.node.id);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('leaves an undelivered owner message queued and never reads another conversation to answer it', async () => {
    const f = await fixture(false);
    await f.service.follow(f.workspace.id, f.node.id);
    expect(f.read).not.toHaveBeenCalled();
    expect(await f.replies()).toHaveLength(0);
  });

  it('does not redirect the previous leader public text into a replacement leader conversation', async () => {
    const f = await fixture();
    const replacement = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', title: 'New leader',
      payload: { provider: 'claude', maestro: true, agentSessionId: 'replacement-session' } });
    await f.service.follow(f.workspace.id, f.node.id);
    expect(await f.replies()).toHaveLength(1);
    expect(await channelRepository.list(f.workspace.id, `dm:${replacement.id}`)).toHaveLength(0);
  });

  it('discards a transcript read if the provider conversation was replaced during filesystem I/O', async () => {
    const f = await fixture();
    f.read.mockImplementationOnce(async () => {
      await workspaceRepository.updateNode(f.node.id, { payload: { provider: 'claude', maestro: true, agentSessionId: 'replacement-session' } });
      return { complete: false, messages: [{ key: 'stale', text: 'Wrong account update', at: '2026-11-04T13:58:43.008Z' }] };
    });
    await f.service.follow(f.workspace.id, f.node.id);
    expect(await f.replies()).toHaveLength(0);
  });

  it('reconstructs the follower when stored Conversation is opened after restart', async () => {
    const f = await fixture();
    const follow = vi.spyOn(channelTranscriptService, 'follow').mockResolvedValue();
    await channelService.listMessages(f.workspace.id, f.channel);
    await vi.waitFor(() => expect(follow).toHaveBeenCalledWith(f.workspace.id, f.node.id));
  });

  it('delivers team-channel public updates only for the exact recipient that received the owner message', async () => {
    const f = await fixture(false);
    const team = await channelRepository.save({ workspaceId: f.workspace.id, channel: 'team', authorKind: 'owner',
      body: 'Team status?', meta: { deliverTo: [f.node.id] } });
    await f.service.follow(f.workspace.id, f.node.id, 'team');
    expect(f.read).not.toHaveBeenCalled();
    await channelRepository.markDelivered(f.workspace.id, team.id, '2026-11-04T13:55:19.627Z', f.node.id);
    await f.service.follow(f.workspace.id, f.node.id, 'team');
    expect((await channelRepository.list(f.workspace.id, 'team')).filter(message => message.authorKind === 'agent')).toHaveLength(1);
    expect(await f.replies()).toHaveLength(0);
  });

  it('preserves simultaneous receipt identities for multiple team recipients', async () => {
    const f = await fixture(false);
    const team = await channelRepository.save({ workspaceId: f.workspace.id, channel: 'team', authorKind: 'owner', body: 'Status?' });
    await Promise.all([f.node.id, 'another-recipient'].map(nodeId =>
      channelRepository.markDelivered(f.workspace.id, team.id, '2026-11-04T13:55:19.627Z', nodeId)));
    const stored = await channelRepository.find(f.workspace.id, team.id);
    expect(stored?.meta.deliveredNodes).toEqual(expect.arrayContaining([f.node.id, 'another-recipient']));
    expect(stored?.meta.deliveryReceipts).toMatchObject({ [f.node.id]: '2026-11-04T13:55:19.627Z', 'another-recipient': '2026-11-04T13:55:19.627Z' });
  });

  it('uses each team recipient own delivery time rather than another agent earlier receipt', async () => {
    const f = await fixture(false);
    const team = await channelRepository.save({ workspaceId: f.workspace.id, channel: 'team', authorKind: 'owner', body: 'Status?' });
    await channelRepository.markDelivered(f.workspace.id, team.id, '2026-11-04T13:50:00.000Z', 'other-agent');
    await channelRepository.markDelivered(f.workspace.id, team.id, '2026-11-04T13:55:19.627Z', f.node.id);
    await f.service.follow(f.workspace.id, f.node.id, 'team');
    expect(f.read).toHaveBeenCalledWith('codex', '/tmp', 'exact-session', Date.parse('2026-11-04T13:55:19.627Z'), {});
  });

  it('keeps stored team history available while transcript recovery is stalled', async () => {
    const f = await fixture();
    const stored = await channelRepository.save({ workspaceId: f.workspace.id, channel: 'team', authorKind: 'agent', body: 'Stored update.' });
    vi.spyOn(channelRepository, 'latestDeliveredOwner').mockImplementation(() => new Promise(() => undefined));
    expect(await channelService.listMessages(f.workspace.id, 'team')).toEqual(expect.arrayContaining([expect.objectContaining({ id: stored.id })]));
  });

  it('does not replay another conversation or export anything for an archived node', async () => {
    const f = await fixture();
    await workspaceRepository.archiveNode(f.node.id);
    await f.service.follow(f.workspace.id, f.node.id);
    expect(f.read).not.toHaveBeenCalled();
    expect(await f.replies()).toHaveLength(0);
  });
});
