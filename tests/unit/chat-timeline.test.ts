import { describe, expect, it } from 'vitest';
import { answersByQuestion, buildTimeline, upsertMessage } from '../../src/lib/components/agent-room/chat/chat-timeline.js';
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
});
