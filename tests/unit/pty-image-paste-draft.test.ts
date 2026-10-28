import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { ptySessionManager, PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

const quiet = () => new Promise((resolve) => setTimeout(resolve, 3_000));

describe('missed automatic paste submission', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const stop of cleanup.splice(0)) stop(); vi.useRealTimers(); });
  async function pasted() {
    vi.useFakeTimers();
    let emit = (_data: string) => {};
    const writes: string[] = [];
    const manager = new PtySessionManager((() => ({
      pid: -1, cols: 120, rows: 30,
      write: (text: string) => { writes.push(text); }, resize: () => {}, kill: () => {},
      onData: (callback: (data: string) => void) => { emit = callback; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }),
    })) as never, () => {});
    const session = manager.create({ command: 'claude', provider: 'claude', cwd: tmpdir() });
    cleanup.push(() => manager.kill(session.id));
    emit('❯ \r\nbypass permissions on');
    await vi.advanceTimersByTimeAsync(3000);
    const handle = manager.queueWithSubmit(session.id, 'Owned automatic draft', 10, true, async () => false);
    await vi.advanceTimersByTimeAsync(500);
    await handle.submitted;
    const at = manager.automaticDeliverySubmittedAt(session.id)!;
    const showPaste = () => emit('❯ [Pasted text #1]\r\nbypass permissions on');
    showPaste();
    await vi.advanceTimersByTimeAsync(6000);
    return { manager, session, at, writes, showPaste, emit: (text: string) => emit(text) };
  }

  it.skipIf(process.platform === 'win32')('retries only Enter twice at most, preserving the original receipt identity and never retyping the message', async () => {
    const { manager, session, at, writes, showPaste } = await pasted();
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    expect(manager.automaticDeliverySubmittedAt(session.id)).toBe(at);
    showPaste();
    await vi.advanceTimersByTimeAsync(3000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
    showPaste();
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
    expect(writes.filter(text => text.includes('Owned automatic draft'))).toHaveLength(1);
    expect(writes.filter(text => text === '\r')).toHaveLength(3);
  });

  it.skipIf(process.platform === 'win32').each(['human draft\x15', '\x1b[A', '\x1b[1;5C', '\t'])('does not submit after human input, even if no characters remain (%j)', async data => {
    const { manager, session, at, writes, showPaste } = await pasted();
    manager.writeHumanInput(session.id, data);
    showPaste();
    await vi.advanceTimersByTimeAsync(6000);
    const before = writes.length;
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
    expect(writes).toHaveLength(before);
  });

  it.skipIf(process.platform === 'win32')('does not mistake xterm focus/device/color replies for a human edit', async () => {
    const { manager, session, at, showPaste } = await pasted();
    for (const report of ['\x1b[I', '\x1b[O', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b]10;rgb:ffff/ffff/ffff\x1b\\']) {
      manager.writeHumanInput(session.id, report);
    }
    showPaste();
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('requires the same submission, an older completed turn and a current pasted block', async () => {
    const { manager, session, at, emit } = await pasted();
    expect(manager.retryPendingAutomaticPaste(session.id, at - 1, at - 100)).toBe(false);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at + 100)).toBe(false);
    expect(manager.retryPendingAutomaticPaste(session.id, at, NaN)).toBe(false);
    emit('Previous ❯ [Pasted text #1]\r\nAnswer\r\n❯ \r\nbypass permissions on');
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('preserves the separate ConPTY submit retry policy', async () => {
    const { manager, session, at } = await pasted();
    const state = manager as unknown as { sessions: Map<string, { conptySubmitGuard: boolean }> };
    state.sessions.get(session.id)!.conptySubmitGuard = true;
    expect(manager.retryPendingAutomaticPaste(session.id, at, at - 100)).toBe(false);
  });
});

describe('Ctrl+V in an agent terminal', () => {
  const sessions: string[] = [];
  afterEach(() => {
    for (const id of sessions.splice(0)) ptySessionManager.kill(id);
  });

  it.skipIf(process.platform === 'win32')('holds automatic messages only for a pasted image, until the draft is cleared', async () => {
    const session = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'echo ready; sleep 60'],
      cwd: tmpdir(),
      workspaceId: 'paste-workspace',
      nodeId: 'paste-node',
      provider: 'codex',
    });
    sessions.push(session.id);
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true);
    // An empty or text-only clipboard: the CLI pastes nothing, so nothing is held.
    ptySessionManager.writeHumanInput(session.id, '\x16');
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true);
    // An image the app saw on the clipboard becomes the CLI's draft chip.
    ptySessionManager.writeHumanInput(session.id, '\x16', { imagePaste: true });
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(false);
    // Clearing the field (Ctrl+U) releases the queue.
    ptySessionManager.writeHumanInput(session.id, '\x15');
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true);
  }, 20_000);
});
