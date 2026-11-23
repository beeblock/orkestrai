import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { desktopSecretService } from '../../infrastructure/secrets/DesktopSecretService.js';
import { botConnectionRepository } from '../../infrastructure/repositories/BotConnectionRepository.js';
import { validWhatsAppJid, whatsAppInboundSender } from '../../domain/whatsapp-messages.js';
import type { ChannelBinding, ChannelMessage } from '../../domain/channels.js';
import { persistedWhatsAppOrigin } from '../../contracts/schemas/whatsapp-message.schema.js';

/** Server-only authentication of commands sent by the linked WhatsApp account.
 * No HTTP/CLI/MCP operation issues proofs. Text, display names and caller flags
 * cannot grant owner authority. Proofs bind the exact sender, chat and route.
 */
export class BotOwnerMessageService {
  private creating = new Map<string, Promise<string>>();
  private key(workspaceId: string, connectionId: string) { return `automation:whatsapp:owner-proof:${workspaceId}:${connectionId}`; }
  private async secret(workspaceId: string, connectionId: string, create: boolean): Promise<string | null> {
    const key = this.key(workspaceId, connectionId);
    if (!create) {
      const previous = await desktopSecretService.get(key);
      if (previous && !/^[A-Za-z0-9_-]{43}$/.test(previous)) throw new Error('BOT_OWNER_AUTH_INVALID');
      return previous;
    }
    // Hold the lock across the initial read as well: a delayed empty read must
    // not replace the key another chat has just initialized.
    const pending = this.creating.get(key);
    if (pending) return pending;
    const run = (async () => {
      const previous = await this.secret(workspaceId, connectionId, false);
      if (previous) return previous;
      const value = randomBytes(32).toString('base64url');
      await desktopSecretService.set(key, value);
      if (await desktopSecretService.get(key) !== value) throw new Error('BOT_OWNER_AUTH_UNAVAILABLE');
      return value;
    })();
    this.creating.set(key, run);
    try { return await run; } finally { if (this.creating.get(key) === run) this.creating.delete(key); }
  }

  private signature(secret: string, binding: ChannelBinding, scope: string, externalId: string, senderId: string) {
    return createHmac('sha256', secret).update(JSON.stringify([binding.workspaceId, binding.id, binding.nodeId, binding.integrationId,
      binding.externalChatId, scope, externalId, senderId])).digest('base64url');
  }
  async issue(binding: ChannelBinding, scope: string, key: { id?: string | null; fromMe?: boolean | null; participant?: string | null; remoteJid?: string | null }, ownJid?: string | null): Promise<string | null> {
    if (binding.kind !== 'whatsapp' || !key.fromMe || key.remoteJid !== binding.externalChatId) return null;
    const sender = whatsAppInboundSender(key, ownJid);
    if (!sender || !validWhatsAppJid(sender)) return null;
    const secret = await this.secret(binding.workspaceId, binding.integrationId, true);
    return this.signature(secret!, binding, scope, `${key.remoteJid}:${key.id}`, sender);
  }
  async verify(source: ChannelMessage, binding: ChannelBinding, scope: string): Promise<boolean> {
    const proof = source.meta.ownerProof;
    if (source.authorKind !== 'external' || source.meta.via !== 'whatsapp' || binding.kind !== 'whatsapp' || !binding.enabled
      || source.workspaceId !== binding.workspaceId || source.meta.bindingId !== binding.id || source.meta.bindingScope !== scope
      || source.channel !== `dm:${binding.nodeId}` || typeof source.meta.externalId !== 'string' || typeof source.meta.senderId !== 'string'
      || typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return false;
    const connection = await botConnectionRepository.find(binding.workspaceId, binding.integrationId);
    if (!connection?.enabled) return false;
    const secret = await this.secret(binding.workspaceId, binding.integrationId, false);
    if (!secret) return false;
    const origin = persistedWhatsAppOrigin(source.meta, binding.externalChatId);
    if (source.meta.whatsappOrigin && !origin) return false;
    const externalId = origin ? `${origin.chatId}:${origin.id}` : source.meta.externalId;
    return timingSafeEqual(Buffer.from(proof), Buffer.from(this.signature(secret, binding, scope, externalId, source.meta.senderId)));
  }
  async revoke(workspaceId: string, connectionId: string) {
    await this.creating.get(this.key(workspaceId, connectionId))?.catch(() => undefined);
    await desktopSecretService.delete(this.key(workspaceId, connectionId));
  }
}
export const botOwnerMessageService = new BotOwnerMessageService();
