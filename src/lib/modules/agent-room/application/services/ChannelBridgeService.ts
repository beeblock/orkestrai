import { senderAllowed, channelPrefixAllowed, type ChannelBinding } from '../../domain/channels.js';
import { channelBindingRepository } from '../../infrastructure/repositories/ChannelBindingRepository.js';
import { integrationExecutionService, type InboundChannelMessage } from './IntegrationExecutionService.js';
import { channelService } from './ChannelService.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { directChannel } from '../../domain/channels.js';
import { workspaceAttachmentService } from './WorkspaceAttachmentService.js';
import { WorkspaceAttachmentDto, WorkspaceAttachmentDeleteDto } from '../dto/WorkspaceAttachmentDto.js';
import { uuidv7 } from '@beeblock/svelar/support';
import type { WorkspaceAttachment } from '../../domain/types.js';

const SLACK_INTERVAL_MS = 15_000;
const RETRY_DELAY_MS = 60_000;

type Loop = { stop: () => void };

/**
 * Connects agents to external chats. One loop per Telegram integration (its
 * updates are acknowledged per bot token) and one per Slack binding. Inbound
 * messages from allowed senders land in the agent's direct conversation and
 * inbox; an agent's post that replies to one of them goes back to that chat
 * only, through the integration, under the workspace autonomy policy.
 */
export class ChannelBridgeService {
  private loops = new Map<string, Loop>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private observedChats = new Map<string, Map<string, string>>();
  private discoveryReads = new Map<string, Promise<void>>();

  private observe(workspaceId: string, integrationId: string, messages: InboundChannelMessage[]) {
    const key = `${workspaceId}:${integrationId}`;
    const chats = this.observedChats.get(key) ?? new Map<string, string>();
    for (const message of messages.slice(0, 200)) {
      if (chats.size >= 1000 && !chats.has(message.chatId)) continue;
      chats.set(message.chatId, (message.chatName || (message.chatId === message.senderId ? message.senderName : '') || message.chatId).slice(0, 120));
    }
    this.observedChats.set(key, chats);
    if (this.observedChats.size > 50) this.observedChats.delete(this.observedChats.keys().next().value!);
  }

