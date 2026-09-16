import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeDesktopComputer } from '$lib/modules/agent-room/infrastructure/computers/DesktopComputerClient.js';
import { nativeFailureMessages } from '$lib/modules/agent-room/application/adapters/computers/native-interaction-error.js';

const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');
const send = vi.fn();
beforeEach(() => {
  send.mockReset();
  const state = globalThis as typeof globalThis & { __orkestraiComputerHostScheduler: { unavailable: boolean; active: unknown; queue: unknown[] } };
  state.__orkestraiComputerHostScheduler.unavailable = false;
  state.__orkestraiComputerHostScheduler.active = null;
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: send });
});
afterEach(() => {
  process.emit('disconnect');
  for (const [name, descriptor] of [['send', originalSend], ['connected', originalConnected]] as const) {
    if (descriptor) Object.defineProperty(process, name, descriptor);
    else Reflect.deleteProperty(process, name);
  }
  vi.useRealTimers();
});

describe('Private Computer host IPC', () => {
  it('has no fallback to an external daemon when the desktop connection is missing', async () => {
    Object.defineProperty(process, 'connected', { configurable: true, value: false });
    await expect(executeDesktopComputer({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    expect(send).not.toHaveBeenCalled();
  });
  it('coalesces simultaneous inspections instead of failing the visible Computer panel as busy', async () => {
    const request = executeDesktopComputer({ operation: 'snapshot' });
    const message = send.mock.calls[0][0];
    const shared = executeDesktopComputer({ operation: 'snapshot' });
    expect(send).toHaveBeenCalledOnce();
    process.emit('message', { type: 'orkestrai:computer:result', requestId: 'not-ours', result: 'wrong' });
    process.emit('message', { type: 'orkestrai:computer:result', requestId: message.requestId, result: 'ours' });
    await expect(request).resolves.toBe('ours');
    await expect(shared).resolves.toBe('ours');
  });
  it('serializes different observations and prioritizes one action without replay or stale read reuse', async () => {
    const snapshot = executeDesktopComputer({ operation: 'snapshot' });
    const read = executeDesktopComputer({ operation: 'read', targetId: '12:cg:34', appId: 'com.test.app' });
    const action = executeDesktopComputer({ operation: 'type', text: 'private' });
    const fresh = executeDesktopComputer({ operation: 'snapshot' });
    await expect(executeDesktopComputer({ operation: 'shortcut', keys: ['enter'] })).rejects.toMatchObject({ inputAttempted: false });
    expect(send).toHaveBeenCalledOnce();
    const finish = async (index: number, result: string) => {
      process.emit('message', { type: 'orkestrai:computer:result', requestId: send.mock.calls[index][0].requestId, result });
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    await finish(0, 'before');
    expect(send.mock.calls[1][0].request.operation).toBe('type');
    await finish(1, 'sent');
    expect(send.mock.calls[2][0].request.operation).toBe('read');
    await finish(2, 'tree');
    expect(send.mock.calls[3][0].request.operation).toBe('snapshot');
    await finish(3, 'after');
    expect(await Promise.all([snapshot, read, action, fresh])).toEqual(['before', 'tree', 'sent', 'after']);
  });
  it('does not execute waiting observations or actions after an uncertain native timeout', async () => {
    vi.useFakeTimers();
    const request = executeDesktopComputer({ operation: 'type', text: 'private' });
    const read = executeDesktopComputer({ operation: 'snapshot' });
    const rejected = expect(request).rejects.toMatchObject({ inputAttempted: true });
    const waiting = expect(read).rejects.toMatchObject({ inputAttempted: false });
    await vi.advanceTimersByTimeAsync(25_000);
    await Promise.all([rejected, waiting]);
    await expect(executeDesktopComputer({ operation: 'shortcut', keys: ['enter'] })).rejects.toMatchObject({ inputAttempted: false });
    expect(send).toHaveBeenCalledOnce();
  });
  it('admits fresh work after the exact late settled acknowledgement without replaying uncertain input', async () => {
    vi.useFakeTimers();
    const rejected = expect(executeDesktopComputer({ operation: 'shortcut', keys: ['enter'] })).rejects.toMatchObject({ inputAttempted: true });
    const staleRead = expect(executeDesktopComputer({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    const id = send.mock.calls[0][0].requestId;
    await vi.advanceTimersByTimeAsync(25_000);
    await Promise.all([rejected, staleRead]);
    process.emit('message', { type: 'orkestrai:computer:result', requestId: 'unrelated', settled: true });
    process.emit('message', { type: 'orkestrai:computer:result', requestId: id, settled: false });
    await expect(executeDesktopComputer({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    process.emit('message', { type: 'orkestrai:computer:result', requestId: id, error: 'expired', settled: true });
    expect(send).toHaveBeenCalledOnce();
    const fresh = executeDesktopComputer({ operation: 'snapshot' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].request).toEqual({ operation: 'snapshot' });
    process.emit('message', { type: 'orkestrai:computer:result', requestId: send.mock.calls[1][0].requestId, result: 'fresh state', settled: true });
    await expect(fresh).resolves.toBe('fresh state');
  });
  it('never accepts a late readiness acknowledgement after the parent disconnected', async () => {
    vi.useFakeTimers();
    const rejected = expect(executeDesktopComputer({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    const id = send.mock.calls[0][0].requestId;
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    process.emit('disconnect');
    process.emit('message', { type: 'orkestrai:computer:result', requestId: id, settled: true });
    await expect(executeDesktopComputer({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    expect(send).toHaveBeenCalledOnce();
  });
  it('preserves native not-attempted classification but never propagates native error text', async () => {
    const request = executeDesktopComputer({ operation: 'type', text: 'private' });
    const rejected = expect(request).rejects.toMatchObject({ inputAttempted: false, message: 'The embedded Computer operation could not be confirmed.' });
    process.emit('message', { type: 'orkestrai:computer:result', requestId: send.mock.calls[0][0].requestId, error: 'private echoed text', inputAttempted: false });
    await rejected;
  });
  it('classifies a lost mutation response as uncertain and does not retry it', async () => {
    vi.useFakeTimers();
    const request = executeDesktopComputer({ operation: 'shortcut', keys: ['enter'] });
    const rejected = expect(request).rejects.toMatchObject({ inputAttempted: true });
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(send).toHaveBeenCalledOnce();
  });
  it.each(Object.entries(nativeFailureMessages))('preserves safe %s diagnostics without raw native text', async (code, message) => {
    const request = executeDesktopComputer({ operation: 'type', text: 'private input' });
    const rejected = expect(request).rejects.toMatchObject({ inputAttempted: true, code, message });
    process.emit('message', { type: 'orkestrai:computer:result', requestId: send.mock.calls[0][0].requestId, error: 'secret from native driver', failureCode: code, inputAttempted: true });
    await rejected;
    expect(send).toHaveBeenCalledOnce();
  });
  it.each(['__proto__', 'toString', 'private input', { code: 'draft_unconfirmed' }])('discards unrecognized diagnostic fields: %s', async failureCode => {
    const request = executeDesktopComputer({ operation: 'type', text: 'private input' });
    const rejected = expect(request).rejects.toMatchObject({ code: undefined, message: 'The embedded Computer operation could not be confirmed.' });
    process.emit('message', { type: 'orkestrai:computer:result', requestId: send.mock.calls[0][0].requestId, error: 'private native output', failureCode });
    await rejected;
  });
  it('rejects pending input conservatively on host disconnect', async () => {
    const request = executeDesktopComputer({ operation: 'type', text: 'private' });
    const rejected = expect(request).rejects.toMatchObject({ inputAttempted: true });
    process.emit('disconnect');
    await rejected;
  });
});
