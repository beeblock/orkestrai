import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { Connection } from '@beeblock/svelar/database';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { codeGraphUsageRepository } from '$lib/modules/agent-room/infrastructure/repositories/CodeGraphUsageRepository.js';
import { codeGraphMetricsService } from '$lib/modules/agent-room/application/services/CodeGraphMetricsService.js';
import { emptyGraphCounters } from '$lib/modules/agent-room/domain/code-graph-metrics.js';
import { CodeGraphController } from '$lib/modules/agent-room/interface/http/controllers/CodeGraphController.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { executeMcpTool, MCP_TOOLS } from '../../packages/orkestrai-cli/src/mcp.js';

function sample(ms = 10) {
  const result = emptyGraphCounters();
  result.calls = 1; result.totalMs = result.maxMs = ms; result.latencies[1] = 1;
  result.estimatedContextTokens = 120;
  return result;
}

describe('measured graph usage without query persistence', () => {
  useSvelarTest({ refreshDatabase: true });

  it('aggregates concurrent samples, isolates workspaces and never invents historical use', async () => {
    const first = await workspaceRepository.createWorkspace({ name: 'Measured', workingDir: '/tmp' });
    const second = await workspaceRepository.createWorkspace({ name: 'Private', workingDir: '/tmp' });
    expect(await codeGraphMetricsService.snapshot(first.id)).toMatchObject({ observedSince: null, agentCalls: 0, userCalls: 0, p95UpperMs: null });
    await Promise.all(Array.from({ length: 20 }, () => codeGraphUsageRepository.record(first.id, 'agent', 'context', sample())));
    await codeGraphUsageRepository.record(second.id, 'user', 'search', sample());
    const metrics = await codeGraphMetricsService.snapshot(first.id);
    expect(metrics).toMatchObject({ agentCalls: 20, userCalls: 0, p95UpperMs: 10, totals: { calls: 20, estimatedContextTokens: 2400 } });
    const stored = await Connection.raw('SELECT * FROM agent_code_graph_usage_buckets');
    expect(stored).toHaveLength(2);
    expect(Object.keys(stored[0]).sort()).toEqual(['actor', 'counters_json', 'hour', 'id', 'operation', 'workspace_id']);
  });

  it('makes metrics available to owners, rejects an unknown bridge token, and exposes the same MCP operation', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Metrics', workingDir: '/tmp' });
    const response = await new CodeGraphController().metrics({ params: { id: workspace.id } } as any);
    expect(response.status).toBe(200);
    expect((await response.json()).data.agentCalls).toBe(0);
    const rejected = await new BridgeController().codeGraphMetrics({ params: {}, locals: {}, request: new Request('http://localhost/api', { headers: { authorization: 'Bearer invalid' } }), url: new URL('http://localhost/api') });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(MCP_TOOLS.find(tool => tool.name === 'code_graph_metrics')).toBeDefined();
    const calls: unknown[] = [];
    const data = await executeMcpTool({ selfAgent: 'agent', findFreePort: async () => 0, bridge: async (...args: unknown[]) => { calls.push(args); return { agentCalls: 5 }; } }, 'code_graph_metrics', {});
    expect(calls).toEqual([['GET', '/api/agent-room/bridge/code-graph/metrics']]);
    expect(data.agentCalls).toBe(5);
  });
});
