import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalOutputBuffer } from '$lib/components/agent-room/terminal-output-buffer.js';

describe('terminal output paint eligibility', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches invisible TUI redraws in order and reveals once after stable visibility', () => {
    const write = vi.fn();
    const buffer = createTerminalOutputBuffer(write);
    buffer.setVisible(false);
    for (let i = 0; i < 100; i++) buffer.write(`${i}\r`);
    expect(write).not.toHaveBeenCalled();
    buffer.setVisible(true);
    vi.advanceTimersByTime(100);
    buffer.setVisible(true); // duplicate signals must not postpone reveal
    vi.advanceTimersByTime(100);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(Array.from({ length: 100 }, (_, i) => `${i}\r`).join(''));
    buffer.write('live');
    expect(write).toHaveBeenLastCalledWith('live');
    buffer.dispose();
  });

  it('does not replay a terminal merely swept past during a pan', () => {
    const write = vi.fn();
    const buffer = createTerminalOutputBuffer(write);
    buffer.setVisible(false);
    buffer.write('background');
    buffer.setVisible(true);
    vi.advanceTimersByTime(150);
    buffer.setVisible(false);
    vi.advanceTimersByTime(500);
    expect(write).not.toHaveBeenCalled();
    buffer.setVisible(true, true);
    expect(write).toHaveBeenCalledWith('background');
    buffer.dispose();
  });

  it('flushes immediately on focus without stopping or dropping input/output', () => {
    const write = vi.fn();
    const buffer = createTerminalOutputBuffer(write);
    buffer.setVisible(false);
    buffer.write('pending');
    buffer.setVisible(true);
    buffer.setVisible(true, true);
    expect(write).toHaveBeenCalledWith('pending');
    buffer.write('next');
    expect(write).toHaveBeenLastCalledWith('next');
    buffer.dispose();
  });

  it('keeps the existing periodic and overflow bounds for background parsing', () => {
    const write = vi.fn();
    const buffer = createTerminalOutputBuffer(write);
    buffer.setVisible(false);
    buffer.write('periodic');
    vi.advanceTimersByTime(14_999);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledWith('periodic');
    buffer.write('a'.repeat(1_000_001));
    expect(write).toHaveBeenCalledTimes(2);
    buffer.dispose();
  });

  it('cancels all scheduled writes when the renderer is disposed', () => {
    const write = vi.fn();
    const buffer = createTerminalOutputBuffer(write);
    buffer.setVisible(false);
    buffer.write('queued');
    buffer.setVisible(true);
    buffer.dispose();
    vi.advanceTimersByTime(30_000);
    buffer.write('after disposal');
    expect(write).not.toHaveBeenCalled();
  });

  it('lets an authoritative reattach snapshot supersede pending output', () => {
    const write = vi.fn();
    const buffer = createTerminalOutputBuffer(write);
    buffer.setVisible(false);
    buffer.write('old output already included in snapshot');
    buffer.clearPending();
    buffer.write('new delta');
    buffer.setVisible(true, true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('new delta');
    buffer.dispose();
  });
});
