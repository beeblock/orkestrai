import { Job } from '@beeblock/svelar/queue';
import { routineService } from '../services/RoutineService.js';

export class RunAutomationJob extends Job {
  maxAttempts = 3;
  retryDelay = 20;
  declare runId: string;

  constructor(runId = '') {
    super();
    this.runId = runId;
  }

  async handle(): Promise<void> {
    if (!this.runId) throw new Error('Automation run id is required.');
    await routineService.executeRun(this.runId, false);
  }

  async failed(error: Error): Promise<void> {
    await routineService.markJobFailure(this.runId, error);
  }

  serialize(): string {
    return JSON.stringify({ runId: this.runId });
  }

  restore(data: Record<string, unknown>): void {
    this.runId = String(data.runId ?? '');
  }
}
