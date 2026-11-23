import { createHash } from 'node:crypto';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { workspaceAttachmentSchema } from '../../contracts/schemas/workspaceAttachmentSchemas.js';
import { whatsAppQuoteSchema } from '../../contracts/schemas/whatsapp-message.schema.js';
import { filesystemService } from './FilesystemService.js';
import { botSafetyService } from './BotSafetyService.js';

/** Resolves only the current authenticated request, never an agent's old chat. */
export class BotRequestContextService {
  async current(workspaceId: string, nodeId: string, sourceMessageId?: string) {
    const active = ptySessionManager.structuredRequest(workspaceId, nodeId);
    const lead = active ? await controlCenterRepository.batchLead(active.messageId) : null;
    if (Number(lead?.metadata.batchSize ?? 1) > 1 && !sourceMessageId) throw new Error('BOT_REQUEST_SOURCE_AMBIGUOUS: pass sourceMessageId from the exact request in this batch.');
    const candidates = sourceMessageId ? await controlCenterRepository.botSourceEnvelopes(workspaceId, nodeId, sourceMessageId, active?.messageId)
      : active ? (lead ? [lead] : []) : [];
    const sources = new Map<string, typeof candidates[number]>();
    for (const envelope of candidates) {
      if (envelope.workspaceId !== workspaceId || envelope.toNodeId !== nodeId) continue;
      const id = envelope.metadata.channelMessageId ?? envelope.metadata.returnChannelMessageId ?? envelope.metadata.botWorkflowSourceId;
      if (typeof id === 'string' && (!sourceMessageId || id === sourceMessageId)) sources.set(id, envelope);
    }
    // An ambiguous terminal batch needs explicit agent instructions; do not
    // silently choose another person's attachment as a visual reference.
    if (sources.size !== 1) return null;
    const [id, envelope] = [...sources][0];
    const source = await channelRepository.find(workspaceId, id);
    if (!source || !source.channel.startsWith('dm:')) return null;
    const sourceNodeId = source.channel.slice(3);
    if (envelope.metadata.channelMessageId && sourceNodeId !== nodeId) return null;
    if (source.authorKind === 'external') {
      const bindingId = source.meta.bindingId;
      if (typeof bindingId !== 'string' || !await botSafetyService.ownerSource(workspaceId, sourceNodeId, bindingId, source.id)) return null;
    } else if (source.authorKind !== 'owner') return null;
    const attachments = (Array.isArray(source.meta.attachments) ? source.meta.attachments : []).slice(0, 12)
      .flatMap(item => { const parsed = workspaceAttachmentSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
    const quote = whatsAppQuoteSchema.safeParse(source.meta.quote);
    return { source, envelope, attachments, conversationKey: active?.conversationKey ?? String(envelope.metadata.returnConversationKey ?? `request:${source.id}`),
      missingImage: quote.success && quote.data.unavailable };
  }

  async imageReferences(workspaceId: string, nodeId: string, sourceMessageId?: string) {
    const context = await this.current(workspaceId, nodeId, sourceMessageId);
    if (sourceMessageId && !context) throw new Error('image_workflow_reference_unavailable');
    if (!context) return null;
    if (context.missingImage) throw new Error('image_workflow_reference_unavailable');
    const images = context.attachments.filter(file => file.kind === 'file' && /^image\/(png|jpeg|webp)$/.test(file.mimeType ?? ''));
    if (images.length > 5) throw new Error('image_workflow_too_many_references');
    const references = [];
    // Check every file before creating or connecting any Canvas node.
    for (const image of images) {
      const file = await filesystemService.readBinary(workspaceId, image.path!);
      if (file.data.length !== image.size) throw new Error('image_workflow_reference_unavailable');
      references.push({ path: image.path!, title: image.name, sha256: createHash('sha256').update(file.data).digest('hex') });
    }
    return { sourceMessageId: context.source.id, references };
  }
}
export const botRequestContextService = new BotRequestContextService();
