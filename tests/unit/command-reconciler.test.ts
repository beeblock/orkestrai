import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileCommands } from '$lib/components/agent-room/command-reconciler.js';

describe('Portal command reconciliation', () => {
  beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
  it('recovers startup errors, wakes immediately and coalesces overlapping events', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(undefined);
    const reconciler = reconcileCommands(run);
    try {
      await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000); expect(run).toHaveBeenCalledTimes(1);
      let release!: () => void;
      run.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
      const pending = reconciler.wake(); await Promise.resolve();
      void reconciler.wake(); void reconciler.wake();
      expect(run).toHaveBeenCalledTimes(2);
      release(); await pending; expect(run).toHaveBeenCalledTimes(3);
    } finally { reconciler.dispose(); }
  });
  it('aborts requests on disposal and cancels all fallback work', async () => {
    let signal!: AbortSignal;
    const run = vi.fn(async (value: AbortSignal) => { signal = value; });
    const reconciler = reconcileCommands(run);
    await vi.advanceTimersByTimeAsync(0);
    await reconciler.wake(); // completed signals need not be aborted
    const pending = reconciler.wake(); await Promise.resolve();
    reconciler.dispose(); expect(signal.aborted).toBe(true); await pending;
    const count = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000); await reconciler.wake();
    expect(run).toHaveBeenCalledTimes(count);
  });
});
