import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalOutputBuffer } from '$lib/components/agent-room/terminal-output-buffer.js';

describe('terminal rendering when browser animation frames are delayed', () => {
  let documentState: EventTarget & { visibilityState: string };
  let frames: Map<number, FrameRequestCallback>;
  let buffers: ReturnType<typeof createTerminalOutputBuffer>[];

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    buffers = [];
    let next = 0;
    documentState = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', documentState);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++next;
      frames.set(id, time => { frames.delete(id); callback(time); });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => {
    for (const buffer of buffers) buffer.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function terminal() {
    const write = vi.fn((_data: string, parsed: () => void) => parsed());
    const buffer = createTerminalOutputBuffer(write);
    buffers.push(buffer);
    buffer.setVisible(true, true);
    return { buffer, write };
  }

  it('delivers eight eligible screens within the deadline with the same two-write budget', () => {
    const terminals = Array.from({ length: 8 }, (_, index) => {
      const item = terminal();
      item.buffer.write(`screen-${index}`);
      return item;
    });
    const count = () => terminals.reduce((sum, item) => sum + item.write.mock.calls.length, 0);
    vi.advanceTimersByTime(49);
    expect(count()).toBe(0);
    for (let batch = 1; batch <= 4; batch++) {
      vi.advanceTimersByTime(batch === 1 ? 1 : 50);
      expect(count()).toBe(batch * 2);
    }
    expect(terminals.map(item => item.write.mock.calls[0][0])).toEqual(
      Array.from({ length: 8 }, (_, index) => `screen-${index}`),
    );
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never parses output in a hidden application and resumes when it becomes visible', () => {
    const { buffer, write } = terminal();
    buffer.write('visible again');
    const hiddenFrame = frames.values().next().value!;
    documentState.visibilityState = 'hidden';
    documentState.dispatchEvent(new Event('visibilitychange'));
    hiddenFrame(0);
    vi.advanceTimersByTime(60_000);
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    documentState.visibilityState = 'visible';
    documentState.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(50);
    expect(write).toHaveBeenCalledExactlyOnceWith('visible again', expect.any(Function));
  });

  it('does not wake a background application when output is first queued there', () => {
    documentState.visibilityState = 'hidden';
    const { buffer, write } = terminal();
    buffer.write('background output');
    vi.advanceTimersByTime(60_000);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(write).not.toHaveBeenCalled();
    buffer.dispose();
    documentState.visibilityState = 'visible';
    documentState.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the deadline when a normal animation frame arrives', () => {
    const { buffer, write } = terminal();
    buffer.write('normal frame');
    const callback = frames.values().next().value!;
    callback(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    callback(100);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('ignores a late animation callback after its deadline already delivered', () => {
    const { buffer, write } = terminal();
    buffer.write('first');
    const late = frames.values().next().value!;
    vi.advanceTimersByTime(50);
    expect(write).toHaveBeenCalledTimes(1);
    buffer.write('second');
    late(51);
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(write.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
  });

  it('releases the deadline, frame and visibility subscription on disposal', () => {
    const remove = vi.spyOn(documentState, 'removeEventListener');
    const { buffer, write } = terminal();
    buffer.write('disposed');
    buffer.dispose();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    vi.advanceTimersByTime(60_000);
    documentState.dispatchEvent(new Event('visibilitychange'));
    expect(write).not.toHaveBeenCalled();
  });
});
