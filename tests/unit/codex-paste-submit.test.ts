import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { frameAutomaticPaste, hasOwnedCodexPaste } from '$lib/modules/agent-room/application/adapters/interactive-startup.ts';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('Codex automatic paste on ConPTY', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const stop of cleanup.splice(0)) stop(); vi.useRealTimers(); });

  it('uses explicit paste boundaries when ConPTY consumes the mode announcement, without changing shells', () => {
    expect(frameAutomaticPaste('codex', false, true, 'hello')).toBe('\x1b[200~hello\x1b[201~');
    expect(frameAutomaticPaste(null, false, true, 'hello')).toBe('hello');
    expect(frameAutomaticPaste('unknown', false, true, 'hello')).toBe('hello');
    expect(frameAutomaticPaste('codex', false, false, 'hello')).toBe('hello');
    expect(frameAutomaticPaste('codex', true, false, 'hello')).toBe('\x1b[200~hello\x1b[201~');
  });

  it('recognizes the actual Codex placeholder, including Unicode counts and repeated-size suffixes', () => {
    expect(hasOwnedCodexPaste('› [Pasted Content 3 chars]', 'a😃b')).toBe(true);
    expect(hasOwnedCodexPaste('› [Pasted Content 3 chars] #2', 'a😃b')).toBe(true);
    expect(hasOwnedCodexPaste('\x1b[28;3H\x1b[38;5;6m[Pasted Content 3 chars]\x1b[0m\x1b[28;30H\x1b[?25h', 'a😃b')).toBe(true);
    for (const output of ['› [Pasted Content 4 chars]', '› a human draft [Pasted Content 3 chars]',
      '› [Pasted Content 3 chars] + changed', '› [Pasted Content 3 chars] [Pasted Content 3 chars]',
      '› [Pasted Content 3 chars]\r\nAnswer\r\n› ', '[Pasted Content 3 chars]\x1b[2J',
      '[Pasted Content 3 chars]\x1b[1G\x1b[K', 'No composer']) {
      expect(hasOwnedCodexPaste(output, 'a😃b'), output).toBe(false);
    }
  });

  async function fixture() {
    vi.useFakeTimers();
    const writes: string[] = []; let emit = (_: string) => {};
    const manager = new PtySessionManager((() => ({ pid: -1, cols: 120, rows: 30,
      write: (text: string) => { writes.push(text); }, resize() {}, kill() {},
      onData: (callback: typeof emit) => { emit = callback; return { dispose() {} }; }, onExit: () => ({ dispose() {} }),
    })) as never, () => {});
    const session = manager.create({ command: 'codex', provider: 'codex', cwd: tmpdir() });
    cleanup.push(() => manager.kill(session.id));
    const internal = (manager as any).sessions.get(session.id);
    internal.conptySubmitGuard = true;
    emit('› \r\n100% context left');
    await vi.advanceTimersByTimeAsync(65 * 60_000);
    const text = 'Owned draft '.repeat(120).trimEnd();
    const delivery = manager.queueWithSubmit(session.id, text, 10, true, async () => false);
    await vi.advanceTimersByTimeAsync(2500); await delivery.submitted;
    const at = manager.automaticDeliverySubmittedAt(session.id)!;
    const badge = () => emit(`\x1b[28;3H[Pasted Content ${text.length} chars]\x1b[28;30H`);
    badge(); await vi.advanceTimersByTimeAsync(6000);
    return { manager, session, writes, at, emit, badge, text };
  }

  it('recovers an aged Windows session using Enter only, retaining the exact receipt identity', async () => {
    const { manager, session, writes, at, badge, text } = await fixture();
    expect(writes).toContain(`\x1b[200~${text}\x1b[201~`);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    expect(manager.automaticDeliverySubmittedAt(session.id)).toBe(at);
    badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
    expect(writes.filter(value => value.includes(text))).toHaveLength(1);
    expect(writes.filter(value => value === '\r')).toHaveLength(3);
  });

  it.each(['human', '\x1b[A', '\t', '\x15'])('preserves owner edits after an automatic paste (%j)', async input => {
    const { manager, session, at, badge } = await fixture();
    manager.writeHumanInput(session.id, input); badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });

  it('requires an older finished turn and fresh current composer evidence', async () => {
    const { manager, session, at, emit } = await fixture();
    expect(manager.retryPendingAutomaticPaste(session.id, at, NaN)).toBe(false);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at + 100)).toBe(false);
    emit('› \r\nnew empty composer'); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });
});
