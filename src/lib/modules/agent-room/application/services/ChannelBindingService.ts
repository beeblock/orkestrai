import type { ChannelBinding } from '../../domain/channels.js';
import type { CreateChannelBindingInput } from '../../contracts/schemas/channel.schema.js';
import { channelBindingRepository } from '../../infrastructure/repositories/ChannelBindingRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { channelBridgeService } from './ChannelBridgeService.js';
import { integrationExecutionService } from './IntegrationExecutionService.js';

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
    });
    await channelBridgeService.refresh();
    return binding;
  }

  async setEnabled(workspaceId: string, id: string, enabled: boolean): Promise<ChannelBinding> {
    const binding = await channelBindingRepository.find(workspaceId, id);
    if (!binding) throw new Error('Conexão não encontrada.');
    await channelBindingRepository.update(id, { enabled, lastError: null });
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
