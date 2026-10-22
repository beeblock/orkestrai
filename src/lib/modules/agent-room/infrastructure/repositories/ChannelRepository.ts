import { uuidv7 } from '@beeblock/svelar/support';
import { AgentChannelMessage } from '../../domain/models/AgentChannelMessage.js';
import type { ChannelAuthorKind, ChannelMessage, ChannelMessageKind } from '../../domain/channels.js';

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function parseMeta(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function mapChannelMessage(model: AgentChannelMessage): ChannelMessage {
  const answeredAt = model.getAttribute('answered_at');
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    channel: model.getAttribute('channel'),
    authorKind: model.getAttribute('author_kind') as ChannelAuthorKind,
    authorNodeId: model.getAttribute('author_node_id') ?? null,
    kind: model.getAttribute('kind') as ChannelMessageKind,
    body: model.getAttribute('body'),
    meta: parseMeta(model.getAttribute('meta_json')),
    replyToId: model.getAttribute('reply_to_id') ?? null,
    answeredAt: answeredAt ? toIso(answeredAt) : null,
    createdAt: toIso(model.getAttribute('created_at')),
  };
}

export type SaveChannelMessageInput = {
  workspaceId: string;
  channel: string;
  authorKind: ChannelAuthorKind;
  authorNodeId?: string | null;
  kind?: ChannelMessageKind;
  body: string;
  meta?: Record<string, unknown>;
  replyToId?: string | null;
};

export class ChannelRepository {
  async save(input: SaveChannelMessageInput): Promise<ChannelMessage> {
    const now = new Date().toISOString();
    const model = await AgentChannelMessage.create({
      id: uuidv7(),
      workspace_id: input.workspaceId,
      channel: input.channel,
      author_kind: input.authorKind,
      author_node_id: input.authorNodeId ?? null,
      kind: input.kind ?? 'text',
      body: input.body,
      meta_json: input.meta && Object.keys(input.meta).length ? JSON.stringify(input.meta) : null,
      reply_to_id: input.replyToId ?? null,
      answered_at: null,
      created_at: now,
      updated_at: now,
    });
    return mapChannelMessage(model);
  }

  async find(workspaceId: string, id: string): Promise<ChannelMessage | null> {
    const model = await AgentChannelMessage.find(id);
    if (!model || model.getAttribute('workspace_id') !== workspaceId) return null;
    return mapChannelMessage(model);
  }

  /**
   * Newest first, by time and then id. `before` with `beforeId` pages back
   * from exactly that message, even past others written in the same
   * millisecond; `before` alone pages back from that instant, which
   * `includeInstant` keeps for readers that drop the messages they hold.
   */
  async list(
    workspaceId: string,
    channel: string,
    input: { before?: string | null; beforeId?: string | null; includeInstant?: boolean; limit?: number } = {},
  ): Promise<ChannelMessage[]> {
    const query = AgentChannelMessage.query().where('workspace_id', workspaceId).where('channel', channel);
    const { before, beforeId } = input;
    if (before && beforeId) {
      query.whereNested((older) => {
        older.where('created_at', '<', before).orWhereNested((same) => same.where('created_at', before).where('id', '<', beforeId));
      });
    } else if (before) query.where('created_at', input.includeInstant ? '<=' : '<', before);
    const rows = await query.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(Math.min(200, Math.max(1, input.limit ?? 80))).get();
    return rows.map(mapChannelMessage);
  }

  /** A message a Telegram or Slack chat delivered, found by its identity in that chat at any age. */
  async findExternal(workspaceId: string, channel: string, bindingId: string, externalId: string): Promise<ChannelMessage | null> {
    const rows = await AgentChannelMessage.query()
      .where('workspace_id', workspaceId)
      .where('channel', channel)
      .where('author_kind', 'external')
      .where('meta_json', 'like', `%${JSON.stringify({ externalId }).slice(1, -1)}%`)
      .orderBy('created_at', 'desc')
      .limit(50)
      .get();
    return rows.map(mapChannelMessage).find((message) => message.meta.bindingId === bindingId && message.meta.externalId === externalId) ?? null;
  }

  /** Whether a stored message of the workspace carries this attachment: then its file belongs to that message. */
  async referencesAttachment(workspaceId: string, attachmentId: string): Promise<boolean> {
    const rows = await AgentChannelMessage.query()
      .where('workspace_id', workspaceId)
      .where('meta_json', 'like', `%${JSON.stringify({ id: attachmentId }).slice(1, -1)}%`)
      .limit(50)
      .get();
    return rows.map(mapChannelMessage).some((message) => Array.isArray(message.meta.attachments)
      && message.meta.attachments.some((attachment) => (attachment as { id?: unknown } | null)?.id === attachmentId));
  }

  /** The newest message of every channel in the workspace, for the channel list. */
  async latestByChannel(workspaceId: string, limit = 400): Promise<Map<string, ChannelMessage>> {
    const rows = await AgentChannelMessage.query()
      .where('workspace_id', workspaceId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();
    const latest = new Map<string, ChannelMessage>();
    for (const row of rows) {
      const message = mapChannelMessage(row);
      if (!latest.has(message.channel)) latest.set(message.channel, message);
    }
    return latest;
  }

  async openQuestions(workspaceId: string): Promise<ChannelMessage[]> {
    const rows = await AgentChannelMessage.query()
      .where('workspace_id', workspaceId)
      .where('kind', 'question')
      .whereNull('answered_at')
      .orderBy('created_at', 'desc')
      .limit(100)
      .get();
    return rows.map(mapChannelMessage);
  }

  /**
   * Marks a question answered once; returns false when it already was. The
   * conditional update decides: of two answers at the same moment, one wins.
   */
  async markAnswered(workspaceId: string, id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const changed = await AgentChannelMessage.query()
      .where('id', id)
      .where('workspace_id', workspaceId)
      .whereNull('answered_at')
      .update({ answered_at: now, updated_at: now });
    return Number(changed) > 0;
  }

  /** Merges fields into a message's meta; null when it is not in this workspace. */
  async mergeMeta(workspaceId: string, id: string, patch: Record<string, unknown>): Promise<ChannelMessage | null> {
    const model = await AgentChannelMessage.find(id);
    if (!model || model.getAttribute('workspace_id') !== workspaceId) return null;
    const message = mapChannelMessage(model);
    await AgentChannelMessage.query().where('id', id).update({ meta_json: JSON.stringify({ ...message.meta, ...patch }), updated_at: new Date().toISOString() });
    const updated = await AgentChannelMessage.find(id);
    return updated ? mapChannelMessage(updated) : null;
  }

  /** Records once when an owner message reached its agent; null when it already had. */
  async markDelivered(workspaceId: string, id: string, at: string): Promise<ChannelMessage | null> {
    const model = await AgentChannelMessage.find(id);
    if (!model || model.getAttribute('workspace_id') !== workspaceId) return null;
    const message = mapChannelMessage(model);
    if (message.authorKind !== 'owner' || message.meta.deliveredAt) return null;
    await AgentChannelMessage.query().where('id', id).update({ meta_json: JSON.stringify({ ...message.meta, deliveredAt: at }), updated_at: new Date().toISOString() });
    const updated = await AgentChannelMessage.find(id);
    return updated ? mapChannelMessage(updated) : null;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await AgentChannelMessage.query().where('workspace_id', workspaceId).delete();
  }
}

export const channelRepository = new ChannelRepository();
