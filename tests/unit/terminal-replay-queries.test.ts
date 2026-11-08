import { afterEach, expect, it, vi } from 'vitest';
import { Terminal } from '@xterm/headless';
import { tmpdir } from 'node:os';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

afterEach(() => vi.useRealTimers());

it.each(['attach', 'replay'])('%s paints the viewer without sending a historical cursor query back as an owner edit', async source => {
  vi.useFakeTimers();
  const writes: string[] = [];
  let emit = (_: string) => {};
  const manager = new PtySessionManager((() => ({ pid: -1, cols: 80, rows: 24,
    write: (data: string) => writes.push(data), resize() {}, kill() {},
    onData: (callback: typeof emit) => { emit = callback; return { dispose() {} }; },
    onExit: () => ({ dispose() {} }),
  })) as never, () => {});
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 0 });
  const session = manager.create({ command: 'codex', provider: 'codex', cwd: tmpdir() });
  terminal.onData(data => manager.writeHumanInput(session.id, data));
  async function parse(data: string) {
    let parsed = false;
    terminal.write(data, () => { parsed = true; });
    await vi.advanceTimersByTimeAsync(20);
    expect(parsed).toBe(true);
  }
  try {
    emit('› \r\n100% context left');
    await vi.advanceTimersByTimeAsync(6000);
    const text = 'An owned, automatic message. '.repeat(100).trim();
    const delivery = manager.queueWithSubmit(session.id, text, 10, true, async () => false);
    await vi.advanceTimersByTimeAsync(6000);
    await delivery.submitted;
    const at = manager.automaticDeliverySubmittedAt(session.id)!;
    emit(`\x1b[20;3H[Pasted Content ${text.length} chars]\x1b[20;30H`);
    emit('\x1b[6n');
    await parse('\x1b[6n');
    expect(writes.filter(data => /\x1b\[\d+;\d+R/.test(data))).toHaveLength(1);
    const snapshot = source === 'attach' ? manager.attach(session.id, () => {}).scrollback : manager.replay(session.id);
    await parse(`\x1bc${snapshot}`);
    await vi.advanceTimersByTimeAsync(6000);
    // A viewer snapshot must paint the screen, never answer old CLI queries.
    expect(writes.filter(data => /\x1b\[\d+;\d+R/.test(data))).toHaveLength(1);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    expect(writes.filter(data => data.includes(text))).toHaveLength(1);
  } finally {
    terminal.dispose();
    manager.killAll();
  }
});
