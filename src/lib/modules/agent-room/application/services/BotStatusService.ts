import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import { botFailureKind, botFailureText } from '../../domain/bot-failure.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { channelBindingRepository } from '../../infrastructure/repositories/ChannelBindingRepository.js';
import { botDeliveryRepository } from '../../infrastructure/repositories/BotDeliveryRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { botSafetyService } from './BotSafetyService.js';
import type { TerminalNodePayload } from '../../domain/types.js';
/** Fixed operational notices; not a tool for publishing arbitrary model output. */
export class BotStatusService {
  async failed(workspaceId: string, sourceId: string, diagnostic?: string) {
    const kind = botFailureKind(diagnostic);
    const saved = await Connection.transaction(async () => {
      const source = await channelRepository.find(workspaceId, sourceId);
      if (!source || source.hiddenAt || source.authorKind !== 'external' || !source.channel.startsWith('dm:') || typeof source.meta.bindingId !== 'string') return null;
      if (typeof source.meta.failureNoticeId === 'string') return channelRepository.find(workspaceId, source.meta.failureNoticeId);
      const nodeId = source.channel.slice(3);
      const [binding, node, workspace] = await Promise.all([channelBindingRepository.find(workspaceId, source.meta.bindingId), workspaceRepository.getNode(nodeId), workspaceRepository.getWorkspace(workspaceId)]);
      if (!workspace || workspace.suspendedAt || !binding?.enabled || binding.nodeId !== nodeId || botSafetyService.bindingScope(binding) !== source.meta.bindingScope
        || node?.workspaceId !== workspaceId || !(node.payload as TerminalNodePayload).personalBot) return null;
      const message = await channelRepository.save({ workspaceId, channel: source.channel, authorKind: 'agent', authorNodeId: nodeId, replyToId: sourceId,
        body: botFailureText(kind), meta: { bindingId: binding.id, operationalFailure: { kind, sourceId, bindingScope: source.meta.bindingScope } } }, uuidv7());
      await channelRepository.mergeMeta(workspaceId, sourceId, { failureNoticeId: message.id, modelFailureKind: kind });
      await botDeliveryRepository.create(workspaceId, nodeId, binding.id, message.id);
      return message;
    });
    if (saved) {
      (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'channelMessage', workspaceId, channel: saved.channel, message: saved });
      const { botExternalDeliveryService } = await import('./BotExternalDeliveryService.js');
      void botExternalDeliveryService.flush().catch(() => undefined);
    }
  }
}
export const botStatusService = new BotStatusService();
