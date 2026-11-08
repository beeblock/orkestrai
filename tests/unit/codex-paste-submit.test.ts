import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { frameAutomaticPaste, hasOwnedCodexPaste, nativeComposerState } from '$lib/modules/agent-room/application/adapters/interactive-startup.ts';
import { PtySessionManager, sanitizeComposerText } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

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

  it('recognizes an entire owned short prompt painted literally without a paste badge', () => {
    const text = '[orkestrai:message:1234] External question';
    const frame = '\x1b[25;1H›\x1b[25;3H[orkestrai:message:1234]\x1b[26;3HExternal question\x1b[30;3H   \x1b[26;20H\x1b[?25h';
    expect(hasOwnedCodexPaste(frame, text)).toBe(true);
    expect(hasOwnedCodexPaste(`› ${text}`, text)).toBe(true);
    for (const bad of [text, `› ${text} changed`, `› owner ${text}`, `${frame}\x1b[2K`, `${frame}\x08`,
      `${frame}\x1b[1P`, `› ${text}\nApprove this action`]) expect(hasOwnedCodexPaste(bad, text), bad).toBe(false);
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

  it('recognizes the captured native ConPTY redraw that positions the composer with CRLF', () => {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/codex-conpty-resize-0166.json', import.meta.url), 'utf8'));
    expect(hasOwnedCodexPaste(fixture.output, 'x'.repeat(fixture.promptLength))).toBe(true);
  });

  const segmentedText = (`Fixture delivery 1\n${'A bounded local-only paste, no tools or external inference. '.repeat(150)}`).trim();
  const segmentedFrame = '\x1b[6;3Hinference. A bounded local-only\x1b[7;3Hpaste, no tools or external\x1b[K\x1b[8;3Hinference. A\x1b[38;5;6m[Pasted Content 8638      \x1b[9;3Hchars]\x1b[K\x1b[?25h';
  it('recognizes the captured native split between literal typing and a wrapped paste badge', () => {
    expect(Array.from(segmentedText).length).toBe(9018);
    expect(hasOwnedCodexPaste(segmentedFrame, segmentedText)).toBe(true);
    expect(hasOwnedCodexPaste(segmentedFrame.replace('8638', '8639'), segmentedText)).toBe(false);
    expect(hasOwnedCodexPaste(segmentedFrame.replace('inference. A\x1b[38', 'owner draft!\x1b[38'), segmentedText)).toBe(false);
    expect(hasOwnedCodexPaste(segmentedFrame + 'owner draft', segmentedText)).toBe(false);
    expect(hasOwnedCodexPaste(segmentedFrame + '\x1b[9;1H\x1b[K', segmentedText)).toBe(false);
    expect(hasOwnedCodexPaste('[Pasted Content 8638 chars]', segmentedText)).toBe(false);
  });

  it('recognizes the captured CRLF split-paste redraw only with its own absorbed Enter accounted for', () => {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/codex-conpty-segmented-0167.json', import.meta.url), 'utf8'));
    expect(hasOwnedCodexPaste(fixture.output, segmentedText)).toBe(false);
    expect(hasOwnedCodexPaste(fixture.output, segmentedText, fixture.extraEnters)).toBe(true);
    expect(hasOwnedCodexPaste(fixture.output + 'owner draft', segmentedText, fixture.extraEnters)).toBe(false);
    expect(hasOwnedCodexPaste(fixture.output.replace('Fixture delivery 1', 'Unrelated question'), segmentedText, fixture.extraEnters)).toBe(false);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('keeps cursor style %s out of the current draft', style => {
    expect(hasOwnedCodexPaste(`\x1b[17;3H[Pasted Content 9018 chars]\x1b[${style} q\x1b[?25h`, 'x'.repeat(9018))).toBe(true);
  });

  it.each(['\x1b[K', '\x1b[0K', '\x1b[22m\x1b[K\x1b[m', '\x1b[9X'])('recognizes a fresh composer whose blank right side is cleared (%j)', erase => {
    expect(hasOwnedCodexPaste(`›\x1b[22m \x1b[38;5;6m[Pasted Content 9018 chars]${erase}`, 'x'.repeat(9018))).toBe(true);
    expect(hasOwnedCodexPaste(`\x1b[17;3H[Pasted Content 9018 chars]${erase}`, 'x'.repeat(9018))).toBe(true);
  });

  it.each(['\x1b[1K', '\x1b[2K', '\x1b[1G\x1b[K', '\x1b[Kowner draft', '\x1b[9Xowner draft'])('keeps erased or edited composers protected (%j)', erase => {
    expect(hasOwnedCodexPaste(`› [Pasted Content 9018 chars]${erase}`, 'x'.repeat(9018))).toBe(false);
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

  async function fixture(message?: string) {
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
    const text = message ?? 'Owned draft '.repeat(120).trimEnd();
    const delivery = manager.queueWithSubmit(session.id, text, 10, true, async () => false);
    await vi.advanceTimersByTimeAsync(6000); await delivery.submitted;
    const at = manager.automaticDeliverySubmittedAt(session.id)!;
    const badge = () => emit(`\x1b[28;3H[Pasted Content ${text.length} chars]\x1b[28;30H`);
    badge(); await vi.advanceTimersByTimeAsync(6000);
    return { manager, session, writes, at, emit, badge, text, delivery };
  }

  it.each(['native idle', 'quiet fallback'])('waits for initial ConPTY readiness (%s) before writing a confirmed automatic message', async readiness => {
    vi.useFakeTimers();
    const writes: string[] = []; let emit = (_: string) => {};
    const manager = new PtySessionManager((() => ({ pid: -1, cols: 120, rows: 30,
      write: (data: string) => writes.push(data), resize() {}, kill() {},
      onData: (callback: typeof emit) => { emit = callback; return { dispose() {} }; }, onExit: () => ({ dispose() {} }),
    })) as never, () => {});
    const session = manager.create({ command: 'codex', provider: 'codex', cwd: tmpdir() });
    cleanup.push(() => manager.killAll());
    (manager as any).sessions.get(session.id).conptySubmitGuard = true;
    const delivery = manager.queueWithSubmit(session.id, 'Wait for the real input boundary', 10, true, async () => false);
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toHaveLength(0);
    emit('Codex is loading its composer ›');
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toHaveLength(0);
    if (readiness === 'native idle') emit('\x1b]7501;state=idle:app=codex\x1b\\');
    else await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(1000);
    await delivery.submitted;
    expect(writes.filter(data => data.includes('Wait for the real input boundary'))).toHaveLength(1);
  });

  it.each([false, true])('keeps the owned split-paste recovery subject to actual owner edits (edited=%s)', async edited => {
    const { manager, session, writes, at, emit, text } = await fixture(segmentedText);
    if (edited) { manager.writeHumanInput(session.id, '\x03'); manager.writeHumanInput(session.id, 'owner edit'); }
    emit(segmentedFrame);
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(!edited);
    expect(writes.filter(data => data === frameAutomaticPaste('codex', false, true, sanitizeComposerText(text)))).toHaveLength(1);
  });

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

  it.each(['human', '\x1b[A', '\t', '\x15'])('preserves owner edits after explicit terminal takeover (%j)', async input => {
    const { manager, session, at, badge } = await fixture();
    manager.writeHumanInput(session.id, '\x03');
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

  it.each(['\x1b[28;3R', 'owner\x1b[28;3R', '\x1b[1;2R'])('keeps unsolicited or mixed input protected after takeover (%j)', async input => {
    const { manager, session, at, emit, badge } = await fixture();
    manager.writeHumanInput(session.id, '\x03');
    if (input.startsWith('owner')) emit('\x1b[6n');
    manager.writeHumanInput(session.id, input); badge(); await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });

  it('recognizes a split DSR query but refuses its expired reply', async () => {
    const { manager, session, at, emit, badge } = await fixture();
    emit('\x1b['); emit('6n');
    await vi.advanceTimersByTimeAsync(10_001);
    manager.writeHumanInput(session.id, '\x03');
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
