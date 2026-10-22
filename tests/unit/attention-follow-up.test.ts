import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentAttentionItem } from '$lib/modules/agent-room/domain/types.js';

function item(sourceType: string, action: Record<string, unknown> = {}): AgentAttentionItem {
  return { id: 'i', workspaceId: 'w', sourceType, action, status: 'open' } as unknown as AgentAttentionItem;
}

describe('Needs you follow-up', () => {
  let attentionFollowUp: typeof import('$lib/components/agent-room/attention-feed.svelte.js').attentionFollowUp;

  beforeAll(async () => {
    vi.stubGlobal('$state', <T>(value: T) => value);
    ({ attentionFollowUp } = await import('$lib/components/agent-room/attention-feed.svelte.js'));
  }, 30_000);

  it('never offers Dismiss for a question, even one answered in free text', () => {
    expect(attentionFollowUp(item('owner_question', { channel: 'dm:a' }))).toBe('answer');
    expect(attentionFollowUp(item('owner_question', { channel: 'dm:a', options: ['Sim', 'Não'] }))).toBe('options');
  });

  it('lets the owner dismiss a notice with nothing to decide', () => {
    expect(attentionFollowUp(item('bridge'))).toBe('dismiss');
    expect(attentionFollowUp(item('notification'))).toBe('dismiss');
    expect(attentionFollowUp(item('usage_limit'))).toBe('dismiss');
  });

  it('keeps decisions and agent states out of Dismiss', () => {
    expect(attentionFollowUp(item('autonomy_gate', { decision: 'gate' }))).toBe('decide');
    expect(attentionFollowUp(item('agent_state'))).toBeNull();
  });
});
