import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, rm } from 'node:fs/promises';
import * as whatsappMedia from '$lib/modules/agent-room/infrastructure/integrations/WhatsAppMedia.js';
import { readFile } from 'node:fs/promises';
import { botAudioService } from '$lib/modules/agent-room/application/services/BotAudioService.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { botConnectionRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotConnectionRepository.js';
import { channelBindingRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelBindingRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { botDeliveryRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotDeliveryRepository.js';
import { channelBindingService } from '$lib/modules/agent-room/application/services/ChannelBindingService.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { botExternalDeliveryService } from '$lib/modules/agent-room/application/services/BotExternalDeliveryService.js';
import { WhatsAppBotService } from '$lib/modules/agent-room/application/services/WhatsAppBotService.js';
import { createChannelBindingSchema, updateChannelBindingSchema } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { botSafetyService } from '$lib/modules/agent-room/application/services/BotSafetyService.js';
import { botSafetySchema } from '$lib/modules/agent-room/contracts/schemas/bot-safety.schema.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

const group = '55119999999-12345@g.us';
const ana = '5511999999999@s.whatsapp.net', bob = '5521999999999@s.whatsapp.net';

describe('multiple personal bots in one linked WhatsApp group', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  beforeEach(() => {
    // Persist the real inbox/outbox, but never start models or a linked device.
    vi.spyOn(agentInboxService, 'kick').mockImplementation(() => {});
    vi.spyOn(botExternalDeliveryService, 'flush').mockResolvedValue(undefined);
  });
  afterEach(async () => {
    agentInboxService.reset(); vi.restoreAllMocks();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-wa-routes-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Group routes', workingDir: root });
    const bots = await Promise.all(['Sales', 'Support'].map(title => workspaceRepository.createNode({ workspaceId: workspace.id,
      type: 'terminal', title, payload: { provider: 'claude', personalBot: true, agentTransport: 'structured', botSafety: botSafetySchema.parse({ publicInstructions: 'Answer within your assigned public role.' }) } as never })));
    const account = await botConnectionRepository.create(workspace.id, 'Shared WhatsApp');
    const create = (nodeId: string, prefixes: string[], senders: string[] = []) => channelBindingService.create(workspace.id,
      createChannelBindingSchema.parse({ nodeId, integrationId: account.id, externalChatId: group, replyPrefixes: prefixes, allowedSenders: senders }));
    const service = new WhatsAppBotService();
    const link = { connection: account, stopped: false, socket: { user: { id: ana } } };
    const dispatch = (text: string, sender = ana, id = uuidv7()) => (service as any).dispatch(link, {
      key: { remoteJid: group, participant: sender, id }, message: { conversation: text }, pushName: 'Untrusted display name',
    });
    return { workspace, bots, account, create, dispatch, service, link };
  }

  it('shares one device across bots and delivers/replies only through the matching rule', async () => {
    const f = await fixture();
    const sales = await f.create(f.bots[0].id, ['@Sales']);
    const support = await f.create(f.bots[1].id, ['@Support', '#Support']);
    expect(await botConnectionRepository.list(f.workspace.id)).toHaveLength(1);
    const externalId = uuidv7();
    await f.dispatch('@Sales revenue', ana, externalId);
    await f.dispatch('@Sales revenue', ana, externalId);
    await f.dispatch('#Support investigate');
    await f.dispatch('ordinary group chatter');
    const a = await channelRepository.list(f.workspace.id, `dm:${f.bots[0].id}`);
    const b = await channelRepository.list(f.workspace.id, `dm:${f.bots[1].id}`);
    expect(a).toHaveLength(1); expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({ body: '@Sales revenue', meta: { bindingId: sales.id } });
    expect(b[0]).toMatchObject({ body: '#Support investigate', meta: { bindingId: support.id } });
    for (const bot of f.bots) expect(await controlCenterRepository.inboxEnvelopes(bot.id, ['queued'])).toHaveLength(1);
    await expect(channelService.postStructuredResult(f.workspace.id, f.bots[1].id, a[0].id, 'Wrong conversation', uuidv7())).resolves.toBeNull();
    for (const [index, source, binding, body] of [[0, a[0], sales, 'Sales answer'], [1, b[0], support, 'Support answer']] as const) {
      const id = uuidv7(), turn = await botSafetyService.begin(f.workspace.id, f.bots[index].id, binding.id, source.id);
      await botSafetyService.approve(turn, body, id);
      await channelService.postStructuredResult(f.workspace.id, f.bots[index].id, source.id, body, id);
    }
    const outbox = await botDeliveryRepository.pending();
    expect(outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: f.bots[0].id, bindingId: sales.id }),
      expect.objectContaining({ nodeId: f.bots[1].id, bindingId: support.id }),
    ]));
    expect(outbox).toHaveLength(2);
  });

  it('transcribes one permitted voice note, routes its leading spoken name and retains the original audio', async () => {
    const f = await fixture();
    const one = await f.create(f.bots[0].id, ['#jarvis'], [ana]);
    await f.create(f.bots[1].id, ['#sales'], [ana]);
    const bytes = await readFile(new URL('../fixtures/channel-audio/tone.ogg', import.meta.url));
    const download = vi.spyOn(whatsappMedia, 'downloadWhatsAppMedia').mockResolvedValue(bytes);
    const stt = vi.spyOn(botAudioService, 'transcribe').mockResolvedValue('Jarvis, me lembre amanhã');
    await (f.service as any).dispatch(f.link, { key: { remoteJid: group, participant: ana, id: uuidv7() },
      message: { audioMessage: { url: 'https://mmg.whatsapp.net/voice.ogg', mimetype: 'audio/ogg', fileLength: bytes.length, seconds: 1 } } });
    const messages = await channelRepository.list(f.workspace.id, `dm:${f.bots[0].id}`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ body: '#jarvis, me lembre amanhã', meta: { bindingId: one.id, attachments: [{ mimeType: 'audio/ogg' }] } });
    expect(await channelRepository.list(f.workspace.id, `dm:${f.bots[1].id}`)).toHaveLength(0);
    expect(download).toHaveBeenCalledOnce(); expect(stt).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(await controlCenterRepository.inboxEnvelopes(f.bots[0].id, ['queued'])).toHaveLength(1);
  });

  it('checks allowed senders before downloading or decoding audio and checks media URLs before transcription', async () => {
    const f = await fixture();
    await f.create(f.bots[0].id, ['#jarvis'], [ana]);
    const stt = vi.spyOn(botAudioService, 'transcribe').mockResolvedValue('Jarvis hello');
    const message = { key: { remoteJid: group, participant: bob, id: uuidv7() }, message: { audioMessage: { url: 'https://private.invalid/voice.ogg', fileLength: 200, seconds: 1, mimetype: 'audio/ogg' } } };
    await expect((f.service as any).dispatch(f.link, message)).resolves.toBeUndefined();
    expect(stt).not.toHaveBeenCalled();
    message.key.participant = ana;
    await expect((f.service as any).dispatch(f.link, message)).rejects.toThrow('CHANNEL_ATTACHMENT_DENIED');
    expect(stt).not.toHaveBeenCalled();
    expect(await channelRepository.list(f.workspace.id, `dm:${f.bots[0].id}`)).toEqual([]);
  });

  it('supports the same prefix for distinct verified senders', async () => {
    const f = await fixture();
    await f.create(f.bots[0].id, ['@Help'], ['+5511999999999']);
    await f.create(f.bots[1].id, ['@Help'], [bob]);
    await f.dispatch('@Help sales', ana);
    await f.dispatch('@Help support', bob);
    await f.dispatch('@Help ignored', '5531999999999@s.whatsapp.net');
    expect((await channelRepository.list(f.workspace.id, `dm:${f.bots[0].id}`)).map(m => m.body)).toEqual(['@Help sales']);
    expect((await channelRepository.list(f.workspace.id, `dm:${f.bots[1].id}`)).map(m => m.body)).toEqual(['@Help support']);
  });

  it.each([{ prefixes: ['@Support'] }, { prefixes: ['@SupportExtra'] }, { prefixes: [] }])('rejects overlapping prefix domains $prefixes for the same sender', async ({ prefixes }) => {
    const f = await fixture();
    await f.create(f.bots[0].id, ['@Support']);
    await expect(f.create(f.bots[1].id, prefixes)).rejects.toThrow('BOT_ROUTE_CONFLICT');
    expect(await channelBindingRepository.list(f.workspace.id)).toHaveLength(1);
  });

  it('serializes simultaneous setup and keeps only one conflicting rule', async () => {
    const f = await fixture();
    const results = await Promise.allSettled(f.bots.map(bot => f.create(bot.id, ['@Help'])));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await channelBindingRepository.list(f.workspace.id)).toHaveLength(1);
  });

  it('edits a legacy catch-all without disconnecting the shared device and rejects conflicting reactivation', async () => {
    const f = await fixture();
    const legacy = await f.create(f.bots[0].id, []);
    await expect(f.create(f.bots[1].id, ['@Support'])).rejects.toThrow('BOT_ROUTE_CONFLICT');
    const edit = updateChannelBindingSchema.parse({ enabled: true, replyPrefixes: ['@Sales'] });
    await channelBindingService.setEnabled(f.workspace.id, legacy.id, edit.enabled, edit);
    const second = await f.create(f.bots[1].id, ['@Support']);
    await channelBindingService.setEnabled(f.workspace.id, second.id, false);
    await channelBindingService.setEnabled(f.workspace.id, legacy.id, true, { replyPrefixes: ['@Support'] });
    await expect(channelBindingService.setEnabled(f.workspace.id, second.id, true)).rejects.toThrow('BOT_ROUTE_CONFLICT');
    expect(await channelBindingRepository.find(f.workspace.id, second.id)).toMatchObject({ enabled: false });
    expect(await botConnectionRepository.list(f.workspace.id)).toHaveLength(1);
  });

  it('retains both active routes when an edit conflicts, and revalidates a disconnected account', async () => {
    const f = await fixture();
    const sales = await f.create(f.bots[0].id, ['@Sales']);
    await f.create(f.bots[1].id, ['@Support']);
    await expect(channelBindingService.setEnabled(f.workspace.id, sales.id, true, { replyPrefixes: ['@Support'] })).rejects.toThrow('BOT_ROUTE_CONFLICT');
    expect(await channelBindingRepository.find(f.workspace.id, sales.id)).toMatchObject({ replyPrefixes: ['@Sales'], enabled: true });
    vi.spyOn(botConnectionRepository, 'find').mockResolvedValueOnce(f.account).mockResolvedValue(null);
    await expect(f.create(f.bots[0].id, ['@Other'])).rejects.toThrow('BOT_CONNECTION_UNAVAILABLE');
    expect(await channelBindingRepository.list(f.workspace.id)).toHaveLength(2);
  });

  it('preserves a concurrent owner pause when updating only routing rules', async () => {
    const f = await fixture();
    const binding = await f.create(f.bots[0].id, ['@Sales']);
    await channelBindingService.setEnabled(f.workspace.id, binding.id, false);
    const edit = updateChannelBindingSchema.parse({ replyPrefixes: ['@Revenue'], allowedSenders: [ana] });
    await channelBindingService.setEnabled(f.workspace.id, binding.id, edit.enabled, edit);
    expect(await channelBindingRepository.find(f.workspace.id, binding.id)).toMatchObject({ enabled: false, replyPrefixes: ['@Revenue'] });
    await f.dispatch('@Revenue report');
    expect(await channelRepository.list(f.workspace.id, `dm:${f.bots[0].id}`)).toEqual([]);
  });

  it('rejects invalid sender identifiers instead of turning them into an unrestricted rule', async () => {
    const f = await fixture();
    for (const sender of ['+', '@someone', 'Display name']) await expect(f.create(f.bots[0].id, ['@Help'], [sender])).rejects.toThrow('BOT_SENDER_INVALID');
    expect(await channelBindingRepository.list(f.workspace.id)).toEqual([]);
  });

  it.each([false, true])('allows a live task-authorized agent to edit routes (leader: %s)', async maestro => {
    const f = await fixture();
    const actor = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', title: 'Authorized agent', payload: { provider: 'claude', maestro } as never });
    const binding = await f.create(f.bots[0].id, ['@Sales']);
    const taskId = uuidv7();
    vi.spyOn(bridgeService, 'resolveWorkspaceByToken').mockResolvedValue(f.workspace);
    vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockReturnValue(actor.id);
    vi.spyOn(taskBoardService, 'list').mockResolvedValue([{ id: taskId, assigneeNodeId: actor.id, status: 'doing' }] as never);
    const controller = new BridgeController();
    const event = { request: new Request('http://localhost/api/agent-room/bridge/bots', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture', 'x-orkestrai-agent-token': 'live-fixture' },
      body: JSON.stringify({ taskId, input: { command: 'set_binding', bindingId: binding.id, enabled: true, replyPrefixes: ['@Revenue'], allowedSenders: [ana] } }) }) };
    const response = await controller.bots(event);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await channelBindingRepository.find(f.workspace.id, binding.id)).toMatchObject({ replyPrefixes: ['@Revenue'], allowedSenders: [ana], enabled: true });
  });
});
