import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { GRAPH_LATENCY_BUCKETS, emptyGraphCounters, type GraphQueryCounters } from '../../domain/code-graph-metrics.js';
import { codeGraphUsageRepository } from '../repositories/CodeGraphUsageRepository.js';
type Snapshot = { state: 'committed' | 'refreshing' | 'outdated'; revisionIds: string[] };
const scope = new AsyncLocalStorage<{ counters: GraphQueryCounters; snapshot?: Snapshot }>();
export function setCodeGraphQuerySnapshot(snapshot: Snapshot) { const current = scope.getStore(); if (current) current.snapshot = snapshot; }

/** Count results before serialization; never copy prompts, queries, code or credentials into telemetry. */
export function instrumentCodeGraphController(controller: any, actor: 'user' | 'agent', methods: string[]) {
  const json = controller.json.bind(controller);
  controller.json = (payload: any, ...args: unknown[]) => {
    const current = scope.getStore(), counters = current?.counters, result = payload?.data;
    if (counters && result) {
      counters.symbols += Array.isArray(result) ? result.filter(item => item?.qualifiedName || item?.symbol?.qualifiedName).length : result.nodes?.length ?? result.symbols?.length ?? 0;
      counters.relationships += result.edges?.length ?? result.relationships?.length ?? 0;
      if (typeof result.estimatedTokens === 'number' && typeof result.markdown === 'string') counters.estimatedContextTokens += Math.max(0, Math.round(result.estimatedTokens));
    }
    return json(current?.snapshot && result ? { ...payload, meta: { ...payload.meta, graph: current.snapshot } } : payload, ...args);
  };
  for (const method of methods) {
    const invoke = controller[method].bind(controller);
    controller[method] = async (event: any) => {
      const counters = emptyGraphCounters(), started = performance.now();
      counters.calls = 1;
      let response: Response;
      try { response = await scope.run({ counters }, () => invoke(event)); }
      catch (error) { counters.failures = 1; throw error; }
      finally {
        counters.totalMs = counters.maxMs = Math.max(0, performance.now() - started);
        const bucket = GRAPH_LATENCY_BUCKETS.findIndex(bound => bound === null || counters.totalMs <= bound);
        counters.latencies[bucket] = 1;
        const workspaceId = actor === 'user' ? event.params.id : event.locals?.codeGraphWorkspaceId;
        if (workspaceId) {
          // Telemetry never delays or changes the original delivery response.
          queueMicrotask(() => void codeGraphUsageRepository.record(workspaceId, actor, method.replace(/^codeGraph/, '').toLowerCase(), counters).catch(() => undefined));
        }
      }
      if (response.status >= 400 && response.status !== 425) counters.failures = 1;
      return response;
    };
  }
}
