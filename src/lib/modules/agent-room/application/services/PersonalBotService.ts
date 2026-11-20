import { Connection } from '@beeblock/svelar/database';
import type { PersonalBotCommandDto } from '../dto/PersonalBotCommandDto.js';
import { CreateCanvasNodeDto } from '../dto/WorkspaceDtos.js';
import type { PersonalBotSettings, PersonalBotSummary, BotGroupSettings } from '../../contracts/schemas/personal-bot.schema.js';
import { personalBotGroupRepository } from '../../infrastructure/repositories/PersonalBotGroupRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { getAgentAdapter, hasAgentAdapter } from '../adapters/registry.js';
import type { TerminalNodePayload } from '../../domain/types.js';
import { workspaceService } from './WorkspaceService.js';
import { agentInboxService } from './AgentInboxService.js';
import { channelBindingService } from './ChannelBindingService.js';
import { workspaceAttachmentService } from './WorkspaceAttachmentService.js';
import { mentionedTitles } from '../../domain/channels.js';
import { providerProfileService } from './ProviderProfileService.js';

function summary(node: { id: string; title: string | null; payload: unknown }): PersonalBotSummary {
  const payload = node.payload as TerminalNodePayload;
  return { id: node.id, title: node.title ?? 'Bot', provider: payload.provider ?? '', model: payload.model ?? null,
    effort: payload.effort ?? null, profileId: payload.profileId ?? null, instructions: payload.botInstructions ?? '',
    transport: payload.agentTransport ?? 'terminal', sessionId: payload.sessionId ?? null, runtimeMode: payload.agentRuntimeMode ?? 'interactive' };
}

export function botGroupChannel(id: string): string { return `botgroup:${id}`; }

export class PersonalBotService {
  async list(workspaceId: string) {
    const [nodes, groups] = await Promise.all([workspaceRepository.listTerminalNodes(workspaceId), personalBotGroupRepository.list(workspaceId)]);
    const bots = nodes.filter(node => node.type === 'terminal' && (node.payload as TerminalNodePayload).personalBot).map(summary);
    const botIds = new Set(bots.map(bot => bot.id));
    const { whatsappBotService } = await import('./WhatsAppBotService.js');
    const [connections, bindings] = await Promise.all([whatsappBotService.list(workspaceId), channelBindingService.list(workspaceId)]);
    return { bots, groups, connections, bindings: bindings.filter(binding => botIds.has(binding.nodeId)) };
  }

  private async requireBot(workspaceId: string, id: string) {
    const node = await workspaceRepository.getNode(id);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal' || !(node.payload as TerminalNodePayload).personalBot) throw new Error('PERSONAL_BOT_NOT_FOUND');
    return node;
  }

  private async groupMembers(workspaceId: string, settings: BotGroupSettings) {
    for (const id of settings.memberIds) await this.requireBot(workspaceId, id);
  }

  private async command(settings: PersonalBotSettings) {
    if (!hasAgentAdapter(settings.provider)) throw new Error('AGENT_PROVIDER_UNAVAILABLE');
    const adapter = getAgentAdapter(settings.provider);
    if (!adapter.createStructuredProcess || !adapter.interactiveCommand) throw new Error('AGENT_STRUCTURED_TRANSPORT_UNSUPPORTED');
    if (settings.effort && !adapter.efforts?.includes(settings.effort)) throw new Error('BOT_EFFORT_UNSUPPORTED');
    if (settings.profileId) {
      const profile = await providerProfileService.resolveByIdOrName(settings.provider, settings.profileId);
      if (profile?.id !== settings.profileId) throw new Error('BOT_PROFILE_NOT_FOUND');
    }
    const command = adapter.interactiveCommand({ model: settings.model ?? undefined, effort: settings.effort as never });
    return { ...command, initialRoleArgs: adapter.initialRoleArgs?.({ name: settings.title, prompt: settings.instructions, instructionFile: '' }) ?? [],
      personalBot: true, botInstructions: settings.instructions, agentTransport: settings.transport,
      provider: settings.provider, model: settings.model, effort: settings.effort, profileId: settings.profileId,
      agentRuntimeMode: 'on_demand', agentRuntimeIdleMinutes: 30, agentRuntimeConcurrency: 1, agentRuntimeUsageLimit: 95 };
  }

