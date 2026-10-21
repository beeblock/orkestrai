import { describe, expect, it } from 'vitest';
import { applyTerminalModes, replayTail, terminalModePrefix, trimScrollback } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

const ENTER_TUI = '\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?25l';

describe('terminal modes across a trimmed scrollback', () => {
  it('restores the screen, mouse and paste modes of an agent whose start no longer fits', () => {
    const modes = new Map<string, boolean>();
    let scrollback = '';
    // An agent TUI enters the alternate screen with mouse reporting, then redraws for a long time.
    for (const chunk of [ENTER_TUI, ...Array.from({ length: 400 }, (_, index) => `\x1b[H\x1b[2Kworking ${index} ${'.'.repeat(80)}`)]) {
      const retained = trimScrollback(scrollback + chunk, 4_096);
      if (retained.dropped) applyTerminalModes(modes, retained.dropped);
      scrollback = retained.kept;
    }
    expect(scrollback).not.toContain('\x1b[?1049h');
    expect(terminalModePrefix(modes)).toBe('\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?25l');
  });

  it('follows modes the agent turned off again and adds nothing for a plain shell', () => {
    const modes = new Map<string, boolean>();
    applyTerminalModes(modes, `${ENTER_TUI}output\x1b[?1000l\x1b[?1049l\x1b[?25h`);
    expect(terminalModePrefix(modes)).toBe('\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h');
    expect(terminalModePrefix(new Map())).toBe('');
  });

  it('never cuts an escape sequence in two', () => {
    const text = `${'a'.repeat(100)}\x1b[?1049h${'b'.repeat(100)}`;
    const { kept, dropped } = trimScrollback(text, 104);
    expect(kept.startsWith('\x1b[?1049h')).toBe(true);
    expect(dropped + kept).toBe(text);
    expect(trimScrollback('short', 10)).toEqual({ kept: 'short', dropped: '' });
  });

  it('replays a tail with the modes set before it, for a remote viewer that gets only recent output', () => {
    // The agent entered its TUI within the retained scrollback, long before the tail.
    const scrollback = `prompt$ claude\r\n${ENTER_TUI}${'\x1b[H\x1b[2Kredraw '.repeat(2_000)}`;
    const tail = replayTail(new Map(), scrollback, 1_000);
    expect(tail.startsWith('\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?25l')).toBe(true);
    expect(tail.endsWith(scrollback.slice(-200))).toBe(true);
    expect(tail.length).toBeLessThan(1_000 + 200);
  });

  it('keeps modes from output the scrollback already dropped, and adds nothing to a short plain session', () => {
    const trimmed = new Map<string, boolean>();
    applyTerminalModes(trimmed, '\x1b[?1049h\x1b[?1006h');
    expect(replayTail(trimmed, 'recent output', 1_000)).toBe('\x1b[?1049h\x1b[?1006hrecent output');
    expect(replayTail(new Map(), 'plain shell', 1_000)).toBe('plain shell');
    // A mode switched off inside the dropped part stays off.
    expect(replayTail(trimmed, `\x1b[?1006l${'x'.repeat(2_000)}`, 100)).toBe(`\x1b[?1049h${'x'.repeat(100)}`);
  });
});
