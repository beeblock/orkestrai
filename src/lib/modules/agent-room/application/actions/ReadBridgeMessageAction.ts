import { Action } from '@beeblock/svelar/actions';
import type { ReadBridgeMessageDTO } from '../dto/ReadBridgeMessageDTO.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { externalReplyCorrelation, verifiesExternalReply } from '../../infrastructure/ExternalReplyReceipt.js';
import { agentInboxService } from '../services/AgentInboxService.js';

type MessageResult = { messageId: string; deliveryState: string; replyConfirmed: boolean; reply: string; error: string | null };
export class ReadBridgeMessageAction extends Action<ReadBridgeMessageDTO, MessageResult> {
  async execute({ workspaceId, actorId, input, signal }: ReadBridgeMessageDTO): Promise<MessageResult> {
    const envelope = input.external
      ? await controlCenterRepository.findExternalAsk(workspaceId, externalReplyCorrelation(input.external))
      : await controlCenterRepository.findEnvelope(input.messageId!);
    if (!envelope || envelope.workspaceId !== workspaceId || (input.external
      ? envelope.fromNodeId !== null || !verifiesExternalReply(envelope.metadata, input.external)
      : !actorId || envelope.fromNodeId !== actorId)) throw new Error('Message not found for this caller.');
    if (envelope.state === 'queued') agentInboxService.kick(workspaceId, envelope.toNodeId);
    await agentInboxService.watchSavedReply(envelope.id);
    if (input.waitMs > 0) await agentInboxService.awaitReply(envelope.id, { timeoutMs: input.waitMs,
      busyGraceMs: input.waitMs, signal, cancelQueuedOnAbort: false });
    const current = await controlCenterRepository.findEnvelope(envelope.id);
    if (!current) throw new Error('Message not found for this caller.');
    return { messageId: current.id, deliveryState: current.state, replyConfirmed: current.state === 'replied',
      reply: current.state === 'replied' ? current.reply ?? '' : '', error: current.error };
  }
}
