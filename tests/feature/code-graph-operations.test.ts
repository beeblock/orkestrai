import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphOperationsService } from '$lib/modules/agent-room/application/services/CodeGraphOperationsService.js';
import { codeGraphHandoffService } from '$lib/modules/agent-room/application/services/CodeGraphHandoffService.js';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { councilService } from '$lib/modules/agent-room/application/services/CouncilService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { codeGraphInvestigationRepository } from '$lib/modules/agent-room/infrastructure/repositories/CodeGraphInvestigationRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const directories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-operations-'));
  directories.push(directory);
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'package.json'), '{"name":"operations-test"}\n');
  await writeFile(join(directory, 'src', 'math.ts'), 'export function add(left: number, right: number) { return left + right; }\n');
  await writeFile(join(directory, 'src', 'service.ts'), [
    "import { add } from './math';",
    'export function checkoutTotal() {',
    '  const credentials = { "apiKey": "secret-value-that-must-not-leak" };',
    '  const endpoint = "postgres://app:database-password@localhost/private";',
    '  return add(credentials.apiKey.length, 1);',
    '}',
    '',
  ].join('\n'));
  const workspace = await workspaceRepository.createWorkspace({ name: 'Operations test', workingDir: directory });
  await codeGraphIndexService.index(workspace.id);
  const symbol = (await codeGraphIndexService.search(workspace.id, { query: 'checkoutTotal' }))[0];
  if (!symbol) throw new Error('Fixture symbol was not indexed.');
  return { directory, workspace, symbol };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Code graph operational intelligence', () => {
  useSvelarTest({ refreshDatabase: true });

  it('builds redacted bounded context and explains editor and relationship provenance', async () => {
    const { workspace, symbol } = await fixture();
    const context = await codeGraphOperationsService.context(workspace.id, {
      selection: { symbolIds: [symbol.id] },
      purpose: 'review',
      maxTokens: 700,
      depth: 2,
      includeSource: true,
    });

    expect(context.estimatedTokens).toBeLessThanOrEqual(700);
    expect(context.selectedSymbolIds).toEqual([symbol.id]);
    expect(context.markdown).toContain('checkoutTotal');
    expect(context.markdown).not.toContain('secret-value-that-must-not-leak');
    expect(JSON.stringify(context)).not.toContain('database-password');
    expect(context.symbols.every((item) => item.documentation === null)).toBe(true);
    expect(context.excerpts.some((excerpt) => excerpt.redacted)).toBe(true);

    const located = await codeGraphOperationsService.locate(workspace.id, 'src/service.ts', 3);
    expect(located).toMatchObject({ name: 'checkoutTotal', path: 'src/service.ts' });
    const graph = await codeGraphIndexService.subgraph(workspace.id, {
      symbolId: symbol.id,
      direction: 'both',
      depth: 2,
      limit: 100,
    });
    const edge = graph.edges.find((candidate) => candidate.kind === 'calls') ?? graph.edges[0];
    expect(edge).toBeTruthy();
    const explanation = await codeGraphOperationsService.explain(workspace.id, edge!.id);
    expect(explanation).toMatchObject({
      edge: { id: edge!.id },
      classification: edge!.confidence < 100 ? 'inferred' : 'static',
      provenance: { confidence: expect.any(Number), runtimeOnly: false },
    });
  });

  it('compares retained revision manifests and restores named investigations in isolation', async () => {
    const { directory, workspace, symbol } = await fixture();
    const first = (await codeGraphIndexService.revisions(workspace.id))[0];
    await writeFile(join(directory, 'src', 'service.ts'), [
      "import { add } from './math';",
      'export function checkoutTotal() { return add(40, 2); }',
      'export function checkoutCurrency() { return "BRL"; }',
      '',
    ].join('\n'));
    await codeGraphIndexService.index(workspace.id, { force: true });

    const revisions = await codeGraphIndexService.revisions(workspace.id, first.projectId, 30);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].current).toBe(true);
    const comparison = await codeGraphOperationsService.compare(workspace.id, first.projectId, first.id, revisions[0].id);
    expect(comparison.modified.map((entry) => entry.after.name)).toContain('checkoutTotal');
    expect(comparison.added.map((entry) => entry.name)).toContain('checkoutCurrency');
    expect(comparison.relationships.added.length + comparison.relationships.removed.length + comparison.relationships.modified.length).toBeGreaterThan(0);
    await expect(codeGraphOperationsService.compare(workspace.id, first.projectId, first.id, first.id)).rejects.toThrow('different revisions');

    const state = {
      projectId: first.projectId,
      viewMode: 'overview' as const,
      query: 'checkout',
      searchMode: 'lexical' as const,
      selectedSymbolIds: [symbol.id],
      direction: 'both' as const,
      depth: 2,
      camera: { x: 10, y: -5, ratio: 0.8, angle: 0 },
      openPath: 'src/service.ts',
    };
    const saved = await codeGraphInvestigationRepository.create(workspace.id, { name: 'Checkout trace', state, createdBy: 'user' });
    expect(await codeGraphInvestigationRepository.get(workspace.id, saved.id)).toMatchObject({ name: 'Checkout trace', state });
    const other = await workspaceRepository.createWorkspace({ name: 'Other workspace', workingDir: directory });
    expect(await codeGraphInvestigationRepository.get(other.id, saved.id)).toBeNull();
    expect(await codeGraphInvestigationRepository.update(workspace.id, saved.id, { name: 'Checkout review' })).toMatchObject({ name: 'Checkout review' });
    expect(await codeGraphInvestigationRepository.delete(workspace.id, saved.id)).toBe(true);
    expect(await codeGraphInvestigationRepository.get(workspace.id, saved.id)).toBeNull();
  });

  it('projects live ownership conflicts and creates traceable leader, agent, Council, and task handoffs', async () => {
    const { workspace, symbol } = await fixture();
    const leader = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Leader',
      payload: { provider: 'codex', maestro: true },
    });
    const worker = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Reviewer',
      payload: { provider: 'claude' },
    });
    vi.spyOn(controlCenterService, 'snapshot').mockResolvedValue({
      workspaceId: workspace.id,
      counts: { starting: 0, working: 2, waiting_input: 0, waiting_permission: 0, blocked: 0, idle: 0, done: 0, error: 0, disconnected: 0 },
      agents: [leader, worker].map((node) => ({
        nodeId: node.id,
        title: node.title!,
        provider: String(node.payload.provider),
        role: null,
        floorId: null,
        floorName: null,
        state: 'working' as const,
        stateSince: new Date().toISOString(),
        lastAction: 'Editing service',
        lastActionData: { paths: ['src/service.ts'] },
        currentTask: null,
        sessionAlive: true,
      })),
      activity: [],
      communications: [],
      generatedAt: new Date().toISOString(),
    });
    const operations = await codeGraphOperationsService.operations(workspace.id);
    expect(operations.agents.every((agent) => agent.symbolIds.includes(symbol.id))).toBe(true);
    expect(operations.conflicts).toEqual([expect.objectContaining({ severity: 'error', sharedPaths: ['src/service.ts'] })]);

    vi.spyOn(taskBoardService, 'dispatch').mockResolvedValue(undefined as never);
    const context = { selection: { symbolIds: [symbol.id] }, purpose: 'implement' as const, maxTokens: 900, depth: 1, includeSource: false };
    const leaderResult = await codeGraphHandoffService.create(workspace.id, { kind: 'leader', title: 'Leader context', locale: 'en', context }, 'agent');
    const agentResult = await codeGraphHandoffService.create(workspace.id, { kind: 'agent', title: 'Agent context', locale: 'en', context, targetNodeId: worker.id }, 'agent');
    const taskResult = await codeGraphHandoffService.create(workspace.id, { kind: 'task', title: 'Backlog context', locale: 'en', context }, 'agent');
    expect([leaderResult, agentResult, taskResult].map((result) => result.artifact.type)).toEqual(['task', 'task', 'task']);
    const tasks = await taskBoardService.list(workspace.id);
    expect(tasks.find((task) => task.id === leaderResult.artifact.id)?.assigneeNodeId).toBe(leader.id);
    expect(tasks.find((task) => task.id === agentResult.artifact.id)?.assigneeNodeId).toBe(worker.id);
    expect(tasks.find((task) => task.id === taskResult.artifact.id)?.description).toContain(`orkestrai:code-graph-symbols=${symbol.id}`);

    vi.spyOn(councilService, 'start').mockResolvedValue({
      id: '00000000-0000-7000-8000-000000000099',
      workspaceId: workspace.id,
      title: 'Council context',
      status: 'running',
    } as never);
    const council = await codeGraphHandoffService.create(workspace.id, {
      kind: 'council',
      title: 'Council context',
      locale: 'en',
      context,
      targetNodeIds: [leader.id, worker.id],
    }, 'agent');
    expect(council.artifact).toMatchObject({ type: 'council', title: 'Council context', status: 'running' });
    expect(councilService.start).toHaveBeenCalledWith(workspace.id, expect.objectContaining({
      taskId: expect.any(String),
      perspectives: expect.arrayContaining([expect.objectContaining({ agentNodeId: leader.id }), expect.objectContaining({ agentNodeId: worker.id })]),
    }));
  });
});
