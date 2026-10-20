import { describe, expect, it } from 'vitest';
import type { ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
import { fitChatPage, fitSharedChat, legacyConversations, projectChatChannel, projectChatMessage } from '$lib/modules/collaboration/application/projections/shared-chat.js';
import { chatReadCommandSchema, collaborationCommandSchema } from '$lib/modules/collaboration/contracts/schemas/collaboration.schema.js';
import { collaborationPolicy } from '$lib/modules/collaboration/domain/policies/CollaborationPolicy.js';
import { scopeSharedWorkspaceSnapshot } from '$lib/modules/collaboration/application/queries/SharedWorkspaceQuery.js';
import type { SharedChatDto, SharedWorkspaceDto } from '$lib/modules/collaboration/domain/types.js';

const AGENT = '01a15042-3362-7000-8000-000000000001';
const OTHER = '01a15042-3362-7000-8000-000000000002';
const DM = `dm:${AGENT}`;
let sequence = 0;

function message(input: Partial<ChannelMessage>): ChannelMessage {
  sequence += 1;
  return {
    id: `01a15042-3362-7000-8000-${String(sequence).padStart(12, '0')}`,
    workspaceId: 'w',
    channel: DM,
    authorKind: 'owner',
    authorNodeId: null,
    kind: 'text',
    body: 'hello',
    meta: {},
    replyToId: null,
    answeredAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 20, 12, 0, sequence)).toISOString(),
    ...input,
  };
}

