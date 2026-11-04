import { describe, expect, it } from 'vitest';
import { terminalWindowsPty } from '$lib/components/agent-room/terminal-windows-pty.js';

describe('Windows host terminal compatibility', () => {
  it('retains actual ConPTY compatibility independently of the viewer and shell', () => {
    expect(terminalWindowsPty({ backend: 'conpty', buildNumber: 26100 })).toEqual({ backend: 'conpty', buildNumber: 26100 });
    expect(terminalWindowsPty({ backend: 'winpty', buildNumber: 17763 })).toEqual({ backend: 'winpty', buildNumber: 17763 });
    expect(terminalWindowsPty({ backend: 'conpty', buildNumber: 19045 })).toEqual({ backend: 'conpty', buildNumber: 19045 });
  });
  it('preserves Unix defaults and rejects unknown or unbounded metadata', () => {
    for (const value of [undefined, null, {}, { backend: 'unknown' }, 'conpty']) expect(terminalWindowsPty(value)).toEqual({});
    for (const buildNumber of [NaN, Infinity, -1, 1.1, '26100', 1_000_000]) expect(terminalWindowsPty({ backend: 'conpty', buildNumber })).toEqual({ backend: 'conpty' });
  });
});
