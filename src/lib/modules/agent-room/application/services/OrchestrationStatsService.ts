import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { heavyRunService } from './HeavyRunService.js';

export type OrchestrationStats = {
  windowHours: number;
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
    const [envelopes, nodes, tasks, floors, heavy] = await Promise.all([
      controlCenterRepository.inboxStats(workspaceId, since),
      workspaceRepository.listNodes(workspaceId, undefined, true),
      AgentBoardTask.query().where('workspace_id', workspaceId).get(),
      AgentFloor.query().where('workspace_id', workspaceId).get(),
      heavyRunService.status(),
    ]);
    const titles = new Map(nodes.map((node) => [node.id, node.title ?? 'agente']));
    // Only conversations and work handoffs: replies and notices are not asks.
    const asks = envelopes.filter((envelope) => envelope.kind === 'ask');
    const delivery = envelopes.map((envelope) => seconds(envelope.createdAt, envelope.deliveredAt)).filter((value): value is number => value !== null);
    const reply = asks.map((envelope) => seconds(envelope.createdAt, envelope.repliedAt)).filter((value): value is number => value !== null);
    const queued = envelopes.filter((envelope) => envelope.state === 'queued' && envelope.metadata.inbox === true);
    const byRecipient = new Map<string, { queued: number; oldest: string }>();
    for (const envelope of queued) {
      const current = byRecipient.get(envelope.toNodeId);
      byRecipient.set(envelope.toNodeId, {
        queued: (current?.queued ?? 0) + 1,
        oldest: current && current.oldest < envelope.createdAt ? current.oldest : envelope.createdAt,
      });
    }
    const inWindow = (value: unknown) => String(value instanceof Date ? value.toISOString() : value ?? '') >= since;
    return {
      windowHours: hours,
      messages: {
        total: envelopes.length,
        replied: asks.filter((envelope) => envelope.state === 'replied').length,
        failed: envelopes.filter((envelope) => envelope.state === 'failed' && envelope.metadata.cancelled !== true).length,
        queued: queued.length,
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
