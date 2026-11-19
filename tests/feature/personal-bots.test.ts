import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uuidv7 } from '@beeblock/svelar/support';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { personalBotService } from '$lib/modules/agent-room/application/services/PersonalBotService.js';
import { PersonalBotCommandDto } from '$lib/modules/agent-room/application/dto/PersonalBotCommandDto.js';
import { personalBotGroupRepository } from '$lib/modules/agent-room/infrastructure/repositories/PersonalBotGroupRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { agentInboxService, AgentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { botResultRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotResultRepository.js';
import { botDeliveryRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotDeliveryRepository.js';
import { channelBindingRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelBindingRepository.js';
import { BotExternalDeliveryService, botExternalDeliveryService } from '$lib/modules/agent-room/application/services/BotExternalDeliveryService.js';
import { integrationExecutionService } from '$lib/modules/agent-room/application/services/IntegrationExecutionService.js';
import { channelTranscriptService } from '$lib/modules/agent-room/application/services/ChannelTranscriptService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { shownOnFloor } from '$lib/modules/agent-room/domain/canvas-floors.js';
import { materializeInteractiveAgentCommand } from '$lib/modules/agent-room/application/adapters/registry.js';
import type { PersonalBotGroup, PersonalBotSummary } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { WhatsAppBotService } from '$lib/modules/agent-room/application/services/WhatsAppBotService.js';
import { channelBindingService } from '$lib/modules/agent-room/application/services/ChannelBindingService.js';

describe('personal bot boundaries and persistence', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  beforeEach(() => { vi.spyOn(workspaceService, 'get').mockImplementation(async id => (await workspaceRepository.getWorkspace(id))!); });
  afterEach(async () => { agentInboxService.reset(); vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-personal-bots-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Personal', workingDir: root });
    const bot = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Assistant', payload: { provider: 'codex', personalBot: true, botInstructions: 'Owner rules', agentTransport: 'structured' } as never });
    const peer = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Reviewer', payload: { provider: 'claude', personalBot: true, agentTransport: 'structured' } as never });
    const developer = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Developer', payload: { provider: 'codex', maestro: true } as never });
    const command = (input: unknown, actor: string | null = null) => personalBotService.execute(PersonalBotCommandDto.from(workspace.id, input, actor));
    const group = () => command({ command: 'group_create', settings: { title: 'Personal group', instructions: 'Check evidence', memberIds: [bot.id, peer.id], coordinatorId: bot.id } }) as Promise<PersonalBotGroup>;
    return { workspace, root, bot, peer, developer, command, group };
  }

  it('creates an opt-in native bot without changing existing agents or exposing launch secrets', async () => {
    const f = await fixture();
    await workspaceRepository.updateNode(f.bot.id, { payload: { ...f.bot.payload, env: { SECRET: 'PRIVATE_CREDENTIAL' } } as never });
    const settings = { title: 'Calendar', instructions: 'Help with calendar', provider: 'claude', model: null, effort: null, profileId: null, transport: 'structured' };
    const created = await f.command({ command: 'create', settings }) as PersonalBotSummary;
    expect(created).toMatchObject({ title: 'Calendar', transport: 'structured', instructions: 'Help with calendar' });
    expect((await workspaceRepository.getNode(f.developer.id))!.payload).toEqual(f.developer.payload);
    expect(JSON.stringify(await personalBotService.list(f.workspace.id))).not.toContain('PRIVATE_CREDENTIAL');
    const chats = await channelService.listChannels(f.workspace.id);
    expect(chats.agents.map(agent => agent.id)).toEqual([f.developer.id]);
    expect(shownOnFloor(f.bot, null)).toBe(false);
    expect(shownOnFloor(f.developer, null)).toBe(true);
  });

  it('preserves bot instructions in the selectable terminal fallback', async () => {
    const f = await fixture();
    const payload = { ...f.bot.payload, provider: 'claude', personalBot: true, botInstructions: 'Keep my custom rules', agentTransport: 'terminal' };
    const result = materializeInteractiveAgentCommand(payload);
    expect(JSON.stringify(result.payload.initialRoleArgs)).toContain('Keep my custom rules');
    expect(result.payload.agentTransport).toBe('terminal');
  });

  it('rejects cross-workspace members, invalid coordinators and unknown command fields before mutation', async () => {
    const f = await fixture(), other = await fixture();
    await expect(f.command({ command: 'group_create', settings: { title: 'Invalid', memberIds: [f.bot.id, other.bot.id], coordinatorId: f.bot.id } })).rejects.toThrow('PERSONAL_BOT_NOT_FOUND');
    expect(() => PersonalBotCommandDto.from(f.workspace.id, { command: 'group_create', settings: { title: 'Invalid', memberIds: [f.bot.id], coordinatorId: other.bot.id } })).toThrow();
    expect(() => PersonalBotCommandDto.from(f.workspace.id, { command: 'remove', nodeId: f.bot.id, from: other.bot.id })).toThrow();
    expect(await personalBotGroupRepository.list(f.workspace.id)).toEqual([]);
  });

  it('exposes and controls only scoped personal-bot bindings through the shared command contract', async () => {
    const f = await fixture(), other = await fixture();
    const own = await channelBindingRepository.create({ workspaceId: f.workspace.id, nodeId: f.bot.id, integrationId: uuidv7(), kind: 'telegram', externalChatId: '42', allowedSenders: [] });
    const foreign = await channelBindingRepository.create({ workspaceId: other.workspace.id, nodeId: other.bot.id, integrationId: uuidv7(), kind: 'telegram', externalChatId: '99', allowedSenders: [] });
    expect((await personalBotService.list(f.workspace.id)).bindings.map(item => item.id)).toEqual([own.id]);
    const enabled = vi.spyOn(channelBindingService, 'setEnabled').mockResolvedValue({ ...own, enabled: false });
    await expect(f.command({ command: 'set_binding', bindingId: foreign.id, enabled: false })).rejects.toThrow('BOT_BINDING_NOT_FOUND');
    expect(enabled).not.toHaveBeenCalled();
    await f.command({ command: 'set_binding', bindingId: own.id, enabled: false });
    expect(enabled).toHaveBeenCalledWith(f.workspace.id, own.id, false);
  });

  it('guards concurrent group edits with revisions', async () => {
    const f = await fixture(), group = await f.group();
    const edit = (title: string) => f.command({ command: 'group_update', groupId: group.id, revision: group.revision, settings: { title, memberIds: group.memberIds, coordinatorId: group.coordinatorId } });
    const result = await Promise.allSettled([edit('First'), edit('Second')]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect((await personalBotGroupRepository.find(f.workspace.id, group.id))!.revision).toBe(2);
  });

  it('repairs membership and coordinator on deletion and archives the last member group', async () => {
    const f = await fixture(), group = await f.group();
    vi.spyOn(workspaceService as any, 'reprovisionBridge').mockResolvedValue(undefined);
    await workspaceService.deleteNode(f.workspace.id, f.bot.id);
    expect(await personalBotGroupRepository.find(f.workspace.id, group.id)).toMatchObject({
      memberIds: [f.peer.id], coordinatorId: f.peer.id, revision: 2, archived: false,
    });
    await workspaceService.deleteNode(f.workspace.id, f.peer.id);
    expect((await personalBotGroupRepository.find(f.workspace.id, group.id))!.archived).toBe(true);
  });

  it('requires the live bridge identity and an assigned task for bot configuration', async () => {
    const f = await fixture();
    vi.spyOn(bridgeService, 'resolveWorkspaceByToken').mockResolvedValue(f.workspace);
    const resolve = vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockReturnValue(null);
    const controller = new BridgeController();
    const event = () => ({ url: new URL('http://localhost/api/agent-room/bridge/bots'), request: new Request('http://localhost/api/agent-room/bridge/bots', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture', 'x-orkestrai-agent-token': 'live-token' },
      body: JSON.stringify({ input: { command: 'remove', nodeId: f.peer.id } }),
    }) });
    const noIdentity = await controller.bots(event());
    expect(noIdentity.status).toBe(403);
    resolve.mockReturnValue(f.bot.id);
    const noTask = await controller.bots(event());
    expect(noTask.status).toBe(403);
    expect(await workspaceRepository.getNode(f.peer.id)).not.toBeNull();
  });

  it('records agent group messages under the authenticated agent, never as the owner', async () => {
    const f = await fixture(), group = await f.group();
    const release = vi.fn();
    const queue = vi.spyOn(agentInboxService, 'enqueueDeferred').mockResolvedValue({ envelope: {} as never, release });
    const message = await f.command({ command: 'group_send', groupId: group.id, body: '@Reviewer check the report' }, f.bot.id) as any;
    expect(message).toMatchObject({ authorKind: 'agent', authorNodeId: f.bot.id });
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ fromNodeId: f.bot.id, toNodeId: f.peer.id, kind: 'bot_group' }));
    expect(await channelService.postStructuredResult(f.workspace.id, f.peer.id, message.id, 'Group reply', uuidv7())).toMatchObject({ channel: `botgroup:${group.id}` });
    expect(release).toHaveBeenCalledOnce();
    await expect(f.command({ command: 'group_send', groupId: group.id, body: 'Pretend to be owner' }, f.developer.id)).rejects.toThrow('BOT_GROUP_MEMBERSHIP_REQUIRED');
  });

  it('carries the original native chat return address into a delegated ask', async () => {
    const f = await fixture();
    const source = uuidv7(), batchId = uuidv7();
    vi.spyOn(ptySessionManager, 'structuredRequest').mockReturnValue({ conversationKey: 'binding:private-chat', messageId: batchId });
    vi.spyOn(controlCenterRepository, 'batchLead').mockResolvedValue({ metadata: { channelMessageId: source } } as never);
    const ask = vi.spyOn(bridgeService as any, 'askAgent').mockResolvedValue({});
    await bridgeService.ask(f.workspace.id, { to: f.peer.id, from: f.bot.id, message: 'Check this' });
    expect(ask.mock.calls[0][1]).toMatchObject({ metadata: { returnConversationKey: 'binding:private-chat', returnChannelMessageId: source } });
  });

  it('delivers unmentioned group messages only to the coordinator, with an exact group return address', async () => {
    const f = await fixture(), group = await f.group();
    const queue = vi.spyOn(agentInboxService, 'enqueueDeferred').mockResolvedValue({ envelope: {} as never, release: vi.fn() });
    const message = await f.command({ command: 'group_send', groupId: group.id, body: 'Prepare the report' }) as any;
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'owner', toNodeId: f.bot.id, metadata: expect.objectContaining({ botGroupId: group.id, channelMessageId: message.id }) }));
    const result = await channelService.postStructuredResult(f.workspace.id, f.bot.id, message.id, 'Report ready', uuidv7());
    expect(result!.channel).toBe(`botgroup:${group.id}`);
    expect(await channelRepository.list(f.workspace.id, 'team')).toEqual([]);
  });

  it('persists and recovers a final answer after a restart exactly once, without rerunning the model', async () => {
    const f = await fixture();
    const source = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'owner', body: 'Question' });
    const packet = await agentInboxService.enqueueDeferred({ workspaceId: f.workspace.id, toNodeId: f.bot.id, kind: 'owner', content: 'Question', metadata: { channelMessageId: source.id } });
    const batchId = uuidv7();
    await botResultRepository.save({ id: batchId, workspaceId: f.workspace.id, nodeId: f.bot.id, messageIds: [packet.envelope.id], body: 'Recovered final' });
    const dispatcher = new AgentInboxService();
    await (dispatcher as any).recoverStructuredResults();
    await (dispatcher as any).recoverStructuredResults();
    dispatcher.reset();
    const messages = await channelRepository.list(f.workspace.id, source.channel);
    expect(messages.filter(message => message.authorKind === 'agent').map(message => message.body)).toEqual(['Recovered final']);
    expect(await botResultRepository.pending()).toEqual([]);
  });

  it('never routes a native final into another bot direct chat or an archived group', async () => {
    const f = await fixture(), group = await f.group();
    const dm = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.peer.id}`, authorKind: 'owner', body: 'Private' });
    expect(await channelService.postStructuredResult(f.workspace.id, f.bot.id, dm.id, 'Must not leak', uuidv7())).toBeNull();
    const source = await channelRepository.save({ workspaceId: f.workspace.id, channel: `botgroup:${group.id}`, authorKind: 'owner', body: 'Before archive' });
    await f.command({ command: 'group_archive', groupId: group.id, revision: group.revision });
    expect(await channelService.postStructuredResult(f.workspace.id, f.bot.id, source.id, 'After archive', uuidv7())).toBeNull();
  });

  it('does not merge private bot traffic into the existing team timeline', async () => {
    const f = await fixture();
    await agentInboxService.enqueueDeferred({ workspaceId: f.workspace.id, fromNodeId: f.bot.id, toNodeId: f.peer.id, kind: 'ask', content: 'PRIVATE BOT GROUP' });
    expect((await controlCenterRepository.listConversationEnvelopes(f.workspace.id, { before: null, limit: 50 })).length).toBe(1);
    expect(await channelService.listMessages(f.workspace.id, 'team')).toEqual([]);
  });

  it('never claims another conversation through a native bot tool-response header', async () => {
    const f = await fixture();
    const packet = await agentInboxService.enqueueDeferred({ workspaceId: f.workspace.id, toNodeId: f.bot.id, kind: 'owner', content: 'PRIVATE OTHER CHAT', metadata: { bindingId: uuidv7() } });
    vi.spyOn(ptySessionManager, 'listLiveForNode').mockReturnValue([{ transport: 'structured' }] as never);
    expect(await agentInboxService.claim(f.workspace.id, f.bot.id)).toEqual({ items: [], remaining: 0 });
    expect((await controlCenterRepository.findEnvelope(packet.envelope.id))!.state).toBe('queued');
  });

  it('does not duplicate native finals through the legacy transcript mirror, while legacy direct chat still follows it', async () => {
    const f = await fixture();
    const follow = vi.spyOn(channelTranscriptService, 'follow').mockResolvedValue(undefined);
    await channelService.listMessages(f.workspace.id, `dm:${f.bot.id}`);
    expect(follow).not.toHaveBeenCalled();
    await channelService.listMessages(f.workspace.id, `dm:${f.developer.id}`);
    await vi.waitFor(() => expect(follow).toHaveBeenCalledWith(f.workspace.id, f.developer.id));
  });

  it('keeps an authenticated fallback group post in its group without waking every bot', async () => {
    const f = await fixture(), group = await f.group();
    const enqueue = vi.spyOn(agentInboxService, 'enqueueDeferred');
    const result = await f.command({ command: 'group_post', groupId: group.id, body: 'Finished checking' }, f.peer.id) as any;
    expect(result).toMatchObject({ authorKind: 'agent', authorNodeId: f.peer.id, channel: `botgroup:${group.id}` });
    expect(enqueue).not.toHaveBeenCalled();
    await expect(f.command({ command: 'group_post', groupId: group.id, body: 'Spoof' })).rejects.toThrow('BOT_GROUP_MEMBERSHIP_REQUIRED');
  });

  it('recovers an external reply and PDF from the durable outbox using the same exact address and idempotency keys', async () => {
    const f = await fixture();
    vi.spyOn(botExternalDeliveryService, 'flush').mockResolvedValue();
    await writeFile(join(f.root, 'report.pdf'), '%PDF-1.4 test');
    const binding = await channelBindingRepository.create({ workspaceId: f.workspace.id, nodeId: f.bot.id, integrationId: uuidv7(), kind: 'telegram', externalChatId: '42', allowedSenders: [] });
    const source = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'external', body: 'Report please', meta: { bindingId: binding.id } });
    const result = await channelService.postStructuredResult(f.workspace.id, f.bot.id, source.id, 'x'.repeat(4500) + '\n[Report](report.pdf)', uuidv7());
    expect(result!.meta.artifacts).toMatchObject([{ path: 'report.pdf', mimeType: 'application/pdf', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    let failOnce = true;
    const accepted = new Set<string>();
    const execute = vi.spyOn(integrationExecutionService, 'execute').mockImplementation(async (_workspace, input) => {
      if (input.idempotencyKey!.endsWith('text:1') && failOnce) { failOnce = false; throw new Error('Failed before publication'); }
      accepted.add(input.idempotencyKey!);
      expect(input.input.chatId).toBe('42');
      return { receipt: { state: 'accepted' } };
    });
    const sender = new BotExternalDeliveryService();
    await sender.flush(); expect((await botDeliveryRepository.pending())[0].state).toBe('queued');
    await sender.flush(); expect(await botDeliveryRepository.pending()).toEqual([]);
    expect(accepted.size).toBe(3);
    const count = execute.mock.calls.length;
    await sender.flush(); expect(execute).toHaveBeenCalledTimes(count);
    expect(execute.mock.calls.some(([, input]) => input.action === 'telegram.send_document')).toBe(true);
  });

  it('continues past a full page of failing external replies instead of starving newer chats', async () => {
    const f = await fixture();
    const binding = await channelBindingRepository.create({ workspaceId: f.workspace.id, nodeId: f.bot.id, integrationId: uuidv7(), kind: 'telegram', externalChatId: '42', allowedSenders: [] });
    const ids: string[] = [];
    for (let index = 0; index < 51; index++) {
      const message = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'agent', authorNodeId: f.bot.id, body: `Reply ${index}`, meta: { bindingId: binding.id } });
      ids.push(message.id);
      await botDeliveryRepository.create(f.workspace.id, f.bot.id, binding.id, message.id);
    }
    vi.spyOn(integrationExecutionService, 'execute').mockImplementation(async (_workspace, input) => {
      if (input.input.text !== 'Reply 50') throw new Error('Failed before publication');
      return { receipt: { state: 'accepted' } };
    });
    await new BotExternalDeliveryService().flush();
    expect((await botDeliveryRepository.pending(100)).map(item => item.id)).not.toContain(ids[50]);
    expect(await botDeliveryRepository.pending(100)).toHaveLength(50);
  });

  it('refuses artifact links that escape through symlinks and rejects files changed after the model result', async () => {
    const f = await fixture(), other = await fixture();
    await writeFile(join(other.root, 'private.pdf'), '%PDF private');
    await symlink(join(other.root, 'private.pdf'), join(f.root, 'escape.pdf'));
    await expect(integrationExecutionService.readBotArtifact(f.workspace.id, f.bot.id, 'escape.pdf')).rejects.toThrow('escapes');
    await writeFile(join(f.root, 'report.pdf'), '%PDF original');
    await expect(integrationExecutionService.readBotArtifact(f.workspace.id, f.bot.id, 'report.pdf', '0'.repeat(64))).rejects.toThrow('BOT_ARTIFACT_CHANGED');
  });

  it('delivers file replies from a terminal-fallback bot through the same durable native-channel outbox', async () => {
    const f = await fixture();
    vi.spyOn(botExternalDeliveryService, 'flush').mockResolvedValue();
    await workspaceRepository.updateNode(f.bot.id, { payload: { ...f.bot.payload, agentTransport: 'terminal' } as never });
    await writeFile(join(f.root, 'fallback.pdf'), '%PDF fallback');
    const source = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'external', body: 'Report', meta: { bindingId: uuidv7() } });
    const reply = await channelService.postAgent(f.workspace.id, f.bot.id, { body: '[Report](fallback.pdf)', replyToId: source.id });
    expect(reply.meta.artifacts).toMatchObject([{ path: 'fallback.pdf', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect((await botDeliveryRepository.pending()).map(item => item.id)).toContain(reply.id);
  });

  it('rejects invalid WhatsApp media without trapping later inbound messages behind it', async () => {
    const f = await fixture();
    const service = new WhatsAppBotService();
    const dispatch = vi.spyOn(service as any, 'dispatch').mockRejectedValueOnce(new Error('CHANNEL_ATTACHMENT_TOO_LARGE')).mockResolvedValue(undefined);
    vi.spyOn(service as any, 'persistPending').mockResolvedValue(undefined);
    const link = { connection: { id: uuidv7(), workspaceId: f.workspace.id }, pending: [{ key: { id: 'large', remoteJid: '5511999999999@s.whatsapp.net' } }, { key: { id: 'next', remoteJid: '5511999999999@s.whatsapp.net' } }], stopped: false, draining: false, saveTail: Promise.resolve() };
    await (service as any).drain(link);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(link.pending).toEqual([]);
    expect(link).toMatchObject({ error: 'CHANNEL_ATTACHMENT_TOO_LARGE' });
  });

  it('keeps an unrelated WhatsApp chat moving while a slow or failed file waits, retaining same-chat order', async () => {
    const f = await fixture(), service = new WhatsAppBotService();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const dispatch = vi.spyOn(service as any, 'dispatch').mockImplementation(async (_link, message: any) => {
      if (message.key.id === 'slow') { await barrier; throw new Error('Temporary download failure'); }
    });
    vi.spyOn(service as any, 'persistPending').mockResolvedValue(undefined);
    const link = { connection: { id: uuidv7(), workspaceId: f.workspace.id }, pending: [
      { key: { id: 'slow', remoteJid: '5511111111111@s.whatsapp.net' } },
      { key: { id: 'same-chat', remoteJid: '5511111111111@s.whatsapp.net' } },
      { key: { id: 'independent', remoteJid: '5522222222222@s.whatsapp.net' } },
    ], stopped: false, draining: false, saveTail: Promise.resolve(), drainRetry: null as ReturnType<typeof setTimeout> | null };
    const drain = (service as any).drain(link);
    try {
      await vi.waitFor(() => expect(dispatch.mock.calls.some(([, message]: any) => message.key.id === 'independent')).toBe(true));
      expect(dispatch.mock.calls.some(([, message]: any) => message.key.id === 'same-chat')).toBe(false);
      link.pending.push({ key: { id: 'new-arrival', remoteJid: '5533333333333@s.whatsapp.net' } });
      await (service as any).drain(link);
      await vi.waitFor(() => expect(dispatch.mock.calls.some(([, message]: any) => message.key.id === 'new-arrival')).toBe(true));
    } finally { release(); await drain; if (link.drainRetry) clearTimeout(link.drainRetry); }
    expect(link.pending.map(message => message.key.id)).toEqual(['slow', 'same-chat']);
  });

  it('preserves the whole long answer in an owned text attachment instead of silently losing its end', async () => {
    const f = await fixture();
    const source = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'owner', body: 'Explain' });
    const answer = 'answer '.repeat(2000);
    const result = await channelService.postStructuredResult(f.workspace.id, f.bot.id, source.id, answer, uuidv7());
    expect(result!.body.length).toBeLessThanOrEqual(8000);
    const file = (result!.meta.attachments as any[])[0];
    expect((await integrationExecutionService.readBotArtifact(f.workspace.id, f.bot.id, file.path)).toString()).toBe(answer);
    expect(await channelRepository.referencesAttachment(f.workspace.id, file.id)).toBe(true);
  });
});
