import type { ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';

export type TimelineRow =
  | { type: 'day'; key: string; date: string }
  | { type: 'event'; key: string; message: ChannelMessage }
  | { type: 'group'; key: string; authorKind: ChannelMessage['authorKind']; authorNodeId: string | null; messages: ChannelMessage[] };

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function dayOf(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Orders messages oldest first and folds consecutive messages of one author
 * (within five minutes, same day) into a group; events and questions stand
 * alone so their cards keep their own header.
 */
export function buildTimeline(messages: readonly ChannelMessage[]): TimelineRow[] {
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const rows: TimelineRow[] = [];
  let lastDay = '';
  for (const message of sorted) {
    const day = dayOf(message.createdAt);
    if (day !== lastDay) {
      rows.push({ type: 'day', key: `day:${day}`, date: message.createdAt });
      lastDay = day;
    }
    if (message.kind === 'event' || message.authorKind === 'system') {
      rows.push({ type: 'event', key: message.id, message });
      continue;
    }
    const previous = rows[rows.length - 1];
    const last = previous?.type === 'group' ? previous.messages[previous.messages.length - 1] : null;
    if (
      previous?.type === 'group'
      && last
      && message.kind !== 'question'
      && last.kind !== 'question'
      && previous.authorKind === message.authorKind
      && previous.authorNodeId === message.authorNodeId
      && Date.parse(message.createdAt) - Date.parse(last.createdAt) <= GROUP_WINDOW_MS
    ) {
      previous.messages.push(message);
      continue;
    }
    rows.push({ type: 'group', key: message.id, authorKind: message.authorKind, authorNodeId: message.authorNodeId, messages: [message] });
  }
  return rows;
}

/** Answers keyed by the question they reply to. */
export function answersByQuestion(messages: readonly ChannelMessage[]): Map<string, ChannelMessage> {
  const answers = new Map<string, ChannelMessage>();
  for (const message of messages) {
    if (message.kind === 'answer' && message.replyToId && !answers.has(message.replyToId)) answers.set(message.replyToId, message);
  }
  return answers;
}

/** Inserts or replaces a message by id, keeping the list free of duplicates. */
export function upsertMessage(messages: readonly ChannelMessage[], message: ChannelMessage): ChannelMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}
