import type { ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
import type { SharedChatChannelDto, SharedChatDto, SharedChatMessageDto, SharedWorkspaceDto } from '../../domain/types.js';
import { sanitizeSharedText } from './sanitize-shared-data.js';

const VIA = new Set(['terminal', 'remote', 'telegram', 'slack']);

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function clip(text: string, limit: number): { text: string; clipped: boolean } {
  if (text.length <= limit) return { text, clipped: false };
  return { text: `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`, clipped: true };
}

function stringMeta(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/** One stored Conversa message as a guest may see it: sanitized, with only the fields its screen needs. */
export function projectChatMessage(message: ChannelMessage): SharedChatMessageDto {
  const meta = message.meta;
  const via = stringMeta(meta, 'via');
  const deliverTo = Array.isArray(meta.deliverTo) && meta.deliverTo.length > 0;
  const awaiting = meta.awaiting === 'leader' || meta.awaiting === 'owner' ? meta.awaiting : null;
  const closedBy = meta.closedBy === 'leader' || meta.closedBy === 'asker' ? meta.closedBy : null;
  const authorName = message.authorKind === 'external' ? stringMeta(meta, 'sender') : closedBy ? stringMeta(meta, 'authorTitle') : null;
  const note = message.kind === 'question' && awaiting === 'owner' ? stringMeta(meta, 'escalationNote') : null;
  return {
    id: message.id,
    channel: message.channel,
    authorKind: message.authorKind,
    authorNodeId: message.authorNodeId,
    authorName: authorName ? sanitizeSharedText(authorName).slice(0, 120) : null,
    kind: message.kind,
    body: sanitizeSharedText(message.body),
    clipped: false,
    replyToId: message.replyToId,
    answeredAt: message.answeredAt,
    createdAt: message.createdAt,
    delivery: message.authorKind === 'owner' && deliverTo ? (stringMeta(meta, 'deliveredAt') ? 'delivered' : 'queued') : null,
    via: via && VIA.has(via) ? via as SharedChatMessageDto['via'] : null,
    options: message.kind === 'question' && Array.isArray(meta.options)
      ? meta.options.filter((option): option is string => typeof option === 'string').slice(0, 6).map((option) => sanitizeSharedText(option).slice(0, 80))
      : [],
    awaiting: message.kind === 'question' ? awaiting : null,
    note: note ? sanitizeSharedText(note).slice(0, 400) : null,
    closedBy: message.kind === 'answer' ? closedBy : null,
    event: message.kind === 'event' && meta.event === 'task_done' ? 'task_done' : null,
    eventNodeId: message.kind === 'event' ? stringMeta(meta, 'assigneeNodeId') : null,
  };
}

export function projectChatChannel(channel: {
  id: string;
  kind: 'team' | 'dm';
  nodeId: string | null;
  title: string;
  openQuestions: number;
  last: { createdAt: string } | null;
}, leaderNodeId: string | null): SharedChatChannelDto {
  return {
    id: channel.id,
    kind: channel.kind,
    nodeId: channel.nodeId,
    title: sanitizeSharedText(channel.title).slice(0, 120),
    leader: Boolean(channel.nodeId && channel.nodeId === leaderNodeId),
    openQuestions: channel.openQuestions,
    lastAt: channel.last?.createdAt ?? null,
  };
}

function withBody(message: SharedChatMessageDto, limit: number): SharedChatMessageDto {
  const body = clip(message.body, limit);
  return body.clipped ? { ...message, body: body.text, clipped: true } : message;
}

function newestFirst(messages: readonly SharedChatMessageDto[]): SharedChatMessageDto[] {
  return [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

// Recent messages per channel and the body length they keep, tried in order.
const CHAT_LEVELS = [[12, 1_200], [8, 600], [5, 320], [3, 200], [1, 160]] as const;

/**
 * The conversation within `room` bytes of JSON: every channel, and the most
 * recent messages of each at the richest level that fits. Without room for
 * even one message each, the channels alone; without room for those, nothing.
 */
export function fitSharedChat(chat: SharedChatDto, room: number): SharedChatDto | null {
  const channels = { channels: chat.channels, messages: [] as SharedChatMessageDto[] };
  if (jsonBytes(channels) > room) return null;
  const byChannel = new Map<string, SharedChatMessageDto[]>();
  for (const message of newestFirst(chat.messages)) {
    const list = byChannel.get(message.channel) ?? [];
    list.push(message);
    byChannel.set(message.channel, list);
  }
  for (const [perChannel, bodyLimit] of CHAT_LEVELS) {
    const messages = [...byChannel.values()]
      .flatMap((list) => list.slice(0, perChannel).map((message) => withBody(message, bodyLimit)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const candidate = { channels: chat.channels, messages };
    if (jsonBytes(candidate) <= room) return candidate;
  }
  return channels;
}

/**
 * A page of whole messages for `chat.read`, oldest first: the newest of
 * `messages` (given newest first) that fit `room` bytes. A single message
 * larger than the room is clipped rather than left out.
 */
export function fitChatPage(messages: readonly SharedChatMessageDto[], room: number): { messages: SharedChatMessageDto[]; complete: boolean } {
  const page: SharedChatMessageDto[] = [];
  let used = 2;
  for (const message of messages) {
    const size = jsonBytes(message) + 1;
    if (used + size > room) {
      if (page.length === 0) page.push(withBody(message, 2_000));
      return { messages: page.reverse(), complete: false };
    }
    page.push(message);
    used += size;
  }
  return { messages: page.reverse(), complete: true };
}

const LEGACY_PER_AGENT = 6;

/**
 * The owner's direct conversations as message/reply pairs, for guests built
 * before the Conversa was shared, together with `earlier` threads those guests
 * started. Newest first and at most six per agent: their leader panel shows
 * the first six of the list reversed, so it shows the latest exchanges.
 */
export function legacyConversations(
  chat: SharedChatDto,
  earlier: SharedWorkspaceDto['conversations'] = [],
): SharedWorkspaceDto['conversations'] {
  const titles = new Map(chat.channels.map((channel) => [channel.id, channel.title]));
  const pairs: SharedWorkspaceDto['conversations'] = [...earlier];
  const byChannel = new Map<string, SharedChatMessageDto[]>();
  for (const message of chat.messages) {
    if (!message.channel.startsWith('dm:')) continue;
    const list = byChannel.get(message.channel) ?? [];
    list.push(message);
    byChannel.set(message.channel, list);
  }
  for (const [channel, list] of byChannel) {
    const ordered = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const agentNodeId = channel.slice(3);
    const exchanges: SharedWorkspaceDto['conversations'] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const message = ordered[index];
      if (message.authorKind !== 'owner' || message.kind === 'answer') continue;
      const replies: SharedChatMessageDto[] = [];
      for (let next = index + 1; next < ordered.length; next += 1) {
        const candidate = ordered[next];
        if (candidate.authorKind === 'owner') break;
        if (candidate.authorKind === 'agent' && candidate.kind === 'text') replies.push(candidate);
      }
      const reply = replies.length ? replies.map((entry) => entry.body).join('\n\n') : null;
      exchanges.push({
        messageId: message.id,
        agentNodeId,
        agentTitle: titles.get(channel) ?? '',
        state: reply ? 'replied' : message.delivery === 'queued' ? 'queued' : 'delivered',
        message: message.body,
        reply,
        error: null,
        createdAt: message.createdAt,
        updatedAt: replies.at(-1)?.createdAt ?? message.createdAt,
      });
    }
    pairs.push(...exchanges);
  }
  const kept = new Map<string, number>();
  return pairs
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((pair) => {
      const count = kept.get(pair.agentNodeId) ?? 0;
      kept.set(pair.agentNodeId, count + 1);
      return count < LEGACY_PER_AGENT;
    });
}
