import { botDeliveryRepository, type BotDelivery } from '../../infrastructure/repositories/BotDeliveryRepository.js';
import { channelBindingRepository } from '../../infrastructure/repositories/ChannelBindingRepository.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { channelTextChunks, botArtifactSchema, type BotArtifact } from '../../domain/bot-artifacts.js';
import { integrationExecutionService } from './IntegrationExecutionService.js';

/** Durable, exact-address external output. A retry reuses every provider idempotency key. */
export class BotExternalDeliveryService {
  private active = new Set<string>();
  private flushing = false;
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let afterId: string | undefined;
      while (true) {
        const pending = await botDeliveryRepository.pending(50, afterId);
        if (!pending.length) break;
        const pool = pending.slice();
        await Promise.all(Array.from({ length: Math.min(4, pool.length) }, async () => {
          while (pool.length) await this.deliver(pool.shift()!).catch(() => undefined);
        }));
        afterId = pending[pending.length - 1].id;
        if (pending.length < 50) break;
      }
    } finally { this.flushing = false; }
  }
  private async deliver(candidate: BotDelivery) {
    if (this.active.has(candidate.id)) return;
    this.active.add(candidate.id);
    let delivery: BotDelivery | null = null;
    let dispatchStarted = false;
    try {
      delivery = await botDeliveryRepository.claim(candidate);
      if (!delivery) return;
      const binding = await channelBindingRepository.find(delivery.workspaceId, delivery.bindingId);
      const message = await channelRepository.find(delivery.workspaceId, delivery.id);
      if (!message || !binding?.enabled || binding.nodeId !== delivery.nodeId || message.authorNodeId !== delivery.nodeId || message.meta.bindingId !== binding.id) {
        await botDeliveryRepository.settle(delivery, 'cancelled'); return;
      }
      let approvedArtifacts: BotArtifact[] = [];
      try {
        if (!message.replyToId) throw new Error('BOT_PUBLIC_REPLY_UNAPPROVED');
        const { botSafetyService } = await import('./BotSafetyService.js');
        const approval = await botSafetyService.approved(delivery.workspaceId, delivery.nodeId, message.replyToId, message.body, message.id);
        approvedArtifacts = Array.isArray(approval.artifacts) ? approval.artifacts as BotArtifact[] : [];
      } catch (error) {
        // A temporary SQLite/read failure is not a security rejection and must
        // not discard an already reviewed customer reply.
        if (!(error instanceof Error) || !/^BOT_PUBLIC_(?:REPLY_UNAPPROVED|GRANT_REVOKED)$/.test(error.message)) throw error;
        await botDeliveryRepository.settle(delivery, 'cancelled');
        await channelBindingRepository.update(binding.id, { lastError: 'BOT_PUBLIC_REPLY_UNAPPROVED' });
        return;
      }
      if (binding.kind === 'whatsapp' && candidate.state === 'sending') {
        await botDeliveryRepository.settle(delivery, 'uncertain');
        await channelBindingRepository.update(binding.id, { lastError: 'BOT_DELIVERY_UNCERTAIN' });
        return;
      }
      const artifacts: BotArtifact[] = [];
      for (const raw of Array.isArray(message.meta.artifacts) ? message.meta.artifacts.slice(0, 6) : []) {
        const parsed = botArtifactSchema.safeParse(raw);
        if (!parsed.success || !parsed.data.sha256) throw new Error('BOT_ARTIFACT_INVALID');
        if (!approvedArtifacts.some(file => file.path === parsed.data.path && file.sha256 === parsed.data.sha256)) {
          await botDeliveryRepository.settle(delivery, 'cancelled');
          await channelBindingRepository.update(binding.id, { lastError: 'BOT_PUBLIC_ARTIFACT_DENIED' });
          return;
        }
        artifacts.push(parsed.data);
      }
      if (binding.kind === 'whatsapp') {
        const { whatsappBotService } = await import('./WhatsAppBotService.js');
        dispatchStarted = true;
        await whatsappBotService.send(delivery.workspaceId, delivery.nodeId, binding.id, message.body, delivery.id, artifacts);
      } else {
        let index = 0;
        for (const part of channelTextChunks(message.body)) {
          await integrationExecutionService.execute(delivery.workspaceId, {
            integrationId: binding.integrationId, action: `${binding.kind}.send_message`,
            input: binding.kind === 'telegram' ? { chatId: binding.externalChatId, text: part } : { channel: binding.externalChatId, text: part },
            idempotencyKey: `bot-reply:${delivery.id}:text:${index++}`,
          }, { actorType: 'agent', actorId: delivery.nodeId });
        }
        index = 0;
        for (const artifact of artifacts) {
          const action = binding.kind === 'telegram' ? artifact.image ? 'telegram.send_photo' : 'telegram.send_document' : 'slack.send_file';
          await integrationExecutionService.execute(delivery.workspaceId, { integrationId: binding.integrationId, action,
            input: { ...(binding.kind === 'telegram' ? { chatId: binding.externalChatId } : { channel: binding.externalChatId }), path: artifact.path, filename: artifact.name, sha256: artifact.sha256 },
            idempotencyKey: `bot-reply:${delivery.id}:file:${index++}`,
          }, { actorType: 'agent', actorId: delivery.nodeId });
        }
      }
      await botDeliveryRepository.settle(delivery, 'accepted');
      await channelBindingRepository.update(binding.id, { lastError: null });
    } catch (error) {
      if (delivery) {
        const message = error instanceof Error ? error.message : '';
        const binding = await channelBindingRepository.find(delivery.workspaceId, delivery.bindingId).catch(() => null);
        const beforeWhatsAppDispatch = ['WHATSAPP_NOT_CONNECTED', 'BOT_ARTIFACT_CHANGED', 'BOT_ARTIFACT_INVALID', 'BOT_CONNECTION_UNAVAILABLE'].includes(message);
        const uncertain = binding?.kind === 'whatsapp' && dispatchStarted && !beforeWhatsAppDispatch || /uncertain|in progress|another.*key/i.test(message);
        await botDeliveryRepository.settle(delivery, uncertain ? 'uncertain' : 'queued');
        await channelBindingRepository.update(delivery.bindingId, { lastError: uncertain ? 'BOT_DELIVERY_UNCERTAIN' : 'BOT_DELIVERY_PENDING' });
      }
    } finally {
      this.active.delete(candidate.id);
      if (delivery) (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void })
        .__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId: delivery.workspaceId });
    }
  }
}
export const botExternalDeliveryService = new BotExternalDeliveryService();
