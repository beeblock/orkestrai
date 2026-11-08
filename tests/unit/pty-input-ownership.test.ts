import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('human input while an automatic message owns the composer', () => {
  const managers: PtySessionManager[] = [];
  afterEach(() => { for (const manager of managers.splice(0)) manager.killAll(); vi.useRealTimers(); });

  async function terminal(provider: 'codex' | 'claude' = 'codex', runtime: 'native' | 'wsl' = 'native') {
    vi.useFakeTimers();
    const writes: string[] = [];
    let emit!: (data: string) => void;
    const manager = new PtySessionManager((() => ({ pid: -1, cols: 120, rows: 30,
      write: (data: string) => writes.push(data), resize() {}, kill() {},
      onData: (fn: typeof emit) => { emit = fn; return { dispose() {} }; }, onExit: () => ({ dispose() {} }),
    })) as never, () => {});
    managers.push(manager);
    const session = manager.create({ command: provider, provider, cwd: tmpdir(),
      ...(runtime === 'wsl' ? { runtime: { kind: 'wsl', distribution: 'Ubuntu', linuxWorkingDir: '/project' } as const } : {}) });
    (manager as any).sessions.get(session.id).conptySubmitGuard = true;
    emit(provider === 'codex' ? '\x1b]7501;state=idle:app=codex\x1b\\' : '❯ \r\nbypass permissions on');
    await vi.advanceTimersByTimeAsync(3000);
    return { manager, session, writes, emit };
  }

  async function fixture(provider: 'codex' | 'claude' = 'codex', runtime: 'native' | 'wsl' = 'native') {
    const { manager, session, writes, emit } = await terminal(provider, runtime);
    let accepted = false;
    const text = 'Owned automatic message';
    const delivery = manager.queueWithSubmit(session.id, text, 500, true, async () => accepted);
    void delivery.submitted.catch(() => {});
    await vi.advanceTimersByTimeAsync(20);
    return { manager, session, writes, emit, delivery, text, accept: () => { accepted = true; delivery.acknowledge(); } };
  }

  it.each([
    ['codex', 'native'], ['claude', 'native'], ['codex', 'wsl'], ['claude', 'wsl'],
  ] as const)('does not append owner keys after a lost %s/%s Enter until the exact receipt', async (provider, runtime) => {
    const f = await fixture(provider, runtime);
    f.manager.writeHumanInput(f.session.id, 'my draft');
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    expect(f.writes).not.toContain('my draft');
    f.emit(provider === 'codex' ? `› [Pasted Content ${f.text.length} chars]` : '❯ [Pasted text #1]');
    await vi.advanceTimersByTimeAsync(6000);
    const at = f.manager.automaticDeliverySubmittedAt(f.session.id)!;
    expect(f.manager.retryPendingAutomaticPaste(f.session.id, at, at - 1)).toBe(true);
    expect(f.writes).not.toContain('my draft');
    f.accept();
    expect(f.writes.filter(data => data === 'my draft')).toHaveLength(1);
    expect(f.writes.filter(data => data.includes(f.text))).toHaveLength(1);
  });

  it('protects typing that begins after Enter but before its receipt as well', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.manager.writeHumanInput(f.session.id, 'next human line\r');
    expect(f.writes).not.toContain('next human line\r');
    f.accept();
    expect(f.writes.at(-1)).toBe('next human line');
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.writes.slice(-2)).toEqual(['next human line', '\r']);
  });

  it('does not make terminal protocol replies wait behind the paste', async () => {
    const f = await fixture();
    f.emit('\x1b[6n');
    f.manager.writeHumanInput(f.session.id, '\x1b[2;3R');
    expect(f.writes.at(-1)).toBe('\x1b[2;3R');
    f.manager.writeHumanInput(f.session.id, 'my draft');
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    expect(f.writes).not.toContain('my draft');
  });

  it.each(['\x1b[<0;12;5M', '\x1b[<0;12;5m', '\x1b[<64;12;5M'])('does not turn a mouse report into a draft or block manual Enter (%j)', async report => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.manager.writeHumanInput(f.session.id, report);
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(false);
    const before = f.writes.filter(data => data === '\r').length;
    f.manager.writeHumanInput(f.session.id, '\r');
    expect(f.writes.filter(data => data === '\r')).toHaveLength(before + 1);
    f.accept();
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(false);
  });

  it('does not let a duplicate cursor reply from a second viewer disable lost-Enter recovery', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.emit('\x1b[6n');
    f.manager.writeHumanInput(f.session.id, '\x1b[2;3R');
    f.manager.writeHumanInput(f.session.id, '\x1b[2;3R', { source: 'terminal' });
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(false);
    f.emit(`› [Pasted Content ${f.text.length} chars]`);
    await vi.advanceTimersByTimeAsync(6000);
    const at = f.manager.automaticDeliverySubmittedAt(f.session.id)!;
    expect(f.manager.retryPendingAutomaticPaste(f.session.id, at, at - 1)).toBe(true);
  });

  it('accepts a late cursor report without confusing a modified F3 key with a report', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.emit('\x1b[6n');
    await vi.advanceTimersByTimeAsync(11000);
    f.manager.writeHumanInput(f.session.id, '\x1b[1;2R', { source: 'terminal' });
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(false);
    f.emit('\x1b[6n');
    f.manager.writeHumanInput(f.session.id, '\x1b[1;2R', { source: 'keyboard' });
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(true);
  });

  it('keeps evidence-based recovery enabled after a manual Enter is lost as well', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.manager.writeHumanInput(f.session.id, '\r');
    f.emit(`› [Pasted Content ${f.text.length + 2} chars]`);
    await vi.advanceTimersByTimeAsync(6000);
    const at = f.manager.automaticDeliverySubmittedAt(f.session.id)!;
    expect(f.manager.retryPendingAutomaticPaste(f.session.id, at, at - 1)).toBe(true);
    expect(f.writes.filter(data => data.includes(f.text))).toHaveLength(1);
  });

  it('does not trust a terminal source label for printable text or a bracketed paste', async () => {
    const f = await fixture();
    for (const data of ['private draft', '\x1b[200~\x1b[2;3R\x1b[201~']) {
      f.manager.writeHumanInput(f.session.id, data, { source: 'terminal' });
      expect(f.writes).not.toContain(data);
    }
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(true);
  });

  it('keeps the owner draft ahead of the next automatic delivery', async () => {
    const f = await fixture();
    f.manager.writeHumanInput(f.session.id, 'my draft');
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    const next = f.manager.queueWithSubmit(f.session.id, 'must wait', 20);
    const cancelled = next.submitted.catch(() => {});
    f.accept();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.writes).toContain('my draft');
    expect(f.writes).not.toContain('must wait');
    next.cancel(); await cancelled;
  });

  it('leaves Ctrl+C available to discard held typing and explicitly take control', async () => {
    const f = await fixture();
    f.manager.writeHumanInput(f.session.id, 'cancel this draft');
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.manager.writeHumanInput(f.session.id, '\x03');
    f.manager.writeHumanInput(f.session.id, 'manual draft');
    expect(f.writes.slice(-2)).toEqual(['\x03', 'manual draft']);
    expect(f.writes).not.toContain('cancel this draft');
    const at = f.manager.automaticDeliverySubmittedAt(f.session.id)!;
    f.emit(`› [Pasted Content ${f.text.length} chars]`);
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.manager.retryPendingAutomaticPaste(f.session.id, at, at - 1)).toBe(false);
  });

  it('honors Ctrl+C during the paste delay without submitting the automatic message first', async () => {
    const f = await fixture();
    f.manager.writeHumanInput(f.session.id, 'discard staged keys');
    f.manager.writeHumanInput(f.session.id, '\x03');
    await expect(f.delivery.submitted).rejects.toMatchObject({ code: 'PTY_DELIVERY_UNCONFIRMED' });
    f.manager.writeHumanInput(f.session.id, 'new owner draft');
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.writes).toEqual([`\x1b[200~${f.text}\x1b[201~`, '\x03', 'new owner draft']);
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(false);
  });

  it('keeps a standalone manual Enter available without losing automatic receipt identity', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    const at = f.manager.automaticDeliverySubmittedAt(f.session.id);
    f.manager.writeHumanInput(f.session.id, '\r');
    expect(f.writes.at(-1)).toBe('\r');
    expect(f.manager.automaticDeliverySubmittedAt(f.session.id)).toBe(at);
  });

  it('lets Ctrl+C cancel an owner Enter that is waiting behind its restored body', async () => {
    const f = await fixture();
    f.manager.writeHumanInput(f.session.id, 'owner line\r');
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.accept();
    expect(f.writes.at(-1)).toBe('owner line');
    f.manager.writeHumanInput(f.session.id, '\x03');
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.writes.at(-1)).toBe('\x03');
    expect(f.writes.filter(data => data === '\r')).toHaveLength(1);
  });

  it('does not emit a delayed owner Enter after its PTY is replaced', async () => {
    const f = await fixture();
    f.manager.writeHumanInput(f.session.id, 'old owner line\r');
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.accept(); f.manager.kill(f.session.id);
    const next = f.manager.create({ command: 'codex', provider: 'codex', cwd: tmpdir() });
    f.manager.writeHumanInput(next.id, 'new owner line');
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.writes.at(-1)).toBe('new owner line');
    expect(f.writes.filter(data => data === '\r')).toHaveLength(1);
  });

  it('keeps typing immediate while an asynchronous preflight has not written paste bytes yet', async () => {
    const f = await terminal();
    let finish!: (relevant: boolean) => void;
    const validation = new Promise<boolean>(resolve => { finish = resolve; });
    const automatic = f.manager.queueWithSubmit(f.session.id, 'automatic', 20, true, async () => false, undefined, async () => validation);
    const cancelled = automatic.submitted.catch(() => {});
    f.manager.writeHumanInput(f.session.id, 'human first');
    expect(f.writes).toEqual(['human first']);
    finish(true); await vi.advanceTimersByTimeAsync(1000);
    expect(f.writes).toEqual(['human first']);
    automatic.cancel(); await cancelled;
  });

  it.each([true, false])('keeps typing separate around a newer completed turn (owner already typing: %s)', async alreadyTyping => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    if (alreadyTyping) f.manager.writeHumanInput(f.session.id, 'keep this separate');
    const at = f.manager.automaticDeliverySubmittedAt(f.session.id)!;
    expect(f.manager.hasUnconfirmedDeliveryAfterTurn(f.session.id, at, at + 1, at + 2)).toBe(true);
    if (!alreadyTyping) f.manager.writeHumanInput(f.session.id, 'keep this separate');
    expect(f.writes).not.toContain('keep this separate');
    f.accept(); expect(f.writes.at(-1)).toBe('keep this separate');
  });

  it('retains held keys and status across a viewer detach and reattachment', async () => {
    const f = await fixture();
    const seen: boolean[] = [];
    const viewer = f.manager.attach(f.session.id, () => {}, undefined, undefined, undefined, value => seen.push(value));
    f.manager.writeHumanInput(f.session.id, 'kept across reconnect');
    expect(seen).toEqual([true]); viewer.detach();
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(true);
    const next: boolean[] = [];
    f.manager.attach(f.session.id, () => {}, undefined, undefined, undefined, value => next.push(value));
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    expect(f.writes).not.toContain('kept across reconnect');
    f.accept(); expect(next).toEqual([false]);
    expect(f.writes.filter(text => text === 'kept across reconnect')).toHaveLength(1);
  });

  it('keeps an aborted caller uncertain and only releases held input on a later receipt', async () => {
    const f = await terminal();
    const controller = new AbortController(); let accepted = false;
    const send = f.manager.writeWithConfirmedSubmit(f.session.id, 'automatic', {
      signal: controller.signal, isAccepted: async () => accepted, confirmationWindowMs: 1000,
    });
    const rejected = expect(send).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1000);
    f.manager.writeHumanInput(f.session.id, 'after cancel');
    controller.abort(); await vi.advanceTimersByTimeAsync(1000); await rejected;
    expect(f.writes).not.toContain('after cancel');
    accepted = true; await vi.advanceTimersByTimeAsync(12000);
    expect(f.writes.filter(text => text === 'after cancel')).toHaveLength(1);
  });

  it('never transfers held keys to a replacement PTY after process exit', async () => {
    const f = await fixture();
    f.manager.writeHumanInput(f.session.id, 'old private input');
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    f.manager.kill(f.session.id);
    const next = f.manager.create({ command: 'codex', provider: 'codex', cwd: tmpdir() });
    f.accept(); f.manager.writeHumanInput(next.id, 'new input');
    expect(f.writes).not.toContain('old private input');
    expect(f.writes.at(-1)).toBe('new input');
  });

  it('refuses raw bridge controls while the owner is drafting or an automatic write is unconfirmed', async () => {
    const f = await terminal();
    f.manager.writeHumanInput(f.session.id, 'owner draft');
    expect(() => f.manager.writeRawInput(f.session.id, '\r')).toThrowError(expect.objectContaining({ code: 'PTY_INPUT_BUSY' }));
    expect(f.writes).toEqual(['owner draft']);
    f.manager.writeHumanInput(f.session.id, '\x15');
    f.manager.writeRawInput(f.session.id, '\x1b[B');
    expect(f.writes.at(-1)).toBe('\x1b[B');
    const pending = f.manager.queueWithSubmit(f.session.id, 'automatic', 20, true, async () => false);
    await vi.advanceTimersByTimeAsync(1000); await pending.submitted;
    const before = f.writes.length;
    expect(() => f.manager.writeRawInput(f.session.id, '\r')).toThrow('Terminal input is busy');
    expect(f.writes).toHaveLength(before);
  });

  it('does not block another terminal or let an old receipt release the next terminal draft', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(1500); await f.delivery.submitted;
    const other = f.manager.create({ command: 'codex', provider: 'codex', cwd: tmpdir() });
    f.manager.writeHumanInput(other.id, 'other terminal works');
    expect(f.writes.at(-1)).toBe('other terminal works');
    const next = f.manager.queueWithSubmit(f.session.id, 'next automatic', 20, true, async () => false);
    f.accept(); await vi.advanceTimersByTimeAsync(1000); await next.submitted;
    f.manager.writeHumanInput(f.session.id, 'next owner draft');
    f.delivery.acknowledge();
    expect(f.writes).not.toContain('next owner draft');
    next.acknowledge();
    expect(f.writes.filter(data => data === 'next owner draft')).toHaveLength(1);
  });

  it('treats a paste I/O failure as uncertain instead of releasing owner keys or authorizing replay', async () => {
    const f = await terminal();
    const internal = (f.manager as any).sessions.get(f.session.id);
    internal.pty.write = () => { throw new Error('write failed'); };
    const send = f.manager.queueWithSubmit(f.session.id, 'automatic', 20, true, async () => false);
    await expect(send.submitted).rejects.toMatchObject({ code: 'PTY_DELIVERY_UNCONFIRMED' });
    internal.pty.write = (data: string) => f.writes.push(data);
    f.manager.writeHumanInput(f.session.id, 'must stay separate');
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.writes).not.toContain('must stay separate');
    expect(f.manager.get(f.session.id)?.inputDeferred).toBe(true);
  });

  it('also waits for a verified foreground CLI receipt without turning its Shell into a provider node', async () => {
    const f = await terminal();
    (f.manager as any).sessions.get(f.session.id).provider = null;
    let accepted = false, finished = false;
    const send = f.manager.writeWithConfirmedSubmit(f.session.id, 'manual CLI message', { isAccepted: async () => accepted });
    void send.then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(1000);
    f.manager.writeHumanInput(f.session.id, 'manual CLI owner draft');
    expect(finished).toBe(false);
    expect(f.writes).not.toContain('manual CLI owner draft');
    accepted = true; await vi.advanceTimersByTimeAsync(500); await send;
    expect(f.writes.at(-1)).toBe('manual CLI owner draft');
    expect(f.manager.get(f.session.id)?.provider).toBeNull();
  });
});
