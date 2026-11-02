import { taskExecutionRepository } from '../../infrastructure/repositories/TaskExecutionRepository.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { heavyRunService } from './HeavyRunService.js';

export type OrchestrationStats = {
  windowHours: number;
  executions: { states: Record<string, number>; queueSeconds: { p50: number | null; p95: number | null };
    submissionSeconds: { p50: number | null; p95: number | null }; confirmationSeconds: { p50: number | null; p95: number | null } };
  messages: {
    total: number;
    replied: number;
    failed: number;
    queued: number;
    deliverySeconds: { p50: number | null; p95: number | null };
    replySeconds: { p50: number | null; p95: number | null };
  };
  inboxes: Array<{ nodeId: string; title: string; queued: number; oldestSeconds: number | null }>;
  tasks: { created: number; done: number; open: number };
  floors: { active: number; landed: number };
  heavy: { slots: number; active: number; queued: number };
};

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

function seconds(from: string, to: string | null): number | null {
  if (!to) return null;
  const value = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Throughput and latency of the team, so "is it working?" has numbers. */
export class OrchestrationStatsService {
  async workspace(workspaceId: string, windowHours = 24): Promise<OrchestrationStats> {
    const hours = Math.max(1, Math.min(168, Math.round(windowHours)));
    const since = new Date(Date.now() - hours * 60 * 60_000).toISOString();
    const through = new Date().toISOString();
    const [tasks, floors, heavy] = await Promise.all([
      AgentBoardTask.query().select('status', 'created_at', 'updated_at', 'archived_at').where('workspace_id', workspaceId).get(),
      AgentFloor.query().where('workspace_id', workspaceId).get(),
      heavyRunService.status(),
    ]);
    const delivery: number[] = [];
    const reply: number[] = [];
    let total = 0, replied = 0, failed = 0, queued = 0;
    const byRecipient = new Map<string, { queued: number; oldest: string }>();
    for await (const page of controlCenterRepository.inboxStatsPages(workspaceId, since, through)) {
      for (const envelope of page) {
        total += 1;
        if (envelope.kind === 'ask' && envelope.state === 'replied') replied += 1;
        if (envelope.state === 'failed' && envelope.metadata.cancelled !== true) failed += 1;
        const delivered = seconds(envelope.createdAt, envelope.deliveredAt);
        const answered = envelope.kind === 'ask' ? seconds(envelope.createdAt, envelope.repliedAt) : null;
        if (delivered !== null) delivery.push(delivered);
        if (answered !== null) reply.push(answered);
        if (envelope.state !== 'queued' || envelope.metadata.inbox !== true) continue;
        queued += 1;
        const current = byRecipient.get(envelope.toNodeId);
        byRecipient.set(envelope.toNodeId, {
          queued: (current?.queued ?? 0) + 1,
          oldest: current && current.oldest < envelope.createdAt ? current.oldest : envelope.createdAt,
        });
      }
    }
    const titles = await workspaceRepository.listNodeTitles(workspaceId, [...byRecipient.keys()]);
    const inWindow = (value: unknown) => String(value instanceof Date ? value.toISOString() : value ?? '') >= since;
    const states: Record<string, number> = {}, queueTimes: number[] = [], submitTimes: number[] = [], confirmationTimes: number[] = [];
    for await (const page of taskExecutionRepository.statsPages(workspaceId, since, through)) for (const attempt of page) {
      states[attempt.state] = (states[attempt.state] ?? 0) + 1;
      const queue = seconds(attempt.createdAt, attempt.claimedAt);
      const submit = attempt.claimedAt ? seconds(attempt.claimedAt, attempt.submittedAt) : null;
      const confirm = attempt.submittedAt ? seconds(attempt.submittedAt, attempt.acceptedAt) : null;
      if (queue !== null) queueTimes.push(queue);
      if (submit !== null) submitTimes.push(submit);
      if (confirm !== null) confirmationTimes.push(confirm);
    }
    const percentiles = (times: number[]) => ({ p50: percentile(times, .5), p95: percentile(times, .95) });
    return {
      windowHours: hours,
      executions: { states, queueSeconds: percentiles(queueTimes), submissionSeconds: percentiles(submitTimes), confirmationSeconds: percentiles(confirmationTimes) },
      messages: {
        total, replied, failed, queued,
        deliverySeconds: { p50: percentile(delivery, 0.5), p95: percentile(delivery, 0.95) },
        replySeconds: { p50: percentile(reply, 0.5), p95: percentile(reply, 0.95) },
      },
      inboxes: [...byRecipient.entries()].map(([nodeId, item]) => ({
        nodeId,
        title: titles.get(nodeId) ?? 'agente',
        queued: item.queued,
        oldestSeconds: seconds(item.oldest, new Date().toISOString()),
      })),
      tasks: {
        created: tasks.filter((task) => inWindow(task.getAttribute('created_at'))).length,
        done: tasks.filter((task) => task.getAttribute('status') === 'done' && inWindow(task.getAttribute('updated_at'))).length,
        open: tasks.filter((task) => !task.getAttribute('archived_at') && ['todo', 'doing'].includes(String(task.getAttribute('status')))).length,
      },
      floors: {
        active: floors.filter((floor) => floor.getAttribute('status') === 'active').length,
        landed: floors.filter((floor) => floor.getAttribute('status') === 'landed' && inWindow(floor.getAttribute('updated_at'))).length,
      },
      heavy: {
        slots: heavy.capacity.slots,
        active: heavy.active.filter((lease) => lease.workspaceId === workspaceId).length,
        queued: heavy.queued.filter((item) => item.workspaceId === workspaceId).length,
      },
    };
  }
}

export const orchestrationStatsService = new OrchestrationStatsService();
