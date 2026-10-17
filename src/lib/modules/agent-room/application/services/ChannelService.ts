import {
  directChannel,
  directChannelNode,
  MAX_CHANNEL_BODY,
  mentionedTitles,
  normalizeQuestionOptions,
  TEAM_CHANNEL,
  type ChannelMessage,
} from '../../domain/channels.js';
import type { AgentMessageEnvelope, TerminalNodePayload } from '../../domain/types.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { agentInboxService } from './AgentInboxService.js';
import { attentionService } from './AttentionService.js';

export type ChannelAgent = { id: string; title: string; maestro: boolean };
export type ChannelSummary = {
  id: string;
  kind: 'team' | 'dm';
  nodeId: string | null;
  title: string;
  last: ChannelMessage | null;
  openQuestions: number;
};
export type OwnerPostResult = {
  message: ChannelMessage;
  delivered: Array<{ nodeId: string; ok: boolean }>;
};

export const OWNER_QUESTION_SOURCE = 'owner_question';

function broadcast(message: ChannelMessage): void {
  const send = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'channelMessage', workspaceId: message.workspaceId, channel: message.channel, message });
}

function boundedBody(value: string): string {
  const body = value.trim();
  if (!body) throw new Error('A mensagem está vazia.');
  if (body.length > MAX_CHANNEL_BODY) throw new Error(`A mensagem passa de ${MAX_CHANNEL_BODY} caracteres.`);
  return body;
}

/** Agent-to-agent asks appear in the team channel as a message with the reply under it. */
function envelopeMessage(envelope: AgentMessageEnvelope): ChannelMessage {
  return {
    id: `envelope:${envelope.id}`,
    workspaceId: envelope.workspaceId,
    channel: TEAM_CHANNEL,
    authorKind: 'agent',
    authorNodeId: envelope.fromNodeId,
    kind: 'text',
    body: envelope.content,
    meta: {
      to: envelope.toNodeId,
      state: envelope.state,
      ...(envelope.reply ? { reply: envelope.reply } : {}),
    },
    replyToId: null,
    answeredAt: null,
    createdAt: envelope.createdAt,
  };
}

/**
 * The team channel and one direct channel per agent. Owner messages reach the
 * agents through their inbox (so a busy agent gets them at its next turn
 * boundary); agents post and ask the owner through the bridge.
 */
