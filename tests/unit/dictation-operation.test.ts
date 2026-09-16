import { afterEach, describe, expect, it, vi } from 'vitest';
import { DictationOperation } from '../../src/lib/components/agent-room/dictation-operation.js';

describe('DictationOperation', () => {
  afterEach(() => vi.useRealTimers());

  it('times out even when capture initialization ignores cancellation', async () => {
    vi.useFakeTimers();
    const operation = new DictationOperation();
    operation.deadline(15_000);
    const pending = operation.wait(new Promise<void>(() => {}));
    const result = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(operation.signal.aborted).toBe(true);
  });

  it('releases a microphone returned after cancellation without starting capture', async () => {
    const operation = new DictationOperation();
    let resolve!: (value: { stop: () => void }) => void;
    const source = new Promise<{ stop: () => void }>((done) => { resolve = done; });
    const discard = vi.fn((value: { stop: () => void }) => value.stop());
    const result = expect(operation.wait(source, discard)).rejects.toMatchObject({ name: 'AbortError' });
    operation.cancel();
    await result;
    const stop = vi.fn();
    resolve({ stop });
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('never inserts a late transcript from a cancelled attempt', async () => {
    const operation = new DictationOperation();
    let resolve!: (value: string) => void;
    const insert = vi.fn();
    const pending = operation.wait(new Promise<string>((done) => { resolve = done; })).then(insert);
    const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    operation.cancel();
    resolve('old text');
    await result;
    expect(insert).not.toHaveBeenCalled();
    await expect(new DictationOperation().wait(Promise.resolve('new text'))).resolves.toBe('new text');
  });

  it('clears the startup deadline while the user is recording', async () => {
    vi.useFakeTimers();
    const operation = new DictationOperation();
    operation.deadline(15_000);
    await expect(operation.wait(Promise.resolve(true))).resolves.toBe(true);
    operation.deadline(null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(operation.signal.aborted).toBe(false);
    operation.deadline(180_000);
    const result = expect(operation.wait(new Promise<void>(() => {}))).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(180_000);
    await result;
  });
});
