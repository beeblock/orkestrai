import { expect, it } from 'vitest';
import { withGitProcessSlot } from '$lib/modules/agent-room/infrastructure/GitProcessQueue.js';

it('bounds subprocesses across callers and transfers slots after errors', async () => {
  let active = 0, peak = 0;
  const outcomes = await Promise.allSettled(Array.from({ length: 35 }, (_, i) => withGitProcessSlot(async () => {
    peak = Math.max(peak, ++active);
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      if (i % 7 === 0) throw new Error('git failed');
      return i;
    } finally { active--; }
  })));
  expect(peak).toBe(4);
  expect(active).toBe(0);
  expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(5);
  expect(await withGitProcessSlot(async () => 'still available')).toBe('still available');
});