export class ChannelService {
  async agents(workspaceId: string): Promise<ChannelAgent[]> {
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return nodes
      .filter((node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).provider))
      .map((node) => ({ id: node.id, title: node.title ?? 'agente', maestro: Boolean((node.payload as TerminalNodePayload).maestro) }));
  }

  private async requireChannel(workspaceId: string, channel: string): Promise<{ agents: ChannelAgent[]; directNodeId: string | null }> {
    const agents = await this.agents(workspaceId);
    if (channel === TEAM_CHANNEL) return { agents, directNodeId: null };
    const nodeId = directChannelNode(channel);
    if (!nodeId || !agents.some((agent) => agent.id === nodeId)) throw new Error('Canal não encontrado neste workspace.');
    return { agents, directNodeId: nodeId };
  }

  async listChannels(workspaceId: string): Promise<{ channels: ChannelSummary[] }> {
    const [agents, latest, open] = await Promise.all([
      this.agents(workspaceId),
      channelRepository.latestByChannel(workspaceId),
      channelRepository.openQuestions(workspaceId),
    ]);
    const openByChannel = new Map<string, number>();
    for (const question of open) openByChannel.set(question.channel, (openByChannel.get(question.channel) ?? 0) + 1);
    return {
      channels: [
        { id: TEAM_CHANNEL, kind: 'team', nodeId: null, title: TEAM_CHANNEL, last: latest.get(TEAM_CHANNEL) ?? null, openQuestions: openByChannel.get(TEAM_CHANNEL) ?? 0 },
        ...agents.map((agent): ChannelSummary => {
          const id = directChannel(agent.id);
          return { id, kind: 'dm', nodeId: agent.id, title: agent.title, last: latest.get(id) ?? null, openQuestions: openByChannel.get(id) ?? 0 };
        }),
      ],
    };
  }

  /** Newest first. The team channel merges the agents' conversations with each other. */
  async listMessages(workspaceId: string, channel: string, input: { before?: string | null; limit?: number } = {}): Promise<ChannelMessage[]> {
    await this.requireChannel(workspaceId, channel);
    const limit = Math.min(200, Math.max(1, input.limit ?? 80));
    const stored = await channelRepository.list(workspaceId, channel, { before: input.before, limit });
    if (channel !== TEAM_CHANNEL) return stored;
    const envelopes = await controlCenterRepository.listConversationEnvelopes(workspaceId, { before: input.before ?? null, limit });
    return [...stored, ...envelopes.map(envelopeMessage)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  /**
   * Stores the owner's message and hands it to its recipients: the agent of a
   * direct channel; in the team channel the agents mentioned with @, else the
   * leader. An answer goes back to the agent that asked and closes its question.
   */
  async postOwner(workspaceId: string, channel: string, input: { body: string; replyToId?: string | null }): Promise<OwnerPostResult> {
    const body = boundedBody(input.body);
    const { agents, directNodeId } = await this.requireChannel(workspaceId, channel);
    if (input.replyToId) return this.answer(workspaceId, channel, input.replyToId, body);
    const message = await channelRepository.save({ workspaceId, channel, authorKind: 'owner', body });
    broadcast(message);
    let recipients: string[];
    if (directNodeId) recipients = [directNodeId];
    else {
      const named = mentionedTitles(body, agents.map((agent) => agent.title));
      recipients = named.length
        ? agents.filter((agent) => named.includes(agent.title)).map((agent) => agent.id)
        : agents.filter((agent) => agent.maestro).slice(0, 1).map((agent) => agent.id);
    }
    const where = directNodeId ? 'Mensagem direta do dono' : 'Mensagem do dono no canal #equipe';
    const content = `${where}: ${body} -- Responda com orkestrai post "<resposta>"${directNodeId ? '' : ' --channel team'} (tool MCP channel_post) para a resposta aparecer na Conversa.`;
    const delivered = await Promise.all(recipients.map(async (nodeId) => ({
      nodeId,
      ok: await this.deliver(workspaceId, nodeId, content, `channel:${message.id}:${nodeId}`, { channel, channelMessageId: message.id }),
    })));
    return { message, delivered };
  }

  private async answer(workspaceId: string, channel: string, questionId: string, body: string): Promise<OwnerPostResult> {
    const question = await channelRepository.find(workspaceId, questionId);
    if (!question || question.kind !== 'question' || question.channel !== channel) throw new Error('Pergunta não encontrada neste canal.');
    if (!(await channelRepository.markAnswered(workspaceId, questionId))) throw new Error('Esta pergunta já foi respondida.');
    const message = await channelRepository.save({ workspaceId, channel, authorKind: 'owner', kind: 'answer', body, replyToId: questionId });
    broadcast(message);
    const answered = await channelRepository.find(workspaceId, questionId);
    if (answered) broadcast(answered);
    await attentionService.resolveSource(workspaceId, OWNER_QUESTION_SOURCE, questionId);
    const asker = question.authorNodeId;
    if (!asker) return { message, delivered: [] };
    const taskId = typeof question.meta.taskId === 'string' ? question.meta.taskId : null;
    const ok = await this.deliver(
      workspaceId,
      asker,
      `Resposta do dono à sua pergunta "${question.body.slice(0, 240)}": ${body}`,
      `owner-answer:${questionId}`,
      { channel, channelMessageId: message.id, questionId },
      taskId,
    );
    return { message, delivered: [{ nodeId: asker, ok }] };
  }

  private async deliver(
    workspaceId: string,
    toNodeId: string,
    content: string,
    dedupKey: string,
    metadata: Record<string, unknown>,
    taskId: string | null = null,
  ): Promise<boolean> {
    try {
      await agentInboxService.enqueue({ workspaceId, toNodeId, fromNodeId: null, kind: 'owner', content, dedupKey, metadata, taskId });
      return true;
    } catch {
      return false;
    }
  }

  /** An agent's post: to the team channel, or to its direct channel with the owner. */
  async postAgent(workspaceId: string, nodeId: string, input: { body: string; channel?: 'team' | 'owner' }): Promise<ChannelMessage> {
    const body = boundedBody(input.body);
    const channel = input.channel === 'team' ? TEAM_CHANNEL : directChannel(nodeId);
    const message = await channelRepository.save({ workspaceId, channel, authorKind: 'agent', authorNodeId: nodeId, body });
    broadcast(message);
    return message;
  }

  /** A question for the owner, with optional answer choices; it also waits in Needs you. */
  async askOwner(
    workspaceId: string,
    agent: { nodeId: string; title: string },
    input: { question: string; options?: unknown; taskId?: string | null },
  ): Promise<ChannelMessage> {
    const body = boundedBody(input.question);
    const options = normalizeQuestionOptions(input.options);
    const message = await channelRepository.save({
      workspaceId,
      channel: directChannel(agent.nodeId),
      authorKind: 'agent',
      authorNodeId: agent.nodeId,
      kind: 'question',
      body,
      meta: { ...(options.length ? { options } : {}), ...(input.taskId ? { taskId: input.taskId } : {}) },
    });
    broadcast(message);
    await attentionService.raise({
      workspaceId,
      nodeId: agent.nodeId,
      taskId: input.taskId ?? null,
      category: 'message',
      severity: 'warning',
      title: body.length > 200 ? `${body.slice(0, 199)}…` : body,
      body: options.length ? options.join(' · ') : null,
      sourceType: OWNER_QUESTION_SOURCE,
      sourceId: message.id,
      correlationId: `${OWNER_QUESTION_SOURCE}:${message.id}`,
      action: { target: 'chat', channel: message.channel, questionId: message.id, ...(options.length ? { options } : {}) },
    });
    return message;
  }

  /** A team-channel event, such as a finished task. Never blocks the caller. */
  async recordEvent(workspaceId: string, input: { body: string; meta: Record<string, unknown> }): Promise<void> {
    try {
      const message = await channelRepository.save({
        workspaceId,
        channel: TEAM_CHANNEL,
        authorKind: 'system',
        kind: 'event',
        body: input.body.slice(0, 500),
        meta: input.meta,
      });
      broadcast(message);
    } catch {
      // The event is informational; the change it describes already happened.
    }
  }
}

export const channelService = new ChannelService();
