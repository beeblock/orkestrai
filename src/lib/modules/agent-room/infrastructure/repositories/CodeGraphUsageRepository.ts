import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import { AgentCodeGraphUsageBucket } from '../../domain/models/AgentCodeGraphUsageBucket.js';
import { emptyGraphCounters, type GraphQueryCounters } from '../../domain/code-graph-metrics.js';

export class CodeGraphUsageRepository {
  async record(workspaceId: string, actor: 'agent' | 'user', operation: string, sample: GraphQueryCounters): Promise<void> {
    const hour = new Date().toISOString().slice(0, 13) + ':00:00.000Z';
    await Connection.transaction(async () => {
      const row = await AgentCodeGraphUsageBucket.query().where('workspace_id', workspaceId).where('hour', hour).where('actor', actor).where('operation', operation).first();
      const counters: GraphQueryCounters = row ? JSON.parse(String(row.getAttribute('counters_json'))) : emptyGraphCounters();
      for (const field of ['calls', 'failures', 'totalMs', 'symbols', 'relationships', 'estimatedContextTokens'] as const) counters[field] += sample[field];
      counters.maxMs = Math.max(counters.maxMs, sample.maxMs);
      counters.latencies = counters.latencies.map((count, index) => count + sample.latencies[index]);
      if (row) await row.update({ counters_json: JSON.stringify(counters) });
      else await AgentCodeGraphUsageBucket.create({ id: uuidv7(), workspace_id: workspaceId, hour, actor, operation, counters_json: JSON.stringify(counters) });
      await AgentCodeGraphUsageBucket.query().where('workspace_id', workspaceId).where('hour', '<', new Date(Date.now() - 30 * 86400_000).toISOString()).delete();
    });
  }
  async buckets(workspaceId: string) {
    const rows = await AgentCodeGraphUsageBucket.query().where('workspace_id', workspaceId).where('hour', '>=', new Date(Date.now() - 30 * 86400_000).toISOString()).orderBy('hour', 'asc').get();
    return rows.map(row => ({ hour: String(row.getAttribute('hour')), actor: String(row.getAttribute('actor')), counters: JSON.parse(String(row.getAttribute('counters_json'))) as GraphQueryCounters }));
  }
}
export const codeGraphUsageRepository = new CodeGraphUsageRepository();