describe('the Conversa shared with remote guests', () => {
  it('projects delivery, questions, answers and external senders without leaking host paths or secrets', () => {
    expect(projectChatMessage(message({ meta: { deliverTo: [AGENT] } })).delivery).toBe('queued');
    expect(projectChatMessage(message({ meta: { deliverTo: [AGENT], deliveredAt: '2026-10-20T12:00:09.000Z', via: 'remote' } }))).toMatchObject({ delivery: 'delivered', via: 'remote' });
    expect(projectChatMessage(message({ meta: { via: 'terminal' } }))).toMatchObject({ delivery: null, via: 'terminal' });

    const question = projectChatMessage(message({
      authorKind: 'agent', authorNodeId: AGENT, kind: 'question', body: 'Deploy now?',
      meta: { options: ['Yes', 'No', 7], awaiting: 'owner', escalationNote: 'Costs money', leaderTitle: 'Lead' },
    }));
    expect(question).toMatchObject({ options: ['Yes', 'No'], awaiting: 'owner', note: 'Costs money', closedBy: null });

    const decided = projectChatMessage(message({ authorKind: 'agent', authorNodeId: OTHER, kind: 'answer', body: 'Use Redis', meta: { closedBy: 'leader', authorTitle: 'Lead' } }));
    expect(decided).toMatchObject({ closedBy: 'leader', authorName: 'Lead', awaiting: null, options: [] });

    const external = projectChatMessage(message({ authorKind: 'external', meta: { via: 'telegram', sender: 'Ana', bindingId: 'secret-binding' } }));
    expect(external).toMatchObject({ authorName: 'Ana', via: 'telegram' });
    expect(JSON.stringify(external)).not.toContain('secret-binding');

    const leaky = projectChatMessage(message({ body: 'See /Users/owner/private/key.pem and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 at http://localhost:5173' }));
    expect(leaky.body).toContain('[redacted-path]');
    expect(leaky.body).toContain('[redacted-secret]');
    expect(leaky.body).toContain('[redacted-private-url]');
    expect(projectChatMessage(message({ meta: { via: 'carrier-pigeon' } })).via).toBeNull();
    expect(projectChatMessage(message({ channel: 'team', authorKind: 'system', kind: 'event', body: 'Ship v2', meta: { event: 'task_done', taskId: 't', assigneeNodeId: AGENT } })))
      .toMatchObject({ event: 'task_done', eventNodeId: AGENT, body: 'Ship v2' });
    expect(projectChatMessage(message({ meta: { event: 'task_done', assigneeNodeId: AGENT } }))).toMatchObject({ event: null, eventNodeId: null });
  });

  it('marks the leader among the channels', () => {
    const channel = projectChatChannel({ id: DM, kind: 'dm', nodeId: AGENT, title: 'Lead', openQuestions: 1, last: { createdAt: '2026-10-20T12:00:00.000Z' } }, AGENT);
    expect(channel).toEqual({ id: DM, kind: 'dm', nodeId: AGENT, title: 'Lead', leader: true, openQuestions: 1, lastAt: '2026-10-20T12:00:00.000Z' });
    expect(projectChatChannel({ id: 'team', kind: 'team', nodeId: null, title: 'team', openQuestions: 0, last: null }, AGENT).leader).toBe(false);
  });

  it('fits the most recent messages of every channel, then fewer and shorter ones, then the channels alone', () => {
    const channels = [
      { id: 'team', kind: 'team' as const, nodeId: null, title: 'team', leader: false, openQuestions: 0, lastAt: null },
      { id: DM, kind: 'dm' as const, nodeId: AGENT, title: 'Lead', leader: true, openQuestions: 0, lastAt: null },
    ];
    const messages = [
      ...Array.from({ length: 20 }, () => projectChatMessage(message({ channel: 'team', body: 'team update '.repeat(40) }))),
      ...Array.from({ length: 20 }, () => projectChatMessage(message({ body: 'direct note '.repeat(40) }))),
    ];
    const chat: SharedChatDto = { channels, messages };

    const roomy = fitSharedChat(chat, 1_000_000)!;
    expect(roomy.messages.filter((entry) => entry.channel === 'team')).toHaveLength(12);
    expect(roomy.messages.filter((entry) => entry.channel === DM)).toHaveLength(12);
    // Oldest first, and the kept ones are the newest of each channel.
    expect(roomy.messages.map((entry) => entry.createdAt)).toEqual([...roomy.messages.map((entry) => entry.createdAt)].sort());
    expect(roomy.messages.at(-1)?.id).toBe(messages.at(-1)?.id);

    const tight = fitSharedChat(chat, 6_000)!;
    expect(Buffer.byteLength(JSON.stringify(tight))).toBeLessThanOrEqual(6_000);
    expect(tight.messages.length).toBeGreaterThan(0);
    expect(tight.messages.length).toBeLessThan(24);
    expect(tight.messages.some((entry) => entry.clipped && entry.body.endsWith('…'))).toBe(true);
    expect(new Set(tight.messages.map((entry) => entry.channel))).toEqual(new Set(['team', DM]));

    expect(fitSharedChat(chat, 400)).toEqual({ channels, messages: [] });
    expect(fitSharedChat(chat, 50)).toBeNull();
  });

  it('pages whole messages oldest first and reports when older ones did not fit', () => {
    const newestFirst = Array.from({ length: 5 }, (_, index) => projectChatMessage(message({ body: `message ${index} `.repeat(50) }))).reverse();
    const all = fitChatPage(newestFirst, 1_000_000);
    expect(all.complete).toBe(true);
    expect(all.messages.map((entry) => entry.id)).toEqual([...newestFirst].reverse().map((entry) => entry.id));
    expect(all.messages.every((entry) => !entry.clipped)).toBe(true);

    const two = fitChatPage(newestFirst, Buffer.byteLength(JSON.stringify(newestFirst.slice(0, 2))) + 4);
    expect(two.complete).toBe(false);
    expect(two.messages.map((entry) => entry.id)).toEqual([newestFirst[1].id, newestFirst[0].id]);

    const huge = projectChatMessage(message({ body: 'x'.repeat(8_000) }));
    const clipped = fitChatPage([huge], 1_000);
    expect(clipped.messages[0]).toMatchObject({ clipped: true });
    expect(clipped.complete).toBe(false);
  });

  it('pairs the owner direct messages with the replies for older guests, newest first and six per agent', () => {
    const channels = [{ id: DM, kind: 'dm' as const, nodeId: AGENT, title: 'Lead', leader: true, openQuestions: 0, lastAt: null }];
    const raw: ChannelMessage[] = [];
    for (let index = 0; index < 8; index += 1) {
      raw.push(message({ body: `ask ${index}`, meta: { deliverTo: [AGENT], deliveredAt: '2026-10-20T12:00:00.000Z' } }));
      raw.push(message({ authorKind: 'agent', authorNodeId: AGENT, body: `reply ${index}a` }));
      raw.push(message({ authorKind: 'agent', authorNodeId: AGENT, body: `reply ${index}b` }));
    }
    raw.push(message({ body: 'still waiting', meta: { deliverTo: [AGENT] } }));
    const conversations = legacyConversations({ channels, messages: raw.map(projectChatMessage) });
    expect(conversations).toHaveLength(6);
    expect(conversations[0]).toMatchObject({ message: 'still waiting', reply: null, state: 'queued', agentNodeId: AGENT, agentTitle: 'Lead' });
    expect(conversations[1]).toMatchObject({ message: 'ask 7', reply: 'reply 7a\n\nreply 7b', state: 'replied' });

    const earlier = [{
      messageId: 'old', agentNodeId: OTHER, agentTitle: 'QA', state: 'replied' as const, message: 'Old remote ask',
      reply: 'Old reply', error: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    }];
    expect(legacyConversations({ channels, messages: [] }, earlier)).toEqual(earlier);
  });

  it('accepts only well-formed chat commands and gates them on messaging the agents', () => {
    expect(collaborationCommandSchema.safeParse({ type: 'chat.post', channel: DM, body: ' Ship it ' })).toMatchObject({ success: true, data: { body: 'Ship it' } });
    expect(collaborationCommandSchema.safeParse({ type: 'chat.post', channel: 'team', body: 'Hi', replyToId: null }).success).toBe(true);
    expect(collaborationCommandSchema.safeParse({ type: 'chat.post', channel: 'dm:../../etc', body: 'Hi' }).success).toBe(false);
    expect(collaborationCommandSchema.safeParse({ type: 'chat.post', channel: DM, body: '   ' }).success).toBe(false);
    expect(collaborationCommandSchema.safeParse({ type: 'chat.post', channel: DM, body: 'x'.repeat(8_001) }).success).toBe(false);
    expect(collaborationCommandSchema.safeParse({ type: 'chat.post', channel: DM, body: 'Hi', extra: true }).success).toBe(false);
    expect(chatReadCommandSchema.safeParse({ type: 'chat.read', channel: DM, before: '2026-10-20T12:00:00.000Z' }).success).toBe(true);
    expect(chatReadCommandSchema.safeParse({ type: 'chat.read', channel: DM, before: 'yesterday' }).success).toBe(false);
    expect(chatReadCommandSchema.safeParse({ type: 'chat.read', channel: DM, before: '2026-10-20T12:00:00.000Z', beforeId: '01a15042-3362-7000-8000-000000000001' }).success).toBe(true);
    expect(chatReadCommandSchema.safeParse({ type: 'chat.read', channel: DM, before: '2026-10-20T12:00:00.000Z', beforeId: "1' OR 1=1" }).success).toBe(false);
    expect(collaborationPolicy.commandScope('chat.post')).toBe('agents.message');
    expect(collaborationPolicy.scopesForRole('collaborator')).not.toContain('agents.message');
  });

  it('shares the conversation only with guests that may talk to the agents', () => {
    const chat: SharedChatDto = { channels: [], messages: [] };
    const snapshot = {
      shareId: 's', revision: 1, workspace: { name: 'W', icon: null }, nodes: [], edges: [], columns: [], tasks: [], agents: [],
      conversations: [{ messageId: 'm', agentNodeId: AGENT, agentTitle: 'Lead', state: 'replied', message: 'a', reply: 'b', error: null, createdAt: '', updatedAt: '' }],
      huddles: [], floors: [], roles: [], reviews: [], designs: [], usage: [], activity: [], chat, generatedAt: '',
    } as SharedWorkspaceDto;
    const viewer = scopeSharedWorkspaceSnapshot(snapshot, collaborationPolicy.scopesForRole('viewer'));
    expect(viewer.chat).toBeUndefined();
    expect(viewer.conversations).toEqual([]);
    expect(JSON.parse(JSON.stringify(viewer))).not.toHaveProperty('chat');
    const operator = scopeSharedWorkspaceSnapshot(snapshot, collaborationPolicy.scopesForRole('operator'));
    expect(operator.chat).toBe(chat);
    expect(operator.conversations).toHaveLength(1);
  });
});
