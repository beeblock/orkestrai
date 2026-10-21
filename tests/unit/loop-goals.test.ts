import { describe, expect, it } from 'vitest';
import { loopGoalReached, outputMatchKey, plainTerminalText } from '$lib/modules/agent-room/domain/loop-goals.js';

describe('loop goals', () => {
  it('strips terminal escape sequences and redraws', () => {
    expect(plainTerminalText('\u001b[32mok\u001b[0m\rdone')).toBe('ok\ndone');
  });

  it('meets the goal only when the agent writes it, not when the prompt is echoed', () => {
    const prompt = 'Run the tests and say ALL TESTS PASS when green.';
    expect(loopGoalReached(`> ${prompt}\nrunning...`, 'ALL TESTS PASS', prompt)).toBe(false);
    expect(loopGoalReached(`> ${prompt}\n\u001b[1mAll tests pass\u001b[0m (58/58)`, 'ALL TESTS PASS', prompt)).toBe(true);
    expect(loopGoalReached('anything', '   ', prompt)).toBe(false);
  });

  it('keys a watched text by its latest occurrence', () => {
    const first = outputMatchKey('build 1 FAILED at step 2', 'failed');
    const same = outputMatchKey('build 1 FAILED at step 2', 'FAILED');
    const next = outputMatchKey('build 1 FAILED at step 2\nbuild 2 FAILED at step 5', 'FAILED');
    expect(first).toBeTruthy();
    expect(same).toBe(first);
    expect(next).not.toBe(first);
    expect(outputMatchKey('all good', 'FAILED')).toBeNull();
  });
});