  async execute(dto: PersonalBotCommandDto): Promise<unknown> {
    const { workspaceId, input } = dto;
    const workspace = await workspaceService.get(workspaceId);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    if (workspace.suspendedAt) throw new Error('WORKSPACE_SUSPENDED');
    switch (input.command) {
      case 'create': {
        const payload = await this.command(input.settings);
        const node = await workspaceService.createNode(CreateCanvasNodeDto.from(workspaceId, { type: 'terminal', title: input.settings.title,
          payload: payload as never, width: 560, height: 360 }));
        return summary(node);
      }
      case 'update': {
        const node = await this.requireBot(workspaceId, input.nodeId);
        if (ptySessionManager.listLiveForNode(workspaceId, node.id).length) throw new Error('AGENT_TRANSPORT_REQUIRES_SLEEP');
        await ptySessionManager.waitForStructuredShutdown(workspaceId, node.id);
        const payload = await this.command(input.settings);
        const old = node.payload as TerminalNodePayload;
        if (old.provider !== input.settings.provider || (old.profileId ?? null) !== input.settings.profileId) {
          if (old.agentSessionId || Object.keys(old.structuredConversations ?? {}).length) throw new Error('BOT_ACCOUNT_CHANGE_USE_PROFILE_SWITCH');
        }
        const updated = await workspaceRepository.updateNode(node.id, { title: input.settings.title, payload: { ...old, ...payload } as never });
        this.changed(workspaceId);
        return summary(updated!);
      }
      case 'remove': {
        const node = await this.requireBot(workspaceId, input.nodeId);
        await workspaceService.deleteNode(workspaceId, node.id);
        return { removed: true };
      }
      case 'group_create':
        await this.groupMembers(workspaceId, input.settings);
        return personalBotGroupRepository.create(workspaceId, input.settings).then(group => { this.changed(workspaceId); return group; });
      case 'group_update':
        await this.groupMembers(workspaceId, input.settings);
        return personalBotGroupRepository.update(workspaceId, input.groupId, input.revision, input.settings).then(group => { this.changed(workspaceId); return group; });
      case 'group_archive':
        return personalBotGroupRepository.update(workspaceId, input.groupId, input.revision).then(group => { this.changed(workspaceId); return group; });
      case 'group_send': {
        const group = await personalBotGroupRepository.find(workspaceId, input.groupId);
        if (!group || group.archived) throw new Error('BOT_GROUP_NOT_FOUND');
        const members = await Promise.all(group.memberIds.map(id => this.requireBot(workspaceId, id)));
        await workspaceAttachmentService.assertPresent(workspace, input.attachments);
        const mentions = mentionedTitles(input.body, members.map(member => member.title ?? ''));
        const recipients = mentions.length ? members.filter(member => mentions.includes(member.title ?? '')) : members.filter(member => member.id === group.coordinatorId);
        const releases: Array<() => void> = [];
        const message = await workspaceAttachmentService.exclusive(workspaceId, () => Connection.transaction(async () => {
          const latest = await personalBotGroupRepository.find(workspaceId, group.id);
          if (!latest || latest.archived || latest.revision !== group.revision) throw new Error('BOT_GROUP_REVISION_CONFLICT');
          if (dto.actorNodeId && !group.memberIds.includes(dto.actorNodeId)) throw new Error('BOT_GROUP_MEMBERSHIP_REQUIRED');
          const saved = await channelRepository.save({ workspaceId, channel: botGroupChannel(group.id), authorKind: dto.actorNodeId ? 'agent' : 'owner', authorNodeId: dto.actorNodeId, body: input.body,
            meta: { botGroupId: group.id, attachments: input.attachments, deliverTo: recipients.map(member => member.id) } });
          for (const member of recipients) {
            const attached = workspaceAttachmentService.describeFor(workspace, member.payload as TerminalNodePayload, input.attachments);
            if (member.id === dto.actorNodeId) continue;
            const packet = await agentInboxService.enqueueDeferred({ workspaceId, toNodeId: member.id, kind: dto.actorNodeId ? 'bot_group' : 'owner', fromNodeId: dto.actorNodeId,
              content: `[Bot group: ${group.title}; id: ${group.id}] ${group.instructions}\nMembers: ${members.map(item => item.title).join(', ')}.\n${input.body}\n${attached.join('\n')}\n${(member.payload as TerminalNodePayload).agentTransport === 'structured' ? 'Your final answer returns to this group automatically.' : `Reply to this group with orkestrai bot group_post --input ${JSON.stringify({ groupId: group.id, body: '<your answer>' })} (MCP bot_command, command group_post). Do not post the group answer to the owner direct chat.`}`,
              dedupKey: `botgroup:${saved.id}:${member.id}`, metadata: { botGroupId: group.id, channel: saved.channel, channelMessageId: saved.id } });
            releases.push(packet.release);
          }
          return saved;
        }));
        for (const run of releases) run();
        this.changed(workspaceId);
        return message;
      }
      case 'group_post': {
        const group = await personalBotGroupRepository.find(workspaceId, input.groupId);
        if (!group || group.archived) throw new Error('BOT_GROUP_NOT_FOUND');
        if (!dto.actorNodeId || !group.memberIds.includes(dto.actorNodeId)) throw new Error('BOT_GROUP_MEMBERSHIP_REQUIRED');
        const message = await channelRepository.save({ workspaceId, channel: botGroupChannel(group.id), authorKind: 'agent', authorNodeId: dto.actorNodeId,
          body: input.body, meta: { botGroupId: group.id } });
        this.changed(workspaceId);
        return message;
      }
      case 'connect': {
        await this.requireBot(workspaceId, input.binding.nodeId);
        const binding = await channelBindingService.create(workspaceId, input.binding);
        this.changed(workspaceId);
        return binding;
      }
      case 'slack_manifest': return (await import('../../domain/bot-channel-setup.js')).slackBotManifest();
      case 'channel_targets': {
        await this.requireBot(workspaceId, input.nodeId);
        const { channelBridgeService } = await import('./ChannelBridgeService.js');
        return channelBridgeService.discoverTargets(workspaceId, input.integrationId, dto.actorNodeId);
      }
      case 'set_binding':
      case 'disconnect': {
        const binding = (await channelBindingService.list(workspaceId)).find(item => item.id === input.bindingId);
        if (!binding) throw new Error('BOT_BINDING_NOT_FOUND');
        await this.requireBot(workspaceId, binding.nodeId);
        const result = input.command === 'disconnect' ? { removed: await channelBindingService.remove(workspaceId, binding.id) }
          : await channelBindingService.setEnabled(workspaceId, binding.id, input.enabled);
        this.changed(workspaceId);
        return result;
      }
      case 'whatsapp_start': {
        const { whatsappBotService } = await import('./WhatsAppBotService.js');
        return whatsappBotService.create(workspaceId, input.name);
      }
      case 'whatsapp_disconnect': {
        const { whatsappBotService } = await import('./WhatsAppBotService.js');
        await whatsappBotService.disconnect(workspaceId, input.connectionId);
        return { disconnected: true };
      }
    }
  }

  async messages(workspaceId: string, groupId: string) {
    const group = await personalBotGroupRepository.find(workspaceId, groupId);
    if (!group || group.archived) throw new Error('BOT_GROUP_NOT_FOUND');
    return channelRepository.list(workspaceId, botGroupChannel(groupId), { limit: 100 });
  }

  private changed(workspaceId: string) {
    (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId });
  }
}
export const personalBotService = new PersonalBotService();
