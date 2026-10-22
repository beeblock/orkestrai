import { describe, expect, it } from 'vitest';
import { TerminalInputBuffer, terminalInputFrame } from '$lib/components/agent-room/terminal-input-buffer.js';

describe('terminal input typed before the terminal attaches', () => {
  it('replays an image paste with its mark, in order with the keys around it', () => {
    const buffer = new TerminalInputBuffer();
    buffer.push('veja ');
    buffer.push('\x16', true);
    buffer.push('\r');
    expect(buffer.drain().map((input) => terminalInputFrame('session', input))).toEqual([
      { type: 'input', sessionId: 'session', data: 'veja ' },
      { type: 'input', sessionId: 'session', data: '\x16', imagePaste: true },
      { type: 'input', sessionId: 'session', data: '\r' },
    ]);
    expect(buffer.drain()).toEqual([]);
  });

  it('drops the oldest text past the bound without stripping a newer mark', () => {
    const buffer = new TerminalInputBuffer();
    buffer.push('x'.repeat(16_384));
    buffer.push('\x16', true);
    expect(buffer.drain()).toEqual([{ data: '\x16', imagePaste: true }]);
  });
});
