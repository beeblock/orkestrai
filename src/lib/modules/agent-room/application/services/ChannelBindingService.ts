import type { ChannelBinding } from '../../domain/channels.js';
import type { CreateChannelBindingInput, UpdateChannelBindingInput } from '../../contracts/schemas/channel.schema.js';
import { channelBindingRepository } from '../../infrastructure/repositories/ChannelBindingRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { channelBridgeService } from './ChannelBridgeService.js';
import { integrationExecutionService } from './IntegrationExecutionService.js';
import { botConnectionRepository } from '../../infrastructure/repositories/BotConnectionRepository.js';
import { Connection } from '@beeblock/svelar/database';
import { validatedWhatsAppRouteSenders, whatsAppRoutesOverlap } from '../../domain/whatsapp-routing.js';

/** Owner-managed links between an agent and an external chat. */
export class ChannelBindingService {
  list(workspaceId: string, nodeId?: string): Promise<ChannelBinding[]> {
    return channelBindingRepository.list(workspaceId, nodeId);
  }

  async create(workspaceId: string, input: CreateChannelBindingInput): Promise<ChannelBinding> {
    const node = await workspaceRepository.getNode(input.nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal' || !(node.payload as { provider?: string }).provider) {
      throw new Error('Agente não encontrado neste workspace.');
    }
    const linked = await botConnectionRepository.find(workspaceId, input.integrationId);
    if (linked) {
      if (!linked.enabled || !(node.payload as { personalBot?: boolean }).personalBot || !/^\d{5,22}(?:-\d{1,22})?@(?:s\.whatsapp\.net|g\.us|lid)$/.test(input.externalChatId)) throw new Error('BOT_CONNECTION_UNAVAILABLE');
      const route = { ...input, allowedSenders: validatedWhatsAppRouteSenders(input.allowedSenders) };
      // Serialize validation and insertion, including simultaneous bot setup.
      // One linked device can serve several bots, but one incoming message
      // must not accidentally spend multiple model turns.
      return Connection.transaction(async () => {
        const currentConnection = await botConnectionRepository.find(workspaceId, linked.id);
        const currentNode = await workspaceRepository.getNode(input.nodeId);
        if (!currentConnection?.enabled || currentNode?.workspaceId !== workspaceId || currentNode.type !== 'terminal'
          || !(currentNode.payload as { personalBot?: boolean }).personalBot) throw new Error('BOT_CONNECTION_UNAVAILABLE');
        const existing = (await channelBindingRepository.list(workspaceId))
          .filter(binding => binding.kind === 'whatsapp' && binding.integrationId === linked.id && binding.externalChatId === input.externalChatId);
        if (existing.some(binding => binding.nodeId === input.nodeId)) throw new Error('BOT_CHAT_ALREADY_CONNECTED');
        if (existing.some(binding => binding.enabled && whatsAppRoutesOverlap(binding, route))) throw new Error('BOT_ROUTE_CONFLICT');
        return channelBindingRepository.create({ workspaceId, nodeId: input.nodeId, integrationId: linked.id,
          kind: 'whatsapp', externalChatId: input.externalChatId, allowedSenders: route.allowedSenders, replyPrefixes: input.replyPrefixes });
      });
    }
    const integration = await integrationExecutionService.get(workspaceId, input.integrationId);
    if (integration.type !== 'telegram' && integration.type !== 'slack') throw new Error('Use uma integração do Telegram ou do Slack.');
    const read = integration.type === 'telegram' ? 'telegram.read_updates' : 'slack.read_messages';
    const send = integration.type === 'telegram' ? 'telegram.send_message' : 'slack.send_message';
    if (!integration.permissions.includes(read) || !integration.permissions.includes(send)) {
      throw new Error('Permita ler e enviar mensagens nesta integração antes de conectar um agente.');
    }
    const existing = await channelBindingRepository.list(workspaceId, input.nodeId);
    if (existing.some((binding) => binding.integrationId === input.integrationId && binding.externalChatId === input.externalChatId)) {
      throw new Error('Este agente já está conectado a esse chat.');
    }
    const binding = await channelBindingRepository.create({
      workspaceId,
      nodeId: input.nodeId,
      integrationId: input.integrationId,
      kind: integration.type,
      externalChatId: input.externalChatId,
      allowedSenders: [...new Set(input.allowedSenders.map((sender) => sender.trim()).filter(Boolean))],
      replyPrefixes: input.replyPrefixes,
    });
    await channelBridgeService.refresh();
    return binding;
  }

  async setEnabled(workspaceId: string, id: string, enabled: boolean | undefined, rules: Pick<UpdateChannelBindingInput, 'allowedSenders' | 'replyPrefixes'> = {}): Promise<ChannelBinding> {
    await Connection.transaction(async () => {
      const binding = await channelBindingRepository.find(workspaceId, id);
      if (!binding) throw new Error('Conexão não encontrada.');
      const changes = {
        ...(rules.allowedSenders !== undefined ? { allowedSenders: binding.kind === 'whatsapp'
          ? validatedWhatsAppRouteSenders(rules.allowedSenders) : [...new Set(rules.allowedSenders.map(value => value.trim()))] } : {}),
        ...(rules.replyPrefixes !== undefined ? { replyPrefixes: rules.replyPrefixes } : {}),
      };
      const route = { ...binding, ...changes };
      const nextEnabled = enabled ?? binding.enabled;
      if (nextEnabled && binding.kind === 'whatsapp') {
        const existing = await channelBindingRepository.list(workspaceId);
        if (existing.some(other => other.id !== id && other.kind === 'whatsapp' && other.enabled
          && other.integrationId === binding.integrationId && other.externalChatId === binding.externalChatId
          && whatsAppRoutesOverlap(other, route))) throw new Error('BOT_ROUTE_CONFLICT');
      }
      await channelBindingRepository.update(id, { enabled: nextEnabled, ...changes, lastError: null });
    });
    await channelBridgeService.refresh();
    return (await channelBindingRepository.find(workspaceId, id))!;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const removed = await channelBindingRepository.delete(workspaceId, id);
    await channelBridgeService.refresh();
    return removed;
  }
}

export const channelBindingService = new ChannelBindingService();
