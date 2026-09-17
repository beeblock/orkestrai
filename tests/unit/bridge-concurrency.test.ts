import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { agentTerminalDeliveryService } from '$lib/modules/agent-room/application/services/AgentTerminalDeliveryService.js';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { Event } from '@beeblock/svelar/events';

describe('agent conversation concurrency', () => {
  let bridge: BridgeService;
  const replies = new Map<string, string>();
  let delivered: string[];
  const content = (prompt: string) => prompt.replace(/^\[orkestrai:message:[^\]]+\] /, '');
  const rawDeliveries: Array<{ nodeId: string; message: string }> = [];
  const agents = ['leader', 'claude', 'codex'].map((id) => ({
    nodeId: id, title: id, provider: id === 'claude' ? 'claude' : 'codex', command: id,
    sessionId: `pty-${id}`, sessionAlive: true, maestro: id === 'leader',
  }));

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new BridgeService();
    replies.clear();
    delivered = [];
    rawDeliveries.length = 0;
    vi.spyOn(bridge, 'listAgents').mockResolvedValue(agents);
    vi.spyOn(bridge as any, 'ensureEdge').mockResolvedValue(undefined);
    vi.spyOn(bridge as any, 'transcriptReply').mockImplementation(async (_ws: any, node: any, _pty: any, prompt: any) => {
      const reply = replies.get(`${node}:${prompt}`) ?? replies.get(`${node}:${content(prompt)}`);
      return reply ? { sessionId: node, text: reply, complete: true } : null;
    });
    vi.spyOn(ptySessionManager, 'get').mockImplementation((id) => ({
      id, provider: 'codex', hasOutput: true, waiting: true, createdAt: new Date(Date.now() - 60_000).toISOString(),
    }) as any);
    vi.spyOn(ptySessionManager, 'attach').mockReturnValue({ detach() {}, scrollback: '' } as any);
    vi.spyOn(ptySessionManager, 'hasReachedInitialIdle').mockReturnValue(true);
    vi.spyOn(agentTerminalDeliveryService, 'deliver').mockImplementation(async (input) => {
      rawDeliveries.push(input);
      delivered.push(`${input.nodeId}:${content(input.message)}`);
    });
    vi.spyOn(controlCenterService, 'recordDelivery').mockResolvedValue(undefined as never);
    vi.spyOn(controlCenterService, 'recordActivity').mockResolvedValue(undefined as never);
    vi.spyOn(Event, 'dispatch').mockResolvedValue(undefined as never);
  });

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('delivers the next provider message without waiting for the previous model response', async () => {
    const first = bridge.ask('workspace', { from: 'claude', to: 'leader', message: 'first' });
    await vi.advanceTimersByTimeAsync(1);
    const second = bridge.ask('workspace', { from: 'codex', to: 'leader', message: 'second', maxQueueWaitMs: 40 });
    await vi.advanceTimersByTimeAsync(50);
    expect(delivered).toEqual(['leader:first', 'leader:second']);
    replies.set('leader:second', 'second response');
    replies.set('leader:first', 'first response');
    await vi.advanceTimersByTimeAsync(750);
    expect(await first).toMatchObject({ reply: 'first response', replyConfirmed: true });
    expect(await second).toMatchObject({ reply: 'second response', replyConfirmed: true });
  });

  it('unblocks a leader waiting on an agent when that agent asks the leader back', async () => {
    const outgoing = bridge.ask('workspace', { from: 'leader', to: 'claude', message: 'Review this change' });
    await vi.advanceTimersByTimeAsync(1);
    const incoming = bridge.ask('workspace', { from: 'claude', to: 'leader', message: 'Which branch?' });
    await vi.advanceTimersByTimeAsync(1);
    expect(await outgoing).toMatchObject({ reply: 'Which branch?', replyConfirmed: true, delivered: true });
    expect(delivered).toEqual(['claude:Review this change', 'leader:Which branch?']);
    expect(controlCenterService.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({
      state: 'replied', metadata: expect.objectContaining({ replySource: 'agent_message', replyMessageId: expect.any(String) }),
    }));
    replies.set('leader:Which branch?', 'Use feature/review');
    await vi.advanceTimersByTimeAsync(750);
    expect(await incoming).toMatchObject({ reply: 'Use feature/review', replyConfirmed: true });
  });

  it('does not wait for a warm working provider to become idle again', async () => {
    vi.spyOn(ptySessionManager, 'get').mockReturnValue({
      provider: 'codex', hasOutput: true, waiting: false, createdAt: new Date(Date.now() - 60_000).toISOString(),
    } as any);
    const reply = bridge.ask('workspace', { from: 'claude', to: 'leader', message: 'Busy leader' });
    await vi.advanceTimersByTimeAsync(1);
    expect(delivered).toEqual(['leader:Busy leader']);
    replies.set('leader:Busy leader', 'Received while working');
    await vi.advanceTimersByTimeAsync(750);
    expect((await reply).replyConfirmed).toBe(true);
  });

  it('correlates identical concurrent prompts by distinct message ids', async () => {
    const first = bridge.ask('workspace', { from: 'claude', to: 'leader', message: 'Status?' });
    await vi.advanceTimersByTimeAsync(1);
    const second = bridge.ask('workspace', { from: 'codex', to: 'leader', message: 'Status?' });
    await vi.advanceTimersByTimeAsync(1);
    expect(rawDeliveries).toHaveLength(2);
    expect(rawDeliveries[0].message).not.toBe(rawDeliveries[1].message);
    replies.set(`leader:${rawDeliveries[0].message}`, 'First status');
    replies.set(`leader:${rawDeliveries[1].message}`, 'Second status');
    await vi.advanceTimersByTimeAsync(750);
    expect((await first).reply).toBe('First status');
    expect((await second).reply).toBe('Second status');
  });

  it('records an offline recipient as failed rather than leaving a queued delivery', async () => {
    vi.mocked(bridge.listAgents).mockResolvedValue(agents.map((agent) => ({ ...agent, sessionAlive: false })));
    await expect(bridge.ask('workspace', { from: 'claude', to: 'leader', message: 'Offline question' })).rejects.toThrow();
    expect(controlCenterService.recordDelivery).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'failed', content: 'Offline question',
    }));
    expect(delivered).toHaveLength(0);
    expect((bridge as any).pendingReplies.size).toBe(0);
  });

  it('cancels response tracking without confirming a reply or blocking later messages', async () => {
    const controller = new AbortController();
    const aborted = bridge.ask('workspace', { from: 'claude', to: 'leader', message: 'Cancelled question', signal: controller.signal });
    const rejected = expect(aborted).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(750);
    await rejected;
    expect(controlCenterService.recordDelivery).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'failed', metadata: expect.objectContaining({ cancelled: true }),
    }));
    expect((bridge as any).pendingReplies.size).toBe(0);
    const next = bridge.ask('workspace', { from: 'codex', to: 'leader', message: 'Next question' });
    replies.set('leader:Next question', 'Next answer');
    await vi.advanceTimersByTimeAsync(750);
    expect((await next).reply).toBe('Next answer');
  });

  it('cancels before submission without waiting forever for a transcript', async () => {
    vi.mocked(agentTerminalDeliveryService.deliver).mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = bridge.ask('workspace', { from: 'claude', to: 'leader', message: 'Waiting for composer', signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(750);
    await rejected;
    expect((bridge as any).pendingReplies.size).toBe(0);
    const next = bridge.ask('workspace', { from: 'codex', to: 'leader', message: 'After cancellation' });
    replies.set('leader:After cancellation', 'Ready');
    await vi.advanceTimersByTimeAsync(750);
    expect((await next).reply).toBe('Ready');
  });

  it('does not resolve another workspace or another agent using an unrelated message', async () => {
    const first = bridge.ask('one', { from: 'leader', to: 'claude', message: 'Scoped question' });
    await vi.advanceTimersByTimeAsync(1);
    let resolved = false;
    void first.then(() => { resolved = true; });
    const other = bridge.ask('two', { from: 'claude', to: 'leader', message: 'Unrelated' });
    const third = bridge.ask('one', { from: 'codex', to: 'leader', message: 'Third agent' });
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);
    replies.set('claude:Scoped question', 'Scoped answer');
    replies.set('leader:Unrelated', 'Other answer');
    replies.set('leader:Third agent', 'Third answer');
    await vi.advanceTimersByTimeAsync(750);
    expect((await first).reply).toBe('Scoped answer');
    await Promise.all([other, third]);
  });
});
