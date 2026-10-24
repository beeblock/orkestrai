import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalOutputBuffer } from '$lib/components/agent-room/terminal-output-buffer.js';

describe('terminal parser backpressure', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps one parser write in flight and resynchronizes an overflowing view without replaying stale output', () => {
    const writes: string[] = [];
    const callbacks: Array<() => void> = [];
    const requestSnapshot = vi.fn(() => true);
    const buffer = createTerminalOutputBuffer((text, done) => { writes.push(text); callbacks.push(done); }, { requestSnapshot });
    buffer.setVisible(true, true);
    buffer.write('first');
    vi.runOnlyPendingTimers();
    for (let i = 0; i < 10_000; i++) buffer.write(`frame-${i}:` + 'x'.repeat(1024));
    expect(writes).toEqual(['first']);
    expect(buffer.pendingCharacters).toBeLessThanOrEqual(512 * 1024);
    expect(buffer.pendingChunks).toBeLessThanOrEqual(2048);
    callbacks.shift()!();
    vi.runOnlyPendingTimers();
    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    buffer.write('already included by the next snapshot');
    const parsed = vi.fn();
    buffer.replaceSnapshot('\x1bcFRESH', parsed);
    vi.runOnlyPendingTimers();
    expect(writes).toEqual(['first', '\x1bcFRESH']);
    callbacks.shift()!();
    expect(parsed).toHaveBeenCalledTimes(1);
    buffer.dispose();
  });

  it('does not parse invisible TUIs after minutes of output and bounds tiny chunks as well as characters', () => {
    const write = vi.fn((_text: string, done: () => void) => done());
    const requestSnapshot = vi.fn(() => true);
    const buffer = createTerminalOutputBuffer(write, { requestSnapshot });
    buffer.setVisible(false);
    for (let i = 0; i < 10_000; i++) buffer.write(String(i));
    vi.advanceTimersByTime(10 * 60_000);
    expect(write).not.toHaveBeenCalled();
    expect(requestSnapshot).not.toHaveBeenCalled();
    expect(buffer.pendingCharacters).toBeLessThanOrEqual(512 * 1024);
    expect(buffer.pendingChunks).toBeLessThanOrEqual(2048);
    buffer.setVisible(true);
    vi.advanceTimersByTime(199);
    expect(requestSnapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    buffer.dispose();
  });

  it('replays a snapshot in bounded chunks and preserves following live output and completion order', () => {
    const writes: string[] = [];
    const callbacks: Array<() => void> = [];
    const buffer = createTerminalOutputBuffer((text, done) => { writes.push(text); callbacks.push(done); });
    buffer.setVisible(true, true);
    const replay = '\x1bc' + 'a'.repeat(100_000) + '🙂\x1b[31mred';
    const parsed = vi.fn();
    buffer.replaceSnapshot(replay, parsed);
    buffer.write('LIVE');
    vi.runOnlyPendingTimers();
    expect(writes).toHaveLength(1);
    expect(parsed).not.toHaveBeenCalled();
    for (let i = 0; i < 20 && callbacks.length; i++) {
      callbacks.shift()!();
      vi.runOnlyPendingTimers();
    }
    expect(writes.join('')).toBe(replay + 'LIVE');
    expect(Math.max(...writes.map(text => text.length))).toBeLessThanOrEqual(32 * 1024);
    expect(parsed).toHaveBeenCalledTimes(1);
    expect(buffer.pendingCharacters).toBe(0);
    buffer.dispose();
  });

  it('cancels queued renderer work and ignores a late parser completion after disposal', () => {
    let complete!: () => void;
    const write = vi.fn((_text: string, done: () => void) => { complete = done; });
    const parsed = vi.fn();
    const buffer = createTerminalOutputBuffer(write);
    buffer.setVisible(true, true);
    buffer.replaceSnapshot('x'.repeat(100_000), parsed);
    vi.runOnlyPendingTimers();
    buffer.dispose();
    complete();
    vi.runAllTimers();
    expect(write).toHaveBeenCalledTimes(1);
    expect(parsed).not.toHaveBeenCalled();
  });

  it('finishes an authoritative history before resynchronizing an overflowing live stream', () => {
    const callbacks: Array<() => void> = [];
    const written: string[] = [];
    const events: string[] = [];
    const requestSnapshot = vi.fn(() => { events.push('request'); return true; });
    const buffer = createTerminalOutputBuffer((text, done) => { written.push(text); callbacks.push(done); }, { requestSnapshot });
    buffer.setVisible(true, true);
    const history = '\x1bc' + 'history'.repeat(20_000);
    buffer.replaceSnapshot(history, () => events.push('parsed'));
    vi.runOnlyPendingTimers();
    for (let i = 0; i < 2000; i++) buffer.write('live'.repeat(1024));
    expect(buffer.pendingCharacters).toBeLessThanOrEqual(512 * 1024);
    for (let i = 0; i < 30 && callbacks.length; i++) { callbacks.shift()!(); vi.runOnlyPendingTimers(); }
    expect(written.join('').startsWith(history)).toBe(true);
    expect(events).toEqual(['parsed', 'request']);
    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    buffer.dispose();
  });
});