  async discoverTargets(workspaceId: string, integrationId: string, actorNodeId: string | null) {
    const integration = await integrationExecutionService.get(workspaceId, integrationId);
    if (!integration.enabled || integration.status !== 'connected') throw new Error('BOT_CONNECTION_UNAVAILABLE');
    if (integration.type === 'slack') {
      const result = await integrationExecutionService.execute(workspaceId, { integrationId, action: 'slack.list_channels', input: { limit: 200 }, idempotencyKey: uuidv7() }, { actorType: actorNodeId ? 'agent' : 'user', actorId: actorNodeId });
      const channels = Array.isArray(result.channels) ? result.channels : [];
      return channels.slice(0, 200).flatMap((value: unknown) => {
        const item = value as Record<string, unknown> | null;
        return item && typeof item.id === 'string' && /^[A-Z0-9]{1,80}$/.test(item.id)
          ? [{ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 120) : item.id }] : [];
      });
    }
    if (integration.type !== 'telegram' || !integration.permissions.includes('telegram.read_updates')) throw new Error('BOT_CONNECTION_UNAVAILABLE');
    const bindings = (await channelBindingRepository.list(workspaceId)).filter(item => item.integrationId === integrationId);
    // Never compete with a live getUpdates reader or acknowledge its cursor.
    if (!bindings.some(item => item.enabled)) {
      let read = this.discoveryReads.get(integrationId);
      if (!read) {
        read = integrationExecutionService.pollInbound(workspaceId, integrationId, { cursor: null, chatId: null, waitSeconds: 0 })
          .then(result => { this.observe(workspaceId, integrationId, result.messages); });
        this.discoveryReads.set(integrationId, read);
      }
      try { await read; } finally { if (this.discoveryReads.get(integrationId) === read) this.discoveryReads.delete(integrationId); }
    }
    const chats = new Map(this.observedChats.get(`${workspaceId}:${integrationId}`) ?? []);
    for (const binding of bindings) if (!chats.has(binding.externalChatId)) chats.set(binding.externalChatId, binding.externalChatId);
    return [...chats].map(([id, name]) => ({ id, name }));
  }

  start(): void {
    if (this.refreshTimer) return;
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), 60_000);
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    for (const loop of this.loops.values()) loop.stop();
    this.loops.clear();
    this.observedChats.clear();
  }

  /** Starts loops for new bindings and stops loops whose bindings are gone or disabled. */
  async refresh(): Promise<void> {
    // The new outbox has its own small indexed table; it never scans the
    // existing conversation history or delays legacy polling loops.
    void import('./BotExternalDeliveryService.js').then(({ botExternalDeliveryService }) => botExternalDeliveryService.flush()).catch(() => undefined);
    const bindings = await channelBindingRepository.listEnabled().catch(() => []);
    const wanted = new Map<string, Array<ChannelBinding & { cursor: string | null }>>();
    for (const binding of bindings) {
      if (binding.kind === 'whatsapp') continue;
      const key = binding.kind === 'telegram' ? `telegram:${binding.integrationId}` : `slack:${binding.id}`;
      (wanted.get(key) ?? wanted.set(key, []).get(key)!).push(binding);
    }
    for (const [key, loop] of this.loops) {
      if (!wanted.has(key)) {
        loop.stop();
        this.loops.delete(key);
      }
    }
    for (const [key, group] of wanted) {
      if (!this.loops.has(key)) this.loops.set(key, this.run(key, group[0]));
    }
    if (bindings.some(binding => binding.kind === 'whatsapp')) {
      const { whatsappBotService } = await import('./WhatsAppBotService.js');
      await whatsappBotService.restore();
    }
  }

  private run(key: string, first: ChannelBinding & { cursor: string | null }): Loop {
    let stopped = false;
    let cursor = first.cursor;
    const loop: Loop = { stop: () => { stopped = true; } };
    const tick = async (): Promise<void> => {
      while (!stopped) {
        const group = (await channelBindingRepository.listEnabled().catch(() => []))
          .filter((binding) => (first.kind === 'telegram' ? binding.integrationId === first.integrationId && binding.kind === 'telegram' : binding.id === first.id));
        if (!group.length) return;
        try {
          await this.discoveryReads.get(first.integrationId);
          if (stopped) return;
          const result = await integrationExecutionService.pollInbound(first.workspaceId, first.integrationId, {
            cursor,
            chatId: first.kind === 'slack' ? first.externalChatId : null,
            waitSeconds: 20,
          });
          // Turned off (or replaced by a newer loop) while this read waited: the
          // messages belong to whichever loop reads the chat from now on.
          if (stopped) return;
          this.observe(first.workspaceId, first.integrationId, result.messages);
          cursor = await this.consume(first, group, cursor, result, () => stopped);
          for (const binding of group) if (binding.lastError) await channelBindingRepository.update(binding.id, { lastError: null });
          if (first.kind === 'slack') await delay(SLACK_INTERVAL_MS, () => stopped);
        } catch (error) {
          const text = error instanceof Error ? error.message.slice(0, 300) : 'Channel polling failed.';
          for (const binding of group) await channelBindingRepository.update(binding.id, { lastError: text }).catch(() => undefined);
          await delay(RETRY_DELAY_MS, () => stopped);
        }
      }
    };
    // A newer loop for the same chat may already have taken this key.
    void tick().finally(() => { if (this.loops.get(key) === loop) this.loops.delete(key); });
    return loop;
  }

  /**
   * Hands a polled batch to the agents, then records how far the chat was
   * read. The cursor moves only once every message is stored: after a failure
   * the same messages are read again, and the ones already stored are not
   * stored twice. A loop stopped meanwhile hands over nothing more and leaves
   * the cursor where it was. Returns the cursor to poll from next.
   */
  private async consume(
    first: ChannelBinding,
    group: ChannelBinding[],
    cursor: string | null,
    result: { messages: InboundChannelMessage[]; cursor: string | null },
    stopped: () => boolean = () => false,
  ): Promise<string | null> {
    for (const message of result.messages) {
      if (stopped()) return cursor;
      await this.dispatch(group, message);
    }
    if (stopped() || result.cursor === cursor) return cursor;
    if (first.kind === 'telegram') await channelBindingRepository.updateIntegrationCursor(first.integrationId, result.cursor);
    else await channelBindingRepository.update(first.id, { cursor: result.cursor });
    return result.cursor;
  }

  private async dispatch(group: ChannelBinding[], message: InboundChannelMessage): Promise<void> {
    for (const binding of group) {
      if (binding.externalChatId !== message.chatId) continue;
      if (!senderAllowed(binding, message.senderId, message.senderHandle)) continue;
      if (!channelPrefixAllowed(binding, message.text)) continue;
      const previous = message.attachments?.length ? await channelRepository.findExternal(binding.workspaceId, directChannel(binding.nodeId), binding.id, message.externalId) : null;
      const attachments: WorkspaceAttachment[] = Array.isArray(previous?.meta.attachments) ? previous.meta.attachments as WorkspaceAttachment[] : [];
      const uploaded: WorkspaceAttachment[] = [];
      try {
        if (!previous) for (const media of message.attachments ?? []) {
          const bytes = await integrationExecutionService.downloadInbound(binding.workspaceId, binding.integrationId, media);
          const attachment = await workspaceAttachmentService.create(binding.workspaceId, WorkspaceAttachmentDto.fromFile(new File([new Uint8Array(bytes)], media.name, { type: media.mimeType })));
          attachments.push(attachment); uploaded.push(attachment);
        }
        await channelService.postExternal(binding.workspaceId, binding.nodeId, {
        expectedBindingScope: (await import('./BotSafetyService.js')).botSafetyService.bindingScope(binding),
        body: message.text,
        via: binding.kind,
        bindingId: binding.id,
        sender: message.senderName || message.senderId, senderId: message.senderId,
        externalId: message.externalId,
        ...(attachments.length ? { attachments } : {}),
        });
      } finally {
        // A committed message retains its files; only unclaimed uploads are removed.
        for (const attachment of uploaded) await workspaceAttachmentService.remove(binding.workspaceId, WorkspaceAttachmentDeleteDto.fromAttachment(attachment)).catch(() => undefined);
      }
      await channelBindingRepository.update(binding.id, { lastInboundAt: new Date().toISOString() });
    }
  }

  /**
   * Sends an agent's reply to the one external chat whose message it answers.
   * Never blocks the post; a binding that is gone or disabled gets nothing.
   */
  async mirrorReply(workspaceId: string, nodeId: string, messageId: string, body: string, bindingId: string): Promise<void> {
    const message = await channelRepository.find(workspaceId, messageId);
    if (!message?.replyToId || message.authorNodeId !== nodeId || message.meta.bindingId !== bindingId || message.body !== body) return;
    const { workspaceRepository } = await import('../../infrastructure/repositories/WorkspaceRepository.js');
    const node = await workspaceRepository.getNode(nodeId);
    const { botSafetyService } = await import('./BotSafetyService.js');
    if (node?.workspaceId === workspaceId && !(node.payload as { personalBot?: boolean }).personalBot) {
      const source = await channelRepository.find(workspaceId, message.replyToId);
      const binding = (await channelBindingRepository.list(workspaceId)).find(value => value.id === bindingId);
      if (!binding?.enabled || binding.nodeId !== nodeId || !['telegram', 'slack'].includes(binding.kind)
        || source?.authorKind !== 'external' || source.channel !== directChannel(nodeId) || source.meta.bindingId !== bindingId
        || source.meta.bindingScope !== botSafetyService.bindingScope(binding)) return;
      await integrationExecutionService.execute(workspaceId, { integrationId: binding.integrationId, action: `${binding.kind}.send_message`,
        input: binding.kind === 'telegram' ? { chatId: binding.externalChatId, text: body } : { channel: binding.externalChatId, text: body },
        idempotencyKey: `agent-reply:${messageId}:${binding.id}` }, { actorType: 'agent', actorId: nodeId });
      return;
    }
    await botSafetyService.approved(workspaceId, nodeId, message.replyToId, body, messageId);
    const { botDeliveryRepository } = await import('../../infrastructure/repositories/BotDeliveryRepository.js');
    await botDeliveryRepository.create(workspaceId, nodeId, bindingId, messageId);
    const { botExternalDeliveryService } = await import('./BotExternalDeliveryService.js');
    await botExternalDeliveryService.flush();
  }
}

function delay(ms: number, stopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (stopped() || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 1_000);
  });
}

const globalRef = globalThis as unknown as { __orkestraiChannelBridge?: ChannelBridgeService };
export const channelBridgeService = (globalRef.__orkestraiChannelBridge ??= new ChannelBridgeService());
