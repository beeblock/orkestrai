import { Connection } from '@beeblock/svelar/database';
import { stat } from 'node:fs/promises';
import { CODE_GRAPH_CONNECTION, codeGraphConnectionName } from '$lib/database/code-graph-storage.js';
import { codeGraphUsageRepository } from '../../infrastructure/repositories/CodeGraphUsageRepository.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { GRAPH_LATENCY_BUCKETS, emptyGraphCounters, type CodeGraphMetrics } from '../../domain/code-graph-metrics.js';

export class CodeGraphMetricsService {
  async snapshot(workspaceId: string): Promise<CodeGraphMetrics> {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new Error('Workspace not found.');
    const [buckets, projects] = await Promise.all([codeGraphUsageRepository.buckets(workspaceId), codeGraphRepository.listProjects(workspaceId)]);
    const totals = emptyGraphCounters();
    let agentCalls = 0, userCalls = 0;
    for (const bucket of buckets) {
      for (const field of ['calls', 'failures', 'totalMs', 'symbols', 'relationships', 'estimatedContextTokens'] as const) totals[field] += bucket.counters[field];
      totals.maxMs = Math.max(totals.maxMs, bucket.counters.maxMs);
      totals.latencies = totals.latencies.map((count, index) => count + bucket.counters.latencies[index]);
      if (bucket.actor === 'agent') agentCalls += bucket.counters.calls;
      else userCalls += bucket.counters.calls;
    }
    let cumulative = 0, p95UpperMs: number | null = null;
    for (let index = 0; index < totals.latencies.length && totals.calls; index++) {
      cumulative += totals.latencies[index];
      if (cumulative >= Math.ceil(totals.calls * 0.95)) { p95UpperMs = GRAPH_LATENCY_BUCKETS[index]; break; }
    }
    const filename = codeGraphConnectionName() ? Connection.getConfig(CODE_GRAPH_CONNECTION).filename : undefined;
    const sizes = filename ? await Promise.all([filename, filename + '-wal'].map(path => stat(path).then(info => info.size, () => 0))) : [];
    return { periodStart: new Date(Date.now() - 30 * 86400_000).toISOString(), observedSince: buckets[0]?.hour ?? null,
      agentCalls, userCalls, totals, p95UpperMs, databaseBytes: sizes.reduce((sum, value) => sum + value, 0),
      projects: projects.map(project => ({ id: project.id, name: project.name, state: project.status, files: project.stats.files,
        symbols: project.stats.symbols, relationships: project.stats.edges, lastIndexedAt: project.lastIndexedAt,
        lastIndexMs: project.stats.durationMs, persistMs: project.stats.timings?.persistMs ?? 0 })) };
  }
}
export const codeGraphMetricsService = new CodeGraphMetricsService();
