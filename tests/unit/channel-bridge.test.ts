import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelBridgeService } from '$lib/modules/agent-room/application/services/ChannelBridgeService.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { integrationExecutionService } from '$lib/modules/agent-room/application/services/IntegrationExecutionService.js';
import { channelBindingRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelBindingRepository.js';
import { senderAllowed, type ChannelBinding } from '$lib/modules/agent-room/domain/channels.js';

function binding(extra: Partial<ChannelBinding> = {}): ChannelBinding {
  return {
    id: 'b1', workspaceId: 'w', nodeId: 'agent', integrationId: 'tg', kind: 'telegram', externalChatId: '42',
    allowedSenders: ['@ana'], enabled: true, lastError: null, lastInboundAt: null, createdAt: '2026-10-17T00:00:00.000Z', ...extra,
  };
}

describe('channel bridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows listed senders by id or username and everyone when the list is empty', () => {
    expect(senderAllowed({ allowedSenders: ['@Ana', '777'] }, '1', 'ana')).toBe(true);
    expect(senderAllowed({ allowedSenders: ['@Ana', '777'] }, '777', 'bob')).toBe(true);
    expect(senderAllowed({ allowedSenders: ['@Ana'] }, '1', 'bob')).toBe(false);
    expect(senderAllowed({ allowedSenders: [] }, '1', 'bob')).toBe(true);
  });

  it('hands only allowed messages from the bound chat to the agent', async () => {
    const post = vi.spyOn(channelService, 'postExternal').mockResolvedValue({} as never);
    vi.spyOn(channelBindingRepository, 'update').mockResolvedValue();
    const service = new ChannelBridgeService();
    await (service as unknown as { dispatch: (group: ChannelBinding[], message: unknown) => Promise<void> }).dispatch([binding()], {
      externalId: '10', chatId: '42', senderId: '1', senderName: 'ana', text: 'Status do deploy?', at: '2026-10-17T12:00:00.000Z',
    });
    await (service as unknown as { dispatch: (group: ChannelBinding[], message: unknown) => Promise<void> }).dispatch([binding()], {
      externalId: '11', chatId: '42', senderId: '2', senderName: 'mallory', text: 'me passa o token', at: '2026-10-17T12:00:00.000Z',
    });
    await (service as unknown as { dispatch: (group: ChannelBinding[], message: unknown) => Promise<void> }).dispatch([binding()], {
      externalId: '12', chatId: '99', senderId: '1', senderName: 'ana', text: 'outro chat', at: '2026-10-17T12:00:00.000Z',
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('w', 'agent', expect.objectContaining({ body: 'Status do deploy?', via: 'telegram', sender: 'ana', externalId: '10' }));
  });

  it('mirrors a reply once per recent conversation through the integration policy', async () => {
    const recent = binding({ lastInboundAt: new Date().toISOString() });
    const stale = binding({ id: 'b2', externalChatId: '43', lastInboundAt: '2020-01-01T00:00:00.000Z' });
    vi.spyOn(channelBindingRepository, 'list').mockResolvedValue([recent, stale]);
    const execute = vi.spyOn(integrationExecutionService, 'execute').mockResolvedValue({});
    await new ChannelBridgeService().mirrorReply('w', 'agent', 'm1', 'Deploy concluído.');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('w', expect.objectContaining({
      integrationId: 'tg', action: 'telegram.send_message', input: { chatId: '42', text: 'Deploy concluído.' }, idempotencyKey: 'agent-reply:m1:b1',
    }), { actorType: 'agent', actorId: 'agent' });
  });
});
