import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import QueueHealthCheck from '$lib/shared/scheduler/QueueHealthCheck.js';

describe('scheduled queue health check', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([{ waiting: 0, failed: 0 }, { waiting: 101, failed: 0 }, { waiting: 0, failed: 2 }])('reads aggregate queue counts through the supported monitor API: %o', async counts => {
    const stats = vi.spyOn(JobMonitor, 'getCounts').mockResolvedValue({ ...counts, active: 0, completed: 0, delayed: 0, total: counts.waiting + counts.failed });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new QueueHealthCheck().handle();
    expect(stats).toHaveBeenCalledWith('default');
    expect(warn).toHaveBeenCalledTimes(counts.waiting > 100 || counts.failed > 0 ? 1 : 0);
    expect(log).toHaveBeenCalledWith(`[QueueHealthCheck] Queue stats: ${counts.waiting} pending, ${counts.failed} failed`);
  });
});
