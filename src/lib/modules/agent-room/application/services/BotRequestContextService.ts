import { createHash } from 'node:crypto';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { workspaceAttachmentSchema } from '../../contracts/schemas/workspaceAttachmentSchemas.js';
import { whatsAppQuoteSchema } from '../../contracts/schemas/whatsapp-message.schema.js';
import { filesystemService } from './FilesystemService.js';
import { botSafetyService } from './BotSafetyService.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { botResultRepository } from '../../infrastructure/repositories/BotResultRepository.js';
import type { TerminalNodePayload } from '../../domain/types.js';

/** Resolves only the current authenticated request, never an agent's old chat. */
export class BotRequestContextService {
  async current(workspaceId: string, nodeId: string, sourceMessageId?: string, taskId?: string) {
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
    if (sources.size !== 1) {
      // Recovery/peer briefs carry the assigned card, not another owner's chat.
      if (sources.size || !taskId || lead?.metadata.taskId !== taskId || lead.metadata.botRoutineRunId) return null;
      const recovered = await this.taskSource(workspaceId, nodeId, taskId);
      if (!recovered || sourceMessageId && recovered.id !== sourceMessageId) return null;
      sources.set(recovered.id, lead);
    }
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

  async creationSource(workspaceId: string, nodeId: string) {
    const node = await workspaceRepository.getNode(nodeId);
    if (node?.workspaceId !== workspaceId || !(node.payload as TerminalNodePayload).personalBot) return null;
    return (await this.current(workspaceId, nodeId))?.source.id ?? null;
  }

  private async authorizedSource(workspaceId: string, nodeId: string, sourceId: string) {
    const source = await channelRepository.find(workspaceId, sourceId);
    if (!source || source.channel !== `dm:${nodeId}`) return null;
    if (source.authorKind === 'owner') return source;
    return source.authorKind === 'external' && typeof source.meta.bindingId === 'string'
      && await botSafetyService.ownerSource(workspaceId, nodeId, source.meta.bindingId, source.id) ? source : null;
  }

  /** A resumed card retains its verified source, never the latest unrelated chat. */
  private async taskSource(workspaceId: string, nodeId: string, taskId: string) {
    const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).first();
    if (!task || task.getAttribute('created_by') !== nodeId || task.getAttribute('assignee_node_id') !== nodeId
      || task.getAttribute('archived_at') || task.getAttribute('status') === 'done') return null;
    const stored = task.getAttribute('bot_source_message_id');
    if (typeof stored === 'string') return this.authorizedSource(workspaceId, nodeId, stored);
    // Old cards can be recovered only inside a single exact native receipt
    // window that contains their creation. No nearest-message/time guessing.
    const createdAt = new Date(task.getAttribute('created_at')).toISOString(), at = Date.parse(createdAt);
    const possible = new Set<string>();
    for (const receipt of await botResultRepository.completedAfter(workspaceId, nodeId, createdAt)) {
      if (!Number.isFinite(receipt.completedAt) || receipt.completedAt < at) continue;
      for (const envelope of await controlCenterRepository.findEnvelopes(receipt.messageIds)) {
        if (envelope.workspaceId !== workspaceId || envelope.toNodeId !== nodeId || envelope.kind !== 'owner'
          || envelope.metadata.confirmation !== 'provider' || envelope.metadata.batchId !== receipt.id
          || Number(envelope.metadata.batchSize ?? 1) !== 1 || typeof envelope.metadata.batchSince !== 'number'
          || envelope.metadata.batchSince > at || typeof envelope.metadata.channelMessageId !== 'string') continue;
        possible.add(envelope.metadata.channelMessageId);
      }
    }
    if (possible.size !== 1) return null;
    const source = await this.authorizedSource(workspaceId, nodeId, [...possible][0]);
    if (!source) return null;
    await AgentBoardTask.query().where('id', taskId).whereNull('bot_source_message_id').update({ bot_source_message_id: source.id });
    const latest = await AgentBoardTask.find(taskId);
    return latest?.getAttribute('bot_source_message_id') === source.id ? source : null;
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
