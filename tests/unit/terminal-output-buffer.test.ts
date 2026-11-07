import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalOutputBuffer } from '$lib/components/agent-room/terminal-output-buffer.js';

function fixture() {
  const write = vi.fn((_data: string, parsed: () => void) => parsed());
  const buffer = createTerminalOutputBuffer(write);
  return { write, buffer, text: () => write.mock.calls.map(call => call[0]) };
}

describe('terminal output paint eligibility', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches invisible redraws in order and reveals only after stable visibility', () => {
    const { write, buffer, text } = fixture();
    buffer.setVisible(false);
    for (let i = 0; i < 100; i++) buffer.write(String(i) + '\r');
    expect(write).not.toHaveBeenCalled();
    buffer.setVisible(true);
    vi.advanceTimersByTime(100);
    buffer.setVisible(true);
    vi.advanceTimersByTime(116);
    expect(text()).toEqual([Array.from({ length: 100 }, (_, i) => String(i) + '\r').join('')]);
    buffer.write('live');
    vi.advanceTimersByTime(16);
    expect(text().at(-1)).toBe('live');
    buffer.dispose();
  });

  it('pauses parsing during navigation without detaching, resetting or losing live deltas', () => {
    const visibility = vi.fn(), snapshot = vi.fn(() => true);
    const text: string[] = [];
    const buffer = createTerminalOutputBuffer((data, done) => { text.push(data); done(); }, {
      onVisibilityChange: visibility, requestSnapshot: snapshot,
    });
    buffer.setVisible(true, true); buffer.write('painted screen');
    vi.advanceTimersByTime(16);
    for (let pan = 0; pan < 5; pan++) {
      buffer.setPaused(true); buffer.write(` delta-${pan}`);
      vi.advanceTimersByTime(1000);
      expect(text).toHaveLength(pan + 1);
      expect(buffer.isVisible).toBe(true);
      buffer.setPaused(false); vi.advanceTimersByTime(16);
    }
    expect(text.join('')).toBe('painted screen delta-0 delta-1 delta-2 delta-3 delta-4');
    expect(visibility.mock.calls).toEqual([[true]]);
    expect(snapshot).not.toHaveBeenCalled();
    buffer.dispose();
  });

  it('keeps paused backlogs bounded and requests a snapshot only on overflow', () => {
    const write = vi.fn((_text: string, done: () => void) => done());
    const snapshot = vi.fn(() => true);
    const buffer = createTerminalOutputBuffer(write, { requestSnapshot: snapshot });
    buffer.setVisible(true, true); buffer.setPaused(true);
    for (let i = 0; i < 20; i++) buffer.write('x'.repeat(64 * 1024));
    vi.advanceTimersByTime(1000);
    expect(buffer.pendingCharacters).toBeLessThanOrEqual(512 * 1024);
    expect(write).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
    buffer.setPaused(false);
    expect(snapshot).toHaveBeenCalledOnce();
    buffer.dispose();
  });

  it('does not replay a terminal swept past during a pan', () => {
    const { write, buffer, text } = fixture();
    buffer.write('background');
    buffer.setVisible(true);
    vi.advanceTimersByTime(150);
    buffer.setVisible(false);
    vi.advanceTimersByTime(500);
    expect(write).not.toHaveBeenCalled();
    buffer.setVisible(true, true);
    vi.advanceTimersByTime(16);
    expect(text()).toEqual(['background']);
    buffer.dispose();
  });

  it('lets focus skip the reveal delay while retaining the shared renderer frame budget', () => {
    const { buffer, text } = fixture();
    buffer.write('pending');
    buffer.setVisible(true);
    buffer.setVisible(true, true);
    vi.advanceTimersByTime(16);
    expect(text()).toEqual(['pending']);
    buffer.write('next');
    vi.advanceTimersByTime(16);
    expect(text()).toEqual(['pending', 'next']);
    buffer.dispose();
  });

  it('keeps small invisible histories in order without periodic background DOM writes', () => {
    const { write, buffer, text } = fixture();
    buffer.write('before');
    vi.advanceTimersByTime(15_000);
    buffer.write('after');
    vi.advanceTimersByTime(15_000);
    expect(write).not.toHaveBeenCalled();
    buffer.setVisible(true, true);
    vi.advanceTimersByTime(16);
    expect(text()).toEqual(['beforeafter']);
    buffer.dispose();
  });

  it('cancels scheduled work when the renderer is disposed', () => {
    const { write, buffer } = fixture();
    buffer.write('queued');
    buffer.setVisible(true);
    buffer.dispose();
    vi.advanceTimersByTime(30_000);
    buffer.write('after disposal');
    expect(write).not.toHaveBeenCalled();
  });

  it('lets an authoritative reattach replace pending output', () => {
    const { buffer, text } = fixture();
    buffer.write('already included in snapshot');
    buffer.clearPending();
    buffer.replaceSnapshot('\x1bcSNAPSHOT');
    buffer.write('new delta');
    buffer.setVisible(true, true);
    vi.advanceTimersByTime(16);
    expect(text()).toEqual(['\x1bcSNAPSHOTnew delta']);
    buffer.dispose();
  });

  it('reports only settled visibility changes so the transport can suspend output without stopping its PTY', () => {
    const visibility = vi.fn();
    const buffer = createTerminalOutputBuffer((_text, done) => done(), { onVisibilityChange: visibility });
    buffer.setVisible(true);
    vi.advanceTimersByTime(100);
    buffer.setVisible(false);
    expect(visibility).not.toHaveBeenCalled();
    buffer.setVisible(true, true);
    buffer.setVisible(false);
    buffer.setVisible(true);
    vi.advanceTimersByTime(200);
    expect(visibility.mock.calls).toEqual([[true], [false], [true]]);
    buffer.dispose();
  });
});
