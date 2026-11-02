import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';

export default class QueueHealthCheck extends ScheduledTask {
  name = 'queue-health-check';

  schedule() {
    return this.everyFiveMinutes();
  }

  async handle(): Promise<void> {
    const { waiting: pending, failed } = await JobMonitor.getCounts('default');

    if (failed > 0) {
      console.warn(`[QueueHealthCheck] ${failed} failed jobs in queue`);
    }

    if (pending > 100) {
      console.warn(`[QueueHealthCheck] Queue backlog: ${pending} pending jobs`);
    }

    console.log(`[QueueHealthCheck] Queue stats: ${pending} pending, ${failed} failed`);
  }
}
