import { describe, expect, it } from 'vitest';
import { TerminalInputBuffer, TerminalInputProvenance, terminalInputFrame } from '$lib/components/agent-room/terminal-input-buffer.js';

describe('terminal input typed before the terminal attaches', () => {
  it('distinguishes a modified F3 key from an identical automatic cursor reply', () => {
    const provenance = new TerminalInputProvenance();
    provenance.noteKey('\x1b[1;2R');
    expect(provenance.consume('\x1b[1;2R')).toBe('keyboard');
    expect(provenance.consume('\x1b[1;2R')).toBe('terminal');
    expect(provenance.consume('IME or pasted text')).toBe('terminal');
  });

  it('preserves the key provenance across a reconnect', () => {
    const buffer = new TerminalInputBuffer();
    buffer.push('\x1b[1;2R', false, 'keyboard');
    expect(buffer.drain().map(input => terminalInputFrame('session', input))).toEqual([
      { type: 'input', sessionId: 'session', data: '\x1b[1;2R', source: 'keyboard' },
    ]);
  });
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
