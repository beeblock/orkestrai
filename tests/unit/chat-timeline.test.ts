import { describe, expect, it } from 'vitest';
import { answersByQuestion, buildTimeline, oldestCursor, pinnedQuestions, upsertMessage } from '../../src/lib/components/agent-room/chat/chat-timeline.js';
import type { ChannelMessage } from '../../src/lib/modules/agent-room/domain/channels.js';

function message(id: string, minute: number, extra: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id,
    workspaceId: 'w',
    channel: 'team',
    authorKind: 'agent',
    authorNodeId: 'a',
    kind: 'text',
    body: id,
    meta: {},
    replyToId: null,
    answeredAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 17, 12, minute)).toISOString(),
    ...extra,
  };
}

describe('chat timeline', () => {
  it('loads earlier messages from the exact oldest one held, even among messages of one instant', () => {
    expect(oldestCursor([])).toBeNull();
    const held = [message('b', 3), message('envelope:a', 1), message('c', 1), message('a', 1), message('d', 2)];
    expect(oldestCursor(held)).toEqual({ before: held[1].createdAt, beforeId: 'a' });
  });

  it('groups one author within five minutes and keeps questions and events apart', () => {
    const rows = buildTimeline([
      message('3', 4),
      message('1', 0),
      message('2', 2),
      message('q', 5, { kind: 'question' }),
      message('e', 6, { kind: 'event', authorKind: 'system', authorNodeId: null }),
      message('4', 30),
      message('o', 31, { authorKind: 'owner', authorNodeId: null }),
    ]);
    expect(rows.map((row) => row.type)).toEqual(['day', 'group', 'group', 'event', 'group', 'group']);
    const first = rows[1];
    expect(first.type === 'group' && first.messages.map((item) => item.id)).toEqual(['1', '2', '3']);
  });

  it('maps answers to their question and replaces messages by id', () => {
    const answer = message('ans', 7, { kind: 'answer', authorKind: 'owner', authorNodeId: null, replyToId: 'q' });
    expect(answersByQuestion([message('q', 5, { kind: 'question' }), answer]).get('q')?.id).toBe('ans');
    const list = upsertMessage([message('1', 0)], message('1', 0, { body: 'edited' }));
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('edited');
  });

  it('pins an open question that scrolled behind the latest messages until it is answered', () => {
    const old = message('old', 0, { kind: 'question' });
    const fresh = message('fresh', 9, { kind: 'question' });
    const later = Array.from({ length: 6 }, (_, index) => message(`later-${index}`, 1 + index));
    expect(pinnedQuestions([old, fresh], [old, ...later, fresh])).toEqual([old]);
    // Not loaded at all: still pinned.
    expect(pinnedQuestions([old], later)).toEqual([old]);
    const answer = message('answer', 8, { kind: 'answer', replyToId: 'old', authorKind: 'owner' });
    expect(pinnedQuestions([old], [old, ...later, answer])).toEqual([]);
  });
});
