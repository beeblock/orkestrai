import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import type { ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';

const LEAD = '01a14a44-5d87-7d1c-90e7-7b697f79bf01';
const QA = '01a14a44-5d87-7d1c-90e7-7b697f79bf02';
const NOTE = '01a14a44-5d87-7d1c-90e7-7b697f79bf03';

function stored(input: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: '01a14a44-5d87-7d1c-90e7-7b697f79bf99', workspaceId: 'w', channel: 'team', authorKind: 'owner', authorNodeId: null,
    kind: 'text', body: '', meta: {}, replyToId: null, answeredAt: null, createdAt: '2026-10-17T12:00:00.000Z', ...input,
  };
}

function mockWorkspace() {
  vi.spyOn(workspaceRepository, 'listNodes').mockResolvedValue([
    { id: LEAD, type: 'terminal', title: 'Codex Lider', payload: { provider: 'codex', maestro: true } },
    { id: QA, type: 'terminal', title: 'QA Upload', payload: { provider: 'claude' } },
    { id: NOTE, type: 'note', title: 'QA notes', payload: {} },
  ] as never);
  vi.spyOn(channelRepository, 'save').mockImplementation(async (input) => stored({ ...input, meta: input.meta ?? {} } as Partial<ChannelMessage>));
  return vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
}

describe('ChannelService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends an unaddressed team message to the leader and a mention only to that agent', async () => {
    const enqueue = mockWorkspace();
    const service = new ChannelService();
    const first = await service.postOwner('w', 'team', { body: 'Como está o upload?' });
    expect(first.delivered).toEqual([{ nodeId: LEAD, ok: true }]);
    const second = await service.postOwner('w', 'team', { body: '@QA Upload rode o e2e' });
    expect(second.delivered).toEqual([{ nodeId: QA, ok: true }]);
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ toNodeId: QA, fromNodeId: null, kind: 'owner' }));
  });

  it('rejects channels outside the workspace', async () => {
    mockWorkspace();
    await expect(new ChannelService().postOwner('w', `dm:${NOTE}`, { body: 'oi' })).rejects.toThrow();
    await expect(new ChannelService().listMessages('w', 'general')).rejects.toThrow();
  });

  it('answers a question once, closes its attention item and replies to the agent that asked', async () => {
    const enqueue = mockWorkspace();
    const question = stored({ id: '01a14a44-5d87-7d1c-90e7-7b697f79bf50', channel: `dm:${QA}`, authorKind: 'agent', authorNodeId: QA, kind: 'question', body: 'Posso instalar o sharp?' });
    vi.spyOn(channelRepository, 'find').mockResolvedValue(question);
    const mark = vi.spyOn(channelRepository, 'markAnswered').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const resolve = vi.spyOn(attentionService, 'resolveSource').mockResolvedValue(1);
    const result = await new ChannelService().postOwner('w', `dm:${QA}`, { body: 'Sim', replyToId: question.id });
    expect(result.message.kind).toBe('answer');
    expect(mark).toHaveBeenCalledWith('w', question.id);
    expect(resolve).toHaveBeenCalledWith('w', 'owner_question', question.id);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ toNodeId: QA, dedupKey: `owner-answer:${question.id}` }));
    await expect(new ChannelService().postOwner('w', `dm:${QA}`, { body: 'Não', replyToId: question.id })).rejects.toThrow();
  });

  it('sends a teammate question to the leader with bounded options, and the leader question to the owner', async () => {
    mockWorkspace();
    const raise = vi.spyOn(attentionService, 'raise').mockResolvedValue();
    const message = await new ChannelService().askOwner('w', { nodeId: QA, title: 'QA Upload' }, { question: 'Qual ambiente?', options: ['Staging', 'staging', 'Produção'] });
    expect(message.meta).toMatchObject({ options: ['Staging', 'Produção'], awaiting: 'leader', leaderNodeId: LEAD });
    expect(raise).not.toHaveBeenCalled();

    await new ChannelService().askOwner('w', { nodeId: LEAD, title: 'Codex Lider' }, { question: 'Publico a versão?' });
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'owner_question', nodeId: LEAD, action: expect.objectContaining({ target: 'chat', channel: `dm:${LEAD}` }) }));
  });

  it('merges agent conversations into the team timeline, newest first', async () => {
    mockWorkspace();
    vi.spyOn(channelRepository, 'list').mockResolvedValue([stored({ id: 'b', createdAt: '2026-10-17T12:05:00.000Z' })]);
    vi.spyOn(controlCenterRepository, 'listConversationEnvelopes').mockResolvedValue([
      { id: 'e1', workspaceId: 'w', fromNodeId: LEAD, toNodeId: QA, content: 'Rode o e2e', reply: 'Rodando', state: 'replied', createdAt: '2026-10-17T12:10:00.000Z' },
    ] as never);
    const messages = await new ChannelService().listMessages('w', 'team');
    expect(messages.map((message) => message.id)).toEqual(['envelope:e1', 'b']);
    expect(messages[0].meta).toMatchObject({ to: QA, reply: 'Rodando' });
  });
});
