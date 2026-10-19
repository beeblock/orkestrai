import { describe, expect, it } from 'vitest';
import { applyTerminalModes, terminalModePrefix, trimScrollback } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

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
});
