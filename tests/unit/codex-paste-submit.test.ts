import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { frameAutomaticPaste, hasOwnedCodexPaste, nativeComposerState } from '$lib/modules/agent-room/application/adapters/interactive-startup.ts';
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
    expect(hasOwnedCodexPaste('[Pasted Content 4 chars]', 'a😃b', 1)).toBe(true);
    expect(hasOwnedCodexPaste('[Pasted Content 5 chars]', 'a😃b', 1)).toBe(false);
    for (const output of ['› [Pasted Content 4 chars]', '› a human draft [Pasted Content 3 chars]',
      '› [Pasted Content 3 chars] + changed', '› [Pasted Content 3 chars] [Pasted Content 3 chars]',
      '› [Pasted Content 3 chars]\r\nAnswer\r\n› ', '[Pasted Content 3 chars]\x1b[2J',
      '[Pasted Content 3 chars]\x1b[1G\x1b[K', 'No composer']) {
      expect(hasOwnedCodexPaste(output, 'a😃b'), output).toBe(false);
    }
  });

  // Captured from the native Windows 0.166 TUI in the Canvas-sized fixture.
  // ConPTY paints the badge, erases the footer, then returns to the composer.
  const windowsFooter = '\x1b[m\x1b[12;3H \x1b[1C   \x1b[1C\x1b[9X\x1b[9;30H\x1b[?25h';
  // Native Codex 0.167, 40x12 -> 72x20 while the third paste is pending.
  // Ratatui repaints model/path and warning rows, then restores the composer.
  const resizedFooter = '\x1b[38;5;223m\x1b[19;3HGPT-6.1-Sol default\x1b[m\x1b[1C·\x1b[38;5;151m\x1b[1CC:\\fixture\\project\x1b[m\x1b[20;48H⚠\x1b[38;5;179m\x1b[1C1 warning\x1b[m\x1b[1C·\x1b[1m\x1b[1Cf2\x1b[22m\x1b[1Cto\x1b[1Cview\x1b[17;30H\x1b[?25h';

  it('recognizes the current composer when a native resize repaints footer text below it', () => {
    expect(hasOwnedCodexPaste(`\x1b[17;1H›\x1b[1C[Pasted Content 9018 chars]${resizedFooter}`, 'x'.repeat(9018))).toBe(true);
    expect(hasOwnedCodexPaste(`\x1b[16;1H›\x1b[1C[Pasted Content 9018 chars]${resizedFooter}`, 'x'.repeat(9018))).toBe(false);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('keeps cursor style %s out of the current draft', style => {
    expect(hasOwnedCodexPaste(`\x1b[17;3H[Pasted Content 9018 chars]\x1b[${style} q\x1b[?25h`, 'x'.repeat(9018))).toBe(true);
  });

  it.each([
    '\x1b[17;40Hhuman edit\x1b[17;30H',
    '\x1b[16;1HApprove this action\x1b[17;30H',
    '\x1b[19;1Hfooter without a cursor return',
    '\x1b[19;1Hfooter\x1b[17;30H\x1b[2K',
  ])('preserves edits and unproven redraws after a paste (%j)', suffix => {
    expect(hasOwnedCodexPaste(`\x1b[17;1H›\x1b[1C[Pasted Content 9018 chars]${suffix}`, 'x'.repeat(9018))).toBe(false);
  });

  it('recognizes a pending paste when ConPTY clears the footer after painting the badge', () => {
    expect(hasOwnedCodexPaste(`\x1b[38;5;6m[Pasted Content 9018 chars]${windowsFooter}`, 'x'.repeat(9018))).toBe(true);
  });

  it('refuses an erased composer or unproven erase instead of trusting an old badge', () => {
    for (const suffix of [
      '\x1b[9X',
      '\x1b[9;3H\x1b[30X\x1b[9;30H',
      '\x1b[12;3H\x1b[9X',
      '\x1b[8;3H\x1b[9X\x1b[9;30H',
      '\x1b[12;3Hconfirm action\x1b[9X\x1b[9;30H',
      `${windowsFooter}human draft`,
      `${windowsFooter}\x1b[2J`,
    ]) expect(hasOwnedCodexPaste(`[Pasted Content 9018 chars]${suffix}`, 'x'.repeat(9018)), suffix).toBe(false);
  });

  it('recognizes native idle reports and conservatively blocks other states', () => {
    expect(nativeComposerState('codex', '\x1b]7501;state=idle:app=codex\x1b\\')).toBe('idle');
    expect(nativeComposerState('codex', '\x1b]7501;state=working:app=codex\x07')).toBe('working');
    expect(nativeComposerState('codex', '\x1b]7501;state=done:app=codex\x07')).toBe('idle');
    expect(nativeComposerState('codex', '\x1b]7501;state=error:app=codex\x07')).toBe('idle');
    expect(nativeComposerState('codex', '\x1b]7501;state=blocked:app=codex:kind=permission\x07')).toBe('working');
    expect(nativeComposerState('codex', '\x1b]7501;state=clear\x1b\\')).toBe('working');
    expect(nativeComposerState('codex', '\x1b]7501;state=approval:app=codex\x07')).toBe('working');
    expect(nativeComposerState('other', '\x1b]7501;state=idle:app=codex\x07')).toBeUndefined();
    expect(nativeComposerState('codex', '\x1b]7501;state=idle:app=codex')).toBeUndefined();
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
    await vi.advanceTimersByTimeAsync(6000); await delivery.submitted;
    const at = manager.automaticDeliverySubmittedAt(session.id)!;
    const badge = () => emit(`\x1b[28;3H[Pasted Content ${text.length} chars]\x1b[28;30H`);
    badge(); await vi.advanceTimersByTimeAsync(6000);
    return { manager, session, writes, at, emit, badge, text, delivery };
  }

  it('recovers the captured Windows footer redraw without retyping the paste', async () => {
    const { manager, session, writes, at, text, emit } = await fixture();
    emit(`\x1b[38;5;6m[Pasted Content ${text.length} chars]${windowsFooter}`);
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    expect(writes.filter(value => value.includes(text))).toHaveLength(1);
  });

  it('recovers the native resized footer while preserving the original delivery identity', async () => {
    const { manager, session, writes, at, text, emit } = await fixture();
    emit(`\x1b[17;1H›\x1b[1C[Pasted Content ${text.length} chars]${resizedFooter}`);
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    expect(manager.automaticDeliverySubmittedAt(session.id)).toBe(at);
    expect(writes.filter(value => value.includes(text))).toHaveLength(1);
  });

  it('recovers when fresh redraws roll the paste mark out of retained scrollback', async () => {
    const { manager, session, at, badge, emit, writes, text } = await fixture();
    emit('redraw output '.repeat(30000)); badge();
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    expect(writes.filter(value => value.includes(text))).toHaveLength(1);
  });

  it('does not recover after retention loses the current paste evidence', async () => {
    const { manager, session, at, emit } = await fixture();
    emit('redraw output '.repeat(30000));
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });

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

  it.each([false, true])('does not treat a requested cursor-position report as an owner edit (split=%s)', async split => {
    const { manager, session, at, emit, badge } = await fixture();
    if (split) { emit('\x1b['); emit('6n'); } else emit('\x1b[6n');
    manager.writeHumanInput(session.id, '\x1b[28;3R');
    badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
  });

  it('counts batched cursor queries and responses without disabling paste recovery', async () => {
    const { manager, session, at, emit, badge } = await fixture();
    emit('\x1b[6n\x1b[6n'); manager.writeHumanInput(session.id, '\x1b[28;3R\x1b[28;3R');
    badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
  });

  it.each(['\x1b[28;3R', 'owner\x1b[28;3R', '\x1b[1;2R'])('keeps unsolicited or mixed input protected (%j)', async input => {
    const { manager, session, at, emit, badge } = await fixture();
    if (input.startsWith('owner')) emit('\x1b[6n');
    manager.writeHumanInput(session.id, input); badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });

  it('recognizes a split DSR query but refuses its expired reply', async () => {
    const { manager, session, at, emit, badge } = await fixture();
    emit('\x1b['); emit('6n');
    await vi.advanceTimersByTimeAsync(10_001);
    manager.writeHumanInput(session.id, '\x1b[28;3R'); badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });

  it('requires an older finished turn and fresh current composer evidence', async () => {
    const { manager, session, at, emit } = await fixture();
    expect(manager.retryPendingAutomaticPaste(session.id, at, NaN)).toBe(false);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at + 100)).toBe(false);
    emit('› \r\nnew empty composer'); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });

  it('recovers the first native conversation using an idle report even if Enter became a newline', async () => {
    const { manager, session, at, text, emit } = await fixture();
    emit(`\x1b]7501;state=idle:app=codex\x1b\\\x1b[28;3H[Pasted Content ${text.length + 1} chars]`);
    expect(manager.retryPendingAutomaticPaste(session.id, at, Number.NaN)).toBe(true);
    emit('\x1b]7501;state=working:app=codex\x1b\\'); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
    expect(manager.canAcceptAutomaticMessage(session.id)).toBe(false);
  });

  it('holds a queued prompt during native working and releases it on an unfocused done report', async () => {
    const { manager, session, writes, emit, delivery } = await fixture();
    delivery.acknowledge(); emit('\x1b]7501;state=working:app=codex\x1b\\');
    const second = manager.queueWithSubmit(session.id, 'Next prompt', 10);
    await vi.advanceTimersByTimeAsync(6000);
    expect(writes.some(value => value.includes('Next prompt'))).toBe(false);
    expect(manager.get(session.id)?.waiting).toBe(false);
    emit('\x1b]7501;state=done:app=codex\x1b\\'); await vi.advanceTimersByTimeAsync(6000); await second.submitted;
    expect(writes.filter(value => value.includes('Next prompt'))).toHaveLength(1);
  });
});
