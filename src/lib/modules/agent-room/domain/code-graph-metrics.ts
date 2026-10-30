export const GRAPH_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 200, 500, 1_000, 5_000, null] as const;
export type GraphQueryCounters = {
  calls: number; failures: number; totalMs: number; maxMs: number;
  symbols: number; relationships: number; estimatedContextTokens: number; latencies: number[];
};
export type CodeGraphMetrics = {
  periodStart: string; observedSince: string | null; agentCalls: number; userCalls: number;
  totals: GraphQueryCounters; p95UpperMs: number | null; databaseBytes: number;
  projects: Array<{ id: string; name: string; state: string; files: number; symbols: number; relationships: number; lastIndexedAt: string | null; lastIndexMs: number; persistMs: number }>;
};
export function emptyGraphCounters(): GraphQueryCounters {
  return { calls: 0, failures: 0, totalMs: 0, maxMs: 0, symbols: 0, relationships: 0, estimatedContextTokens: 0, latencies: GRAPH_LATENCY_BUCKETS.map(() => 0) };
}
