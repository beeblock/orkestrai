import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uuidv7 } from '@beeblock/svelar/support';
import { AgentRoutineService } from '$lib/modules/agent-room/application/services/AgentRoutineService.js';
import { botRoutineService } from '$lib/modules/agent-room/application/services/BotRoutineService.js';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { bridgeAutomationCommandSchema } from '$lib/modules/agent-room/contracts/schemas/bridge-automation.schema.js';
import { automationFormSchema } from '$lib/modules/agent-room/contracts/schemas/automation.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { botConnectionRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotConnectionRepository.js';
import { channelBindingService } from '$lib/modules/agent-room/application/services/ChannelBindingService.js';
import { createChannelBindingSchema } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';
import { botSafetySchema } from '$lib/modules/agent-room/contracts/schemas/bot-safety.schema.js';
import { botSafetyService } from '$lib/modules/agent-room/application/services/BotSafetyService.js';
import { botOwnerMessageService } from '$lib/modules/agent-room/application/services/BotOwnerMessageService.js';
import { desktopSecretService } from '$lib/modules/agent-room/infrastructure/secrets/DesktopSecretService.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { botRequestContextService } from '$lib/modules/agent-room/application/services/BotRequestContextService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { agentRuntimeService } from '$lib/modules/agent-room/application/services/AgentRuntimeService.js';
import { botExternalDeliveryService } from '$lib/modules/agent-room/application/services/BotExternalDeliveryService.js';
import { botDeliveryRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotDeliveryRepository.js';
import { whatsappBotService } from '$lib/modules/agent-room/application/services/WhatsAppBotService.js';
import { usageService } from '$lib/modules/agent-room/application/services/UsageService.js';
import { AgentRoutine } from '$lib/modules/agent-room/domain/models/AgentRoutine.js';
import { AgentRoutineRun } from '$lib/modules/agent-room/domain/models/AgentRoutineRun.js';
import { AgentMessageEnvelope } from '$lib/modules/agent-room/domain/models/AgentMessageEnvelope.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import type { Routine } from '$lib/modules/agent-room/domain/types.js';

const roots: string[] = [], secrets = new Map<string, string>();
const own = '5511999999999@s.whatsapp.net', chat = '55119999999-12345@g.us';
const definition = { name: 'Hourly rate', prompt: 'Get the current USD/BRL rate, include its source and timestamp, and answer directly.', trigger: 'interval', intervalMinutes: 60, delivery: 'current_chat' };
describe('native owner bot routines without Computer grants', () => {
  useSvelarTest({ refreshDatabase: true });
  beforeEach(() => {
    secrets.clear();
    vi.spyOn(desktopSecretService, 'get').mockImplementation(async key => secrets.get(key) ?? null);
    vi.spyOn(desktopSecretService, 'set').mockImplementation(async (key, value) => { secrets.set(key, value); });
    vi.spyOn(agentInboxService, 'kick').mockImplementation(() => {});
    vi.spyOn(botExternalDeliveryService, 'flush').mockResolvedValue(undefined);
    vi.spyOn(agentRuntimeService, 'assertAutomaticWorkAllowed').mockResolvedValue(undefined);
    vi.spyOn(usageService, 'getUsage').mockResolvedValue(null as never);
  });
  afterEach(async () => { agentInboxService.reset(); vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'bot-native-routine-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Native reminders', workingDir: root });
    const bot = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Jarvis', payload: { provider: 'codex', personalBot: true,
      agentTransport: 'structured', agentRuntimeMode: 'on_demand', botSafety: botSafetySchema.parse({ publicInstructions: 'Be Jarvis. Answer directly.' }) } as never });
    const connection = await botConnectionRepository.create(workspace.id, 'Linked phone');
    const binding = await channelBindingService.create(workspace.id, createChannelBindingSchema.parse({ nodeId: bot.id, integrationId: connection.id, externalChatId: chat, replyPrefixes: ['#jarvis'] }));
    const scope = botSafetyService.bindingScope(binding), key = { id: uuidv7(), fromMe: true, remoteJid: chat };
    const ownerProof = await botOwnerMessageService.issue(binding, scope, key, own);
    const source = await channelService.postExternal(workspace.id, bot.id, { body: '#jarvis send the current rate here hourly', via: 'whatsapp', bindingId: binding.id,
      expectedBindingScope: scope, sender: 'Owner', senderId: own, externalId: `${chat}:${key.id}`, ownerProof: ownerProof! });
    const envelope = { metadata: {} as Record<string, unknown> };
    vi.spyOn(botRequestContextService, 'current').mockImplementation(async (w, n, s) => w === workspace.id && n === bot.id && (!s || s === source.id)
      ? { source, envelope, attachments: [], conversationKey: `binding:${binding.id}`, missingImage: false } as never : null);
    const service = new AgentRoutineService();
    const command = (input: unknown, idempotencyKey = 'hourly-rate-test') => service.execute(workspace.id, bot.id, bridgeAutomationCommandSchema.parse({ from: bot.id, sourceMessageId: source.id, idempotencyKey, input }));
    const create = () => command({ command: 'save', definition }) as Promise<Routine>;
    const send = vi.fn(async (_chat: string, _message: unknown, options: { messageId: string }) => ({ key: { id: options.messageId } }));
    vi.spyOn(whatsappBotService as any, 'open').mockResolvedValue({ state: 'connected', stopped: false, socket: { sendMessage: send } });
    return { workspace, bot, binding, source, envelope, command, create, send };
  }
  function answerOccurrences() {
    const enqueue = agentInboxService.enqueue.bind(agentInboxService);
    return vi.spyOn(agentInboxService, 'enqueue').mockImplementation(async input => {
      const result = await enqueue(input);
      if (input.metadata?.botRoutineRunId) await agentInboxService.routeReply(input.messageId!, 'TEST_RATE_RESULT with timestamp and source', { source: 'provider', responderNodeId: input.toNodeId });
      return result;
    });
  }
  it('persists one exact-chat hourly routine without a setup card, including concurrent retries', async () => {
    const f = await fixture(), results = await Promise.all([f.create(), f.create(), f.create()]);
    expect(new Set(results.map(r => r.id)).size).toBe(1); expect(await AgentRoutine.query().count()).toBe(1);
    expect(results[0]).toMatchObject({ authorAgentId: f.bot.id, authorTaskId: null, intervalMinutes: 60, actionConfig: { botOrigin: { sourceMessageId: f.source.id, bindingId: f.binding.id, send: true } } });
    expect(await f.command({ command: 'list' })).toHaveLength(1);
  });
  it('resolves the real received native source without the model guessing an ID', async () => {
    const f = await fixture(); vi.mocked(botRequestContextService.current).mockRestore();
    const envelopes = await controlCenterRepository.inboxEnvelopes(f.bot.id, ['queued']);
    const envelope = envelopes.find(item => item.metadata.channelMessageId === f.source.id)!;
    expect(envelope).toBeTruthy();
    const batchId = uuidv7();
    await AgentMessageEnvelope.query().where('id', envelope.id).update({ state: 'sent', metadata_json: JSON.stringify({ ...envelope.metadata, batchId, batchPrompt: 'Delivered owner request', batchSize: 1 }) });
    vi.spyOn(ptySessionManager, 'structuredRequest').mockReturnValue({ conversationKey: `binding:${f.binding.id}`, messageId: batchId });
    const routine = await new AgentRoutineService().execute(f.workspace.id, f.bot.id, bridgeAutomationCommandSchema.parse({
      from: f.bot.id, idempotencyKey: 'real-context-test', input: { command: 'save', definition },
    })) as Routine;
    expect(routine.actionConfig.botOrigin).toMatchObject({ sourceMessageId: f.source.id, bindingId: f.binding.id });
    expect(routine.authorTaskId).toBeNull();
  });
  it('uses the native outbox once and reuses persisted reply/output after worker recovery', async () => {
    const f = await fixture(), routine = await f.create(), generations = answerOccurrences();
    vi.mocked(botExternalDeliveryService.flush).mockRestore();
    const result = await routineService.runNow(routine.id);
    expect(result.ok).toBe(true); expect(result.run.output.deliveryState).toBe('accepted'); expect(f.send).toHaveBeenCalledOnce();
    const nativeCalls = () => generations.mock.calls.filter(([input]) => input.metadata?.botRoutineRunId);
    expect(nativeCalls()).toHaveLength(1);
    expect(f.send.mock.calls[0][0]).toBe(chat);
    await AgentRoutineRun.query().where('id', result.run.id).update({ status: 'queued' });
    await botRoutineService.dispatch(routine, result.run.id, new AbortController().signal);
    expect(nativeCalls()).toHaveLength(1); expect(f.send).toHaveBeenCalledOnce();
    expect(await botDeliveryRepository.find(result.run.id)).toMatchObject({ state: 'accepted' });
  });
  it('does not wake a bot after phone control is revoked', async () => {
    const f = await fixture(), routine = await f.create(), generations = answerOccurrences();
    await workspaceRepository.updateNode(f.bot.id, { payload: { ...f.bot.payload, botSafety: botSafetySchema.parse({ ownerMessages: false, publicInstructions: 'Support' }) } as never });
    expect((await routineService.runNow(routine.id)).ok).toBe(false);
    expect(generations).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('cancels a queued outbound result when the routine is paused before native sending', async () => {
    const f = await fixture(), routine = await f.create(); answerOccurrences();
    const post = channelService.postStructuredResult.bind(channelService);
    vi.spyOn(channelService, 'postStructuredResult').mockImplementation(async (...args) => {
      const result = await post(...args); await routineService.setEnabled(routine.id, false, routine.revision); return result;
    });
    const result = await routineService.runNow(routine.id);
    expect(result.ok).toBe(false); vi.mocked(botExternalDeliveryService.flush).mockRestore(); await botExternalDeliveryService.flush();
    expect(f.send).not.toHaveBeenCalled(); expect(await botDeliveryRepository.find(result.run.id)).toMatchObject({ state: 'cancelled' });
  });
  it('rechecks a pause that happens while outbound approval is waiting', async () => {
    const f = await fixture(), routine = await f.create(); answerOccurrences();
    const approved = botSafetyService.approved.bind(botSafetyService);
    vi.spyOn(botSafetyService, 'approved').mockImplementation(async (...args) => {
      const result = await approved(...args); await routineService.setEnabled(routine.id, false, routine.revision); return result;
    });
    vi.mocked(botExternalDeliveryService.flush).mockRestore();
    expect((await routineService.runNow(routine.id)).ok).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
  });
  it('preserves the exact native destination when the owner edits its interval in Automations', async () => {
    const f = await fixture(), routine = await f.create();
    const updated = await routineService.updateAutomation(routine.id, automationFormSchema.parse({ name: routine.name, triggerType: 'schedule', intervalMinutes: 120,
      actionType: 'prompt_agent', targetNodeId: f.bot.id, prompt: routine.prompt, enabled: true }), routine.revision);
    expect(updated?.actionConfig.botOrigin).toEqual(routine.actionConfig.botOrigin);
    expect(updated?.intervalMinutes).toBe(120);
  });
  it('requires a received owner source and does not permit automatic recursive schedule creation', async () => {
    const f = await fixture();
    f.envelope.metadata.botRoutineRunId = uuidv7();
    await expect(f.create()).rejects.toThrow('RECURSIVE');
    delete f.envelope.metadata.botRoutineRunId;
    vi.mocked(botRequestContextService.current).mockResolvedValue(null);
    await expect(f.create()).rejects.toThrow('OWNER_REQUIRED');
    expect(await AgentRoutine.query().count()).toBe(0);
  });
  it('refuses forged owner proofs', async () => {
    const f = await fixture();
    await channelRepository.mergeMeta(f.workspace.id, f.source.id, { ownerProof: 'A'.repeat(43) });
    await expect(f.create()).rejects.toThrow('REVOKED');
    expect(await AgentRoutine.query().count()).toBe(0);
  });
  it('does not deliver an older occurrence after the routine is edited and re-enabled', async () => {
    const f = await fixture(), routine = await f.create(); answerOccurrences();
    vi.mocked(botExternalDeliveryService.flush).mockRestore();
    const result = await routineService.runNow(routine.id);
    expect(result.ok).toBe(true);
    await AgentRoutineRun.query().where('id', result.run.id).update({ status: 'queued' });
    const edited = await routineService.setEnabled(routine.id, false, routine.revision);
    const resumed = await routineService.setEnabled(routine.id, true, edited!.revision);
    await expect(botRoutineService.dispatch(resumed!, result.run.id, new AbortController().signal)).rejects.toThrow('REVOKED');
    expect(await botRoutineService.relevant(f.workspace.id, f.bot.id, routine.id, result.run.id, routine.revision)).toBe(false);
    expect(f.send).toHaveBeenCalledOnce();
  });
  it('pauses future occurrences through the same source-scoped native command', async () => {
    const f = await fixture(), routine = await f.create();
    expect(await f.command({ command: 'cancel', id: routine.id, revision: routine.revision })).toMatchObject({ enabled: false });
    expect((await routineService.runNow(routine.id)).ok).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
  });
});
