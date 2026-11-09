import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { acceptsInputDuringTurn, nativeComposerOpen } from '$lib/modules/agent-room/application/adapters/interactive-startup.ts';
import { parseInteractiveRequestPending } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.ts';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { confirmationCheckDelay } from '$lib/modules/agent-room/application/services/AgentInboxService.ts';

const osc = (state: string) => `\x1b]7501;state=${state}\x1b\\`;
const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n');

describe('mid-turn agent input', () => {
  it('reads an open Codex composer from OSC 7501, never from a question or approval', () => {
    for (const state of ['idle:app=codex', 'done:app=codex', 'error:app=codex', 'working:app=codex']) {
      expect(nativeComposerOpen('codex', osc(state)), state).toBe(true);
    }
    for (const state of ['blocked:app=codex:kind=question', 'blocked:app=codex:kind=permission', 'blocked:app=codex:kind=auth', 'clear', 'approval:app=codex']) {
      expect(nativeComposerOpen('codex', osc(state)), state).toBe(false);
    }
    expect(nativeComposerOpen('codex', osc('working:app=codex') + osc('blocked:app=codex:kind=question'))).toBe(false);
    expect(nativeComposerOpen('codex', osc('blocked:app=codex:kind=question') + osc('working:app=codex'))).toBe(true);
    expect(nativeComposerOpen('codex', 'no report')).toBeUndefined();
    expect(nativeComposerOpen('claude', osc('working:app=codex'))).toBeUndefined();
    expect(acceptsInputDuringTurn('codex', true)).toBe(true);
    expect(acceptsInputDuringTurn('codex', undefined)).toBe(false);
    expect(acceptsInputDuringTurn('codex', false)).toBe(false);
    expect(acceptsInputDuringTurn('claude', undefined)).toBe(true);
    for (const provider of ['kimi', 'opencode', null]) expect(acceptsInputDuringTurn(provider, true)).toBe(false);
  });

  it('finds an unanswered question to the person in Claude and Codex transcripts', () => {
    const ask = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion', input: {} }] } };
    const answer = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'B' }] } };
    const bash = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} }] } };
    expect(parseInteractiveRequestPending('claude-project-jsonl', jsonl([ask]))).toBe(true);
    expect(parseInteractiveRequestPending('claude-project-jsonl', jsonl([ask, answer, bash]))).toBe(false);
    expect(parseInteractiveRequestPending('claude-project-jsonl', jsonl([bash]))).toBe(false);
    expect(parseInteractiveRequestPending('claude-project-jsonl', jsonl([ask, { type: 'user', message: { content: 'Next prompt' } }]))).toBe(false);
    const call = { type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call_1', arguments: '{}' } };
    const output = { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: 'A' } };
    expect(parseInteractiveRequestPending('codex-rollout-jsonl', jsonl([call]))).toBe(true);
    expect(parseInteractiveRequestPending('codex-rollout-jsonl', jsonl([call, output]))).toBe(false);
    expect(parseInteractiveRequestPending('opencode-session-json', jsonl([call]))).toBe(false);
  });

  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const stop of cleanup.splice(0)) stop(); vi.useRealTimers(); });

  async function working() {
    vi.useFakeTimers();
    const writes: string[] = []; let emit = (_: string) => {};
    const manager = new PtySessionManager((() => ({ pid: -1, cols: 120, rows: 30,
      write: (text: string) => { writes.push(text); }, resize() {}, kill() {},
      onData: (callback: typeof emit) => { emit = callback; return { dispose() {} }; }, onExit: () => ({ dispose() {} }),
    })) as never, () => {});
    const session = manager.create({ command: 'codex', provider: 'codex', cwd: tmpdir() });
    cleanup.push(() => manager.killAll());
    emit(`› ${osc('idle:app=codex')}`); await vi.advanceTimersByTimeAsync(3000);
    emit(osc('working:app=codex')); await vi.advanceTimersByTimeAsync(100);
    return { manager, session, writes, emit };
  }

  it('types a message into a working Codex only while its composer is open', async () => {
    const { manager, session, writes, emit } = await working();
    expect(manager.canAcceptAutomaticMessage(session.id)).toBe(false);
    expect(manager.canAcceptAutomaticMessageDuringTurn(session.id)).toBe(true);
    const boundary = manager.queueWithSubmit(session.id, 'Waits for the boundary', 10, true, async () => false);
    const cancelled = expect(boundary.submitted).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(6000);
    expect(writes.some(data => data.includes('Waits for the boundary'))).toBe(false);
    expect(boundary.cancel()).toBe(true); await cancelled;

    emit(osc('blocked:app=codex:kind=question'));
    expect(manager.canAcceptAutomaticMessageDuringTurn(session.id)).toBe(false);
    const steer = manager.queueWithSubmit(session.id, 'Specialist reply', 10, true, async () => false, undefined, undefined, true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(writes.some(data => data.includes('Specialist reply'))).toBe(false);
    emit(osc('working:app=codex'));
    await vi.advanceTimersByTimeAsync(6000); await steer.submitted;
    expect(writes.filter(data => data.includes('Specialist reply'))).toHaveLength(1);
    expect(writes.at(-1)).toBe('\r');
    // The receipt barrier still allows one automatic message at a time.
    expect(manager.canAcceptAutomaticMessageDuringTurn(session.id)).toBe(false);
  });

  it('leaves the paste to the owner when a question opens before Enter', async () => {
    const { manager, session, writes, emit } = await working();
    const steer = manager.queueWithSubmit(session.id, 'Reply typed mid-turn', 10, true, async () => false, undefined, undefined, true);
    const rejected = expect(steer.submitted).rejects.toMatchObject({ code: 'PTY_DELIVERY_UNCONFIRMED' });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.filter(data => data.includes('Reply typed mid-turn'))).toHaveLength(1);
    emit(osc('blocked:app=codex:kind=question'));
    await vi.advanceTimersByTimeAsync(6000); await rejected;
    expect(writes).not.toContain('\r');
    // The question has the focus: the owner's keys reach it instead of being held.
    manager.writeHumanInput(session.id, '2');
    expect(writes.at(-1)).toBe('2');
    expect(manager.get(session.id)?.inputDeferred).toBe(false);
    emit(osc('working:app=codex')); await vi.advanceTimersByTimeAsync(20_000);
    // The paste is still in the composer: no automatic message is typed after it.
    expect(manager.canAcceptAutomaticMessageDuringTurn(session.id)).toBe(false);
    manager.writeHumanInput(session.id, '\r');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(manager.canAcceptAutomaticMessageDuringTurn(session.id)).toBe(true);
  });

  it.each([false, true])('submits a mid-turn prompt that the ended turn left in the composer once (owner typed: %s)', async ownerTyped => {
    const { manager, session, writes, emit } = await working();
    const steer = manager.queueWithSubmit(session.id, 'Reply typed mid-turn', 10, true, async () => false, undefined, undefined, true);
    // Windows sessions start with the ConPTY settle delay before Enter.
    await vi.advanceTimersByTimeAsync(1000); await steer.submitted;
    expect(manager.automaticDeliveryDuringTurn(session.id)).toBe(true);
    // Still working: the steer may yet be consumed by this turn.
    await vi.advanceTimersByTimeAsync(6000);
    expect(manager.retryRestoredTurnInput(session.id)).toBe(false);
    if (ownerTyped) manager.writeHumanInput(session.id, 'x');
    // The turn is interrupted and Codex puts the steer back into the composer.
    emit(osc('idle:app=codex'));
    expect(manager.retryRestoredTurnInput(session.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(2500);
    const enters = writes.filter(data => data === '\r').length;
    expect(manager.retryRestoredTurnInput(session.id)).toBe(!ownerTyped);
    expect(writes.filter(data => data === '\r')).toHaveLength(enters + (ownerTyped ? 0 : 1));
    // Never in a burst: at most once per 5 s and twice per message.
    expect(manager.retryRestoredTurnInput(session.id)).toBe(false);
    expect(writes.filter(data => data.includes('Reply typed mid-turn'))).toHaveLength(1);
  });

  it('spaces transcript matching of a batch that stays unconfirmed', () => {
    expect(confirmationCheckDelay(0)).toBe(0);
    expect(confirmationCheckDelay(119_000)).toBe(0);
    expect(confirmationCheckDelay(3 * 60_000)).toBe(15_000);
    expect(confirmationCheckDelay(3 * 60 * 60_000)).toBe(60_000);
  });
});
