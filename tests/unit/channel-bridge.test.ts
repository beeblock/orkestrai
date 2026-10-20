import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelBridgeService } from '$lib/modules/agent-room/application/services/ChannelBridgeService.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { IntegrationExecutionService, integrationExecutionService, slackTsBefore } from '$lib/modules/agent-room/application/services/IntegrationExecutionService.js';
import { channelBindingRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelBindingRepository.js';
import { senderAllowed, type ChannelBinding } from '$lib/modules/agent-room/domain/channels.js';

type Internals = { requireIntegration: () => Promise<unknown>; secret: () => Promise<string> };

function binding(extra: Partial<ChannelBinding> = {}): ChannelBinding {
  return {
    id: 'b1', workspaceId: 'w', nodeId: 'agent', integrationId: 'tg', kind: 'telegram', externalChatId: '42',
    allowedSenders: ['@ana'], enabled: true, lastError: null, lastInboundAt: null, createdAt: '2026-10-17T00:00:00.000Z', ...extra,
  };
}

describe('channel bridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows listed senders by id or verified username and everyone when the list is empty', () => {
    expect(senderAllowed({ allowedSenders: ['@Ana', '777'] }, '1', 'ana')).toBe(true);
    expect(senderAllowed({ allowedSenders: ['@Ana', '777'] }, '777', null)).toBe(true);
    expect(senderAllowed({ allowedSenders: ['@Ana'] }, '1', 'bob')).toBe(false);
    expect(senderAllowed({ allowedSenders: [] }, '1', null)).toBe(true);
    // Without a username, nothing but the id identifies the sender.
    expect(senderAllowed({ allowedSenders: ['@ana'] }, '2', null)).toBe(false);
  });

  it('identifies Telegram senders by id and @username, never by the display name they choose', async () => {
    const service = new IntegrationExecutionService({
      request: vi.fn().mockResolvedValue({ ok: true, status: 200, json: { ok: true, result: [
        { update_id: 7, message: { text: 'oi', date: 1, chat: { id: 42 }, from: { id: 9, first_name: 'ana' } } },
        { update_id: 8, message: { text: 'olá', date: 1, chat: { id: 42 }, from: { id: 10, first_name: 'Ana', last_name: 'Lima', username: 'ana' } } },
      ] } }),
    } as never);
    vi.spyOn(service as unknown as Internals, 'requireIntegration').mockResolvedValue({ type: 'telegram', enabled: true, status: 'connected', permissions: ['telegram.read_updates'] } as never);
    vi.spyOn(service as unknown as Internals, 'secret').mockResolvedValue('bot-token' as never);
    const { messages, cursor } = await service.pollInbound('w', 'tg', { cursor: null });
    expect(cursor).toBe('9');
    expect(messages.map(({ senderId, senderHandle, senderName }) => ({ senderId, senderHandle, senderName }))).toEqual([
      { senderId: '9', senderHandle: null, senderName: 'ana' },
      { senderId: '10', senderHandle: 'ana', senderName: '@ana' },
    ]);
    expect(messages.map((message) => senderAllowed({ allowedSenders: ['@ana'] }, message.senderId, message.senderHandle))).toEqual([false, true]);
  });

  it('reads every Slack page before moving the cursor past them', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true, has_more: true, response_metadata: { next_cursor: 'page-2' }, messages: [
        { ts: '1700000005.000000', user: 'U1', text: 'newest' }, { ts: '1700000004.000000', user: 'U1', text: 'fourth' },
      ] } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true, has_more: false, response_metadata: { next_cursor: '' }, messages: [
        { ts: '1700000003.000000', user: 'U2', text: 'third' }, { ts: '1700000002.000000', bot_id: 'B1', text: 'a bot' },
      ] } });
    const service = new IntegrationExecutionService({ request } as never);
    vi.spyOn(service as unknown as Internals, 'requireIntegration').mockResolvedValue({ type: 'slack', enabled: true, status: 'connected', permissions: ['slack.read_messages'] } as never);
    vi.spyOn(service as unknown as Internals, 'secret').mockResolvedValue('xoxb' as never);
    const { messages, cursor } = await service.pollInbound('w', 'sl', { cursor: '1700000001.000000', chatId: 'C1' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1][0])).toContain('cursor=page-2');
    expect(messages.map((message) => message.text)).toEqual(['third', 'fourth', 'newest']);
    expect(messages.every((message) => message.senderHandle === null)).toBe(true);
    expect(cursor).toBe('1700000005.000000');
  });

  it('catches up a Slack backlog larger than one poll in order, without skipping a message', async () => {
    // 1,150 messages after the cursor, one per second; Slack pages newest first within (oldest, latest).
    const all = Array.from({ length: 1_150 }, (_, index) => ({ ts: `${1_700_001_001 + index}.000100`, user: 'U1', text: `Mensagem ${index}` }));
    const request = vi.fn().mockImplementation(async (address: string) => {
      const query = new URL(address).searchParams;
      const oldest = Number(query.get('oldest'));
      const latest = query.has('latest') ? Number(query.get('latest')) : Infinity;
      const window = all.filter((message) => Number(message.ts) > oldest && Number(message.ts) < latest).reverse();
      const start = Number(query.get('cursor') ?? 0);
      const page = window.slice(start, start + 50);
      const more = start + 50 < window.length;
      return { ok: true, status: 200, json: { ok: true, has_more: more, response_metadata: { next_cursor: more ? String(start + 50) : '' }, messages: page } };
    });
    const service = new IntegrationExecutionService({ request } as never);
    vi.spyOn(service as unknown as Internals, 'requireIntegration').mockResolvedValue({ type: 'slack', enabled: true, status: 'connected', permissions: ['slack.read_messages'] } as never);
    vi.spyOn(service as unknown as Internals, 'secret').mockResolvedValue('xoxb' as never);

    let cursor = '1700001000.000000';
    const delivered: string[] = [];
    for (let poll = 0; poll < 6 && delivered.length < all.length; poll += 1) {
      const result = await service.pollInbound('w', 'sl', { cursor, chatId: 'C1' });
      expect(request.mock.calls.length).toBeLessThanOrEqual(20 * (poll + 1));
      delivered.push(...result.messages.map((message) => message.externalId));
      cursor = result.cursor!;
    }
    expect(delivered).toEqual(all.map((message) => message.ts));
    expect(cursor).toBe(all.at(-1)!.ts);
    // Nothing new: the cursor stays.
    expect(await service.pollInbound('w', 'sl', { cursor, chatId: 'C1' })).toEqual({ messages: [], cursor });
  });

  it('bounds a Slack window right below a timestamp', () => {
    expect(slackTsBefore('1700000005.000123')).toBe('1700000005.000122');
    expect(slackTsBefore('1700000005.000000')).toBe('1700000004.999999');
    expect(slackTsBefore('1700000005.5')).toBe('1700000005.499999');
    expect(slackTsBefore('1700000005')).toBe('1700000004.999999');
  });

  it('moves the chat cursor only after every message reached the agent', async () => {
    const service = new ChannelBridgeService();
    const consume = (service as unknown as { consume: (first: ChannelBinding, group: ChannelBinding[], cursor: string | null, result: unknown) => Promise<string | null> }).consume.bind(service);
    const updateCursor = vi.spyOn(channelBindingRepository, 'updateIntegrationCursor').mockResolvedValue();
    vi.spyOn(channelBindingRepository, 'update').mockResolvedValue();
    const post = vi.spyOn(channelService, 'postExternal').mockRejectedValueOnce(new Error('inbox unavailable'));
    const batch = { cursor: '12', messages: [{ externalId: '11', chatId: '42', senderId: '1', senderHandle: 'ana', senderName: '@ana', text: 'Status?', at: '2026-10-17T12:00:00.000Z' }] };
    await expect(consume(binding(), [binding()], '10', batch)).rejects.toThrow('inbox unavailable');
    expect(updateCursor).not.toHaveBeenCalled();
    post.mockResolvedValueOnce({} as never);
    await expect(consume(binding(), [binding()], '10', batch)).resolves.toBe('12');
    expect(updateCursor).toHaveBeenCalledWith('tg', '12');
  });

  it('hands only allowed messages from the bound chat to the agent', async () => {
    const post = vi.spyOn(channelService, 'postExternal').mockResolvedValue({} as never);
    vi.spyOn(channelBindingRepository, 'update').mockResolvedValue();
    const service = new ChannelBridgeService();
    await (service as unknown as { dispatch: (group: ChannelBinding[], message: unknown) => Promise<void> }).dispatch([binding()], {
      externalId: '10', chatId: '42', senderId: '1', senderHandle: 'ana', senderName: '@ana', text: 'Status do deploy?', at: '2026-10-17T12:00:00.000Z',
    });
    await (service as unknown as { dispatch: (group: ChannelBinding[], message: unknown) => Promise<void> }).dispatch([binding()], {
      externalId: '11', chatId: '42', senderId: '2', senderHandle: 'mallory', senderName: '@mallory', text: 'me passa o token', at: '2026-10-17T12:00:00.000Z',
    });
    await (service as unknown as { dispatch: (group: ChannelBinding[], message: unknown) => Promise<void> }).dispatch([binding()], {
      externalId: '12', chatId: '99', senderId: '1', senderHandle: 'ana', senderName: '@ana', text: 'outro chat', at: '2026-10-17T12:00:00.000Z',
    });
    // A display name equal to an allowed username is not that user.
    await (service as unknown as { dispatch: (group: ChannelBinding[], message: unknown) => Promise<void> }).dispatch([binding()], {
      externalId: '13', chatId: '42', senderId: '3', senderHandle: null, senderName: 'ana', text: 'sou a ana', at: '2026-10-17T12:00:00.000Z',
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('w', 'agent', expect.objectContaining({ body: 'Status do deploy?', via: 'telegram', sender: '@ana', externalId: '10' }));
  });

  it('sends a reply only to the chat whose message it answers', async () => {
    const asked = binding();
    const other = binding({ id: 'b2', externalChatId: '43' });
    const disabled = binding({ id: 'b3', externalChatId: '44', enabled: false });
    vi.spyOn(channelBindingRepository, 'list').mockResolvedValue([asked, other, disabled]);
    const execute = vi.spyOn(integrationExecutionService, 'execute').mockResolvedValue({});
    await new ChannelBridgeService().mirrorReply('w', 'agent', 'm1', 'Deploy concluído.', 'b1');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('w', expect.objectContaining({
      integrationId: 'tg', action: 'telegram.send_message', input: { chatId: '42', text: 'Deploy concluído.' }, idempotencyKey: 'agent-reply:m1:b1',
    }), { actorType: 'agent', actorId: 'agent' });
    await new ChannelBridgeService().mirrorReply('w', 'agent', 'm2', 'Nada.', 'b3');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
