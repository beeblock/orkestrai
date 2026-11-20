import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopSecretService } from '$lib/modules/agent-room/infrastructure/secrets/DesktopSecretService.js';
import { channelPrefixAllowed } from '$lib/modules/agent-room/domain/channels.js';
import { createChannelBindingSchema } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
afterEach(() => {
  vi.useRealTimers();
  if (originalSend) Object.defineProperty(process, 'send', originalSend);
  else delete process.send;
});

function respondAfter(ms: number) {
  const send = vi.fn((message: { requestId: string }) => {
    setTimeout(() => process.emit('message', { type: 'orkestrai:secret:result', requestId: message.requestId, value: 'verified-test-value' }), ms);
    return true;
  });
  Object.defineProperty(process, 'send', { configurable: true, writable: true, value: send });
  return send;
}

describe('initial bot setup', () => {
  it('waits for a human macOS unlock without extending background credential reads', async () => {
    vi.useFakeTimers(); respondAfter(8_000);
    const service = new DesktopSecretService();
    const setup = service.get('automation:whatsapp:test', { allowInteractiveUnlock: true });
    const background = service.get('automation:background:test');
    const rejected = expect(background).rejects.toThrow('Secure credential request timed out.');
    await vi.advanceTimersByTimeAsync(5_001); await rejected;
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(setup).resolves.toBe('verified-test-value');
  });

  it('keeps an interactive unlock bounded and reports its specific timeout', async () => {
    vi.useFakeTimers(); respondAfter(180_000);
    const request = new DesktopSecretService().get('automation:whatsapp:test', { allowInteractiveUnlock: true });
    const rejected = expect(request).rejects.toThrow('SECURE_STORAGE_UNLOCK_TIMEOUT');
    await vi.advanceTimersByTimeAsync(120_001); await rejected;
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it('filters literal prefixes before spending a model turn and preserves legacy bindings', () => {
    expect(channelPrefixAllowed({}, 'anything')).toBe(true);
    expect(channelPrefixAllowed({ replyPrefixes: [] }, 'anything')).toBe(true);
    const binding = { replyPrefixes: ['@MeuBot', '#MeuBot', '/suporte', '[help]'] };
    for (const body of ['@MeuBot investigate', '#MeuBot report', '/suporte PDF', '[help] now', '  @MeuBot file']) expect(channelPrefixAllowed(binding, body)).toBe(true);
    for (const body of ['hello', 'text before @MeuBot', '@meubot', 'x[help]', '']) expect(channelPrefixAllowed(binding, body)).toBe(false);
    const parsed = createChannelBindingSchema.safeParse({ nodeId: crypto.randomUUID(), integrationId: crypto.randomUUID(), externalChatId: 'chat', replyPrefixes: ['broken\ncommand'] });
    expect(parsed.success).toBe(false);
  });
});
