import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { MCP_TOOLS, runMcpServer } from '../../packages/orkestrai-cli/src/mcp.js';
import {
  bridgeAskSchema,
  bridgeDesignApplySchema,
  bridgeNoteCreateSchema,
  bridgeNoteEditSchema,
  bridgeNoteWriteSchema,
  bridgeNotifySchema,
  bridgeRecruitSchema,
  bridgeDismissSchema,
  bridgeFloorCreateSchema,
  bridgeFloorLandSchema,
} from '$lib/modules/agent-room/contracts/schemas/bridgeSchemas.js';
import { bridgeBoardTaskSchema, bridgeBoardTaskUpdateSchema } from '$lib/modules/agent-room/contracts/schemas/taskSchemas.js';
import { bridgeApplyDesignDeliverySchema, bridgeImportDesignMarkupSchema, previewDesignDeliverySchema } from '$lib/modules/agent-room/contracts/schemas/design-delivery.schema.js';
import { createAgentApiClientSchema, executeAgentApiClientRunnerSchema, exportAgentApiClientSchema, importAgentApiClientSchema, replaceAgentApiClientSchema, syncAgentApiClientSchema } from '$lib/modules/agent-room/contracts/schemas/apiClient.schema.js';
import { z } from 'zod';
import { saveWorkspaceMemorySchema, reviseWorkspaceMemorySchema } from '$lib/modules/agent-room/contracts/schemas/workspace-memory.schema.js';
import { contributeHuddleTurnSchema } from '$lib/modules/agent-room/contracts/schemas/huddle.schema.js';
import { addImageWorkflowReferenceSchema, bridgeRunImageWorkflowSchema, completeImageWorkflowSchema, connectImageWorkflowNodeSchema, createImageWorkflowSchema, failImageWorkflowSchema, imageWorkflowActorSchema, updateImageWorkflowSchema, validateImageWorkflowOutputSchema } from '$lib/modules/agent-room/contracts/schemas/imageWorkflowSchemas.js';
import { codeGraphContractSchema, codeGraphEvidenceImportSchema, codeGraphHandoffSchema, codeGraphIndexSchema, codeGraphQualitySchema, codeGraphSemanticActionSchema } from '$lib/modules/agent-room/contracts/schemas/codeGraphSchemas.js';

/**
 * Contrato MCP x ponte: TODA tool e dirigida contra a rota e o schema REAIS
 * da bridge (os mesmos zod dos controllers). Se o mapeamento do MCP divergir
 * (campo errado, rota inexistente), este teste quebra — o "data was invalid"
 * nunca mais chega no usuario.
 */

const portalActionSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  nodeId: z.string().trim().min(1),
  action: z.enum(['navigate', 'eval', 'screenshot', 'dom']),
  args: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
});
const portalCreateSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1),
  url: z.string().trim().min(1),
  title: z.string().trim().nullish(),
  connect: z.string().trim().nullish(),
  forceNew: z.boolean().default(false),
});
const apiClientExecuteSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  variables: z.record(z.string(), z.string().max(100_000)).default({}),
  from: z.string().trim().min(1).max(200).nullish(),
}).strict();
const bridgeHuddleContributeSchema = contributeHuddleTurnSchema.extend({ from: z.string().uuid() }).strict();

type Expectation = { method: string; path: RegExp; schema?: z.ZodTypeAny };

const EXPECTED: Record<string, Expectation> = {
  list: { method: 'GET', path: /\/bridge\/agents\?/ },
  usage: { method: 'GET', path: /\/bridge\/usage$/ },
  code_graph_status: { method: 'GET', path: /\/bridge\/code-graph$/ },
  code_graph_index: { method: 'POST', path: /\/bridge\/code-graph$/, schema: codeGraphIndexSchema },
  code_graph_search: { method: 'GET', path: /\/bridge\/code-graph\/search\?/ },
  code_graph_symbol: { method: 'GET', path: /\/bridge\/code-graph\/symbols\/00000000-0000-7000-8000-000000000010$/ },
  code_graph_neighbors: { method: 'GET', path: /\/bridge\/code-graph\/symbols\/00000000-0000-7000-8000-000000000010\/graph\?/ },
  code_graph_changes: { method: 'GET', path: /\/bridge\/code-graph\/changes\?/ },
  code_graph_contracts: { method: 'GET', path: /\/bridge\/code-graph\/contracts\?/ },
  code_graph_quality: { method: 'GET', path: /\/bridge\/code-graph\/quality\?/ },
  code_graph_semantic_status: { method: 'GET', path: /\/bridge\/code-graph\/semantic$/ },
  code_graph_semantic_build: { method: 'POST', path: /\/bridge\/code-graph\/semantic$/, schema: codeGraphSemanticActionSchema },
  code_graph_semantic_search: { method: 'GET', path: /\/bridge\/code-graph\/semantic\?/ },
  code_graph_evidence: { method: 'GET', path: /\/bridge\/code-graph\/evidence\?/ },
  code_graph_evidence_import: { method: 'POST', path: /\/bridge\/code-graph\/evidence$/, schema: codeGraphEvidenceImportSchema },
  code_graph_handoff: { method: 'POST', path: /\/bridge\/code-graph\/handoffs$/, schema: codeGraphHandoffSchema },
  huddle_list: { method: 'GET', path: /\/bridge\/huddles\?selected=/ },
  huddle_say: { method: 'POST', path: /\/bridge\/huddles\/00000000-0000-7000-8000-000000000001\/turns$/, schema: bridgeHuddleContributeSchema },
  ask: { method: 'POST', path: /\/bridge\/ask$/, schema: bridgeAskSchema },
  note_list: { method: 'GET', path: /\/bridge\/notes\?agentNodeId=/ },
  note_read: { method: 'GET', path: /\/bridge\/notes\/n1$/ },
  note_write: { method: 'PUT', path: /\/bridge\/notes\/n1$/, schema: bridgeNoteWriteSchema },
  note_edit: { method: 'PATCH', path: /\/bridge\/notes\/n1$/, schema: bridgeNoteEditSchema },
  note_create: { method: 'POST', path: /\/bridge\/notes$/, schema: bridgeNoteCreateSchema },
  memory_search: { method: 'GET', path: /\/bridge\/memory\?/ },
  memory_add: { method: 'POST', path: /\/bridge\/memory$/, schema: saveWorkspaceMemorySchema },
  memory_revise: { method: 'PATCH', path: /\/bridge\/memory\/n1$/, schema: reviseWorkspaceMemorySchema },
  memory_archive: { method: 'DELETE', path: /\/bridge\/memory\/n1$/ },
  api_client_list: { method: 'GET', path: /\/bridge\/api-clients\?agentNodeId=/ },
  api_client_read: { method: 'GET', path: /\/bridge\/api-clients\/n1\?agentNodeId=n1$/ },
  api_client_import: { method: 'POST', path: /\/bridge\/api-clients\/import$/, schema: importAgentApiClientSchema },
  api_client_create: { method: 'POST', path: /\/bridge\/api-clients$/, schema: createAgentApiClientSchema },
  api_client_replace: { method: 'PUT', path: /\/bridge\/api-clients\/n1$/, schema: replaceAgentApiClientSchema },
  api_client_sync_status: { method: 'POST', path: /\/bridge\/api-clients\/n1\/sync$/, schema: syncAgentApiClientSchema },
  api_client_pull: { method: 'POST', path: /\/bridge\/api-clients\/n1\/sync$/, schema: syncAgentApiClientSchema },
  api_client_push: { method: 'POST', path: /\/bridge\/api-clients\/n1\/sync$/, schema: syncAgentApiClientSchema },
  api_client_export: { method: 'POST', path: /\/bridge\/api-clients\/n1\/export$/, schema: exportAgentApiClientSchema },
  api_client_run_runner: { method: 'POST', path: /\/bridge\/api-clients\/n1\/runners\/runner1\/execute$/, schema: executeAgentApiClientRunnerSchema },
  api_client_execute: { method: 'POST', path: /\/bridge\/api-clients\/n1\/execute$/, schema: apiClientExecuteSchema },
  image_workflow_list: { method: 'GET', path: /\/bridge\/image-workflows$/ },
  image_workflow_read: { method: 'GET', path: /\/bridge\/image-workflows\/n1$/ },
  image_workflow_create: { method: 'POST', path: /\/bridge\/image-workflows$/, schema: createImageWorkflowSchema },
  image_workflow_update: { method: 'PATCH', path: /\/bridge\/image-workflows\/n1$/, schema: updateImageWorkflowSchema },
  image_workflow_connect: { method: 'POST', path: /\/bridge\/image-workflows\/n1\/connections$/, schema: connectImageWorkflowNodeSchema },
  image_workflow_disconnect: { method: 'DELETE', path: /\/bridge\/image-workflows\/n1\/connections$/, schema: connectImageWorkflowNodeSchema },
  image_workflow_add_reference: { method: 'POST', path: /\/bridge\/image-workflows\/n1\/references$/, schema: addImageWorkflowReferenceSchema },
  image_workflow_run: { method: 'POST', path: /\/bridge\/image-workflows\/n1$/, schema: bridgeRunImageWorkflowSchema },
  image_workflow_complete: { method: 'POST', path: /\/bridge\/image-workflows\/n1\/complete$/, schema: completeImageWorkflowSchema },
  image_workflow_validate: { method: 'POST', path: /\/bridge\/image-workflows\/n1\/validate$/, schema: validateImageWorkflowOutputSchema },
  image_workflow_fail: { method: 'POST', path: /\/bridge\/image-workflows\/n1\/fail$/, schema: failImageWorkflowSchema },
  image_workflow_cancel: { method: 'DELETE', path: /\/bridge\/image-workflows\/n1$/, schema: imageWorkflowActorSchema },
  image_workflow_delete: { method: 'POST', path: /\/bridge\/image-workflows\/n1\/remove$/, schema: imageWorkflowActorSchema },
  design_list: { method: 'GET', path: /\/bridge\/designs$/ },
  design_read: { method: 'GET', path: /\/bridge\/designs\/n1$/ },
  design_audit: { method: 'GET', path: /\/bridge\/designs\/n1\/quality$/ },
  design_apply_template: { method: 'POST', path: /\/bridge\/designs\/n1\/quality$/ },
  design_apply_operations: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_create_elements: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_apply_blueprint: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_comment: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_propose: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_decide_proposal: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_import_code: { method: 'POST', path: /\/bridge\/designs\/n1\/delivery\/import$/, schema: bridgeImportDesignMarkupSchema },
  design_generate_code_preview: { method: 'POST', path: /\/bridge\/designs\/n1\/delivery\/preview$/, schema: previewDesignDeliverySchema },
  design_generate_code_apply: { method: 'POST', path: /\/bridge\/designs\/n1\/delivery\/apply$/, schema: bridgeApplyDesignDeliverySchema },
  design_create_element: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_update_element: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  design_delete_element: { method: 'PATCH', path: /\/bridge\/designs\/n1$/, schema: bridgeDesignApplySchema },
  task_list: { method: 'GET', path: /\/bridge\/tasks$/ },
  task_add: { method: 'POST', path: /\/bridge\/tasks$/, schema: bridgeBoardTaskSchema },
  task_done: { method: 'PATCH', path: /\/bridge\/tasks\/t1$/, schema: bridgeBoardTaskUpdateSchema },
  task_history: { method: 'GET', path: /\/bridge\/tasks\/history$/ },
  portal_create: { method: 'POST', path: /\/bridge\/portal\/create$/, schema: portalCreateSchema },
  portal_navigate: { method: 'POST', path: /\/bridge\/portal$/, schema: portalActionSchema },
  portal_eval: { method: 'POST', path: /\/bridge\/portal$/, schema: portalActionSchema },
  portal_dom: { method: 'POST', path: /\/bridge\/portal$/, schema: portalActionSchema },
  portal_screenshot: { method: 'POST', path: /\/bridge\/portal$/, schema: portalActionSchema },
  floor_list: { method: 'GET', path: /\/bridge\/floors$/ },
  floor_create: { method: 'POST', path: /\/bridge\/floors$/, schema: bridgeFloorCreateSchema },
  floor_preview: { method: 'GET', path: /\/bridge\/floors\/f1\/preview$/ },
  floor_land: { method: 'POST', path: /\/bridge\/floors\/f1\/land$/, schema: bridgeFloorLandSchema },
  notify: { method: 'POST', path: /\/bridge\/notify$/, schema: bridgeNotifySchema },
  recruit: { method: 'POST', path: /\/bridge\/recruit$/, schema: bridgeRecruitSchema },
  dismiss: { method: 'POST', path: /\/bridge\/dismiss$/, schema: bridgeDismissSchema },
};

const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  code_graph_index: { projectIds: ['00000000-0000-7000-8000-000000000020'], force: true },
  code_graph_search: { query: 'OrderService', kinds: ['class'], limit: 20 },
  code_graph_symbol: { symbolId: '00000000-0000-7000-8000-000000000010' },
  code_graph_neighbors: { symbolId: '00000000-0000-7000-8000-000000000010', direction: 'incoming', depth: 3, limit: 100 },
  code_graph_changes: { depth: 2, limit: 500 },
  code_graph_contracts: codeGraphContractSchema.parse({ limit: 300, includeGraph: true }),
  code_graph_quality: codeGraphQualitySchema.parse({ limit: 300, includeGraph: true }),
  code_graph_semantic_search: { query: 'compute checkout total', kinds: ['function'], limit: 20 },
  code_graph_evidence: { limit: 300 },
  code_graph_evidence_import: { projectId: '00000000-0000-7000-8000-000000000020', path: 'coverage/lcov.info', kind: 'coverage' },
  code_graph_handoff: { kind: 'task', scopeId: 'workspace', title: 'Investigate order impact', locale: 'en' },
  huddle_list: { huddleId: '00000000-0000-7000-8000-000000000001' },
  huddle_say: { huddleId: '00000000-0000-7000-8000-000000000001', text: 'The release gate is clear.' },
  ask: { agent: 'Codex', message: 'oi' },
  note_read: { nodeId: 'n1' },
  note_write: { nodeId: 'n1', content: 'x' },
  note_edit: { nodeId: 'n1', oldText: 'a', newText: 'b' },
  note_create: { title: 'T', content: 'c' },
  memory_search: { query: 'architecture' },
  memory_add: { title: 'API boundary', content: 'Use the repository layer.', kind: 'decision', sources: [{ type: 'user', label: 'User direction' }] },
  memory_revise: { id: 'n1', title: 'API boundary', content: 'Use the service and repository layers.', kind: 'decision', sources: [{ type: 'user', label: 'User direction' }], baseRevision: 1, baseUpdatedAt: '2026-08-22T20:00:00.000Z' },
  memory_archive: { id: 'n1' },
  api_client_execute: { nodeId: 'n1', requestId: 'r1', variables: { baseUrl: 'https://example.test' } },
  api_client_read: { nodeId: 'n1' },
  api_client_import: { path: 'tests/api', kind: 'bruno' },
  api_client_create: { title: 'Agent API', collection: { requests: [] } },
  api_client_replace: { nodeId: 'n1', baseFingerprint: 'a'.repeat(64), collection: { requests: [] } },
  api_client_sync_status: { nodeId: 'n1' },
  api_client_pull: { nodeId: 'n1' },
  api_client_push: { nodeId: 'n1' },
  api_client_export: { nodeId: 'n1', kind: 'postman', path: '.orkestrai/exports' },
  api_client_run_runner: { nodeId: 'n1', runnerId: 'runner1', variables: { tenant: 'alpha' }, maxExecutions: 20 },
  image_workflow_read: { nodeId: 'n1' },
  image_workflow_create: { title: 'Campaign images', prompt: 'Create ten carousel visuals.', count: 10 },
  image_workflow_update: { nodeId: 'n1', prompt: 'Updated art direction.', count: 10 },
  image_workflow_connect: { nodeId: 'n1', targetNodeId: '00000000-0000-7000-8000-000000000021', order: 0 },
  image_workflow_disconnect: { nodeId: 'n1', targetNodeId: '00000000-0000-7000-8000-000000000021' },
  image_workflow_add_reference: { nodeId: 'n1', path: 'references/character.png', title: 'Character', order: 0 },
  image_workflow_run: { nodeId: 'n1', prompt: 'Create ten transparent character poses.', transparentBackground: true, count: 10 },
  image_workflow_complete: { nodeId: 'n1', runId: '00000000-0000-7000-8000-000000000010', outputPaths: ['generated/images/pose-1.png'] },
  image_workflow_validate: { nodeId: 'n1', runId: '00000000-0000-7000-8000-000000000010', outputPath: 'generated/images/pose-1.png' },
  image_workflow_fail: { nodeId: 'n1', runId: '00000000-0000-7000-8000-000000000010', errorCode: 'image_gen_tool_failed' },
  image_workflow_cancel: { nodeId: 'n1' },
  image_workflow_delete: { nodeId: 'n1' },
  design_read: { nodeId: 'n1' },
  design_audit: { nodeId: 'n1' },
  design_apply_template: {
    nodeId: 'n1',
    baseRevision: 0,
    templateId: 'product',
  },
  design_apply_operations: {
    nodeId: 'n1',
    baseRevision: 0,
    summary: 'Create color collection',
    operations: [{
      kind: 'add-variable-collection',
      collection: {
        id: '00000000-0000-7000-8000-000000000010',
        name: 'Brand',
        modes: [{ id: '00000000-0000-7000-8000-000000000011', name: 'Light' }],
        defaultModeId: '00000000-0000-7000-8000-000000000011',
        order: 0,
      },
    }],
  },
  design_create_elements: {
    nodeId: 'n1',
    baseRevision: 0,
    pageId: '00000000-0000-7000-8000-000000000001',
    summary: 'Create complete screen',
    elements: [{
      id: '00000000-0000-7000-8000-000000000002',
      type: 'frame',
      name: 'Desktop',
      x: 80,
      y: 80,
      width: 1440,
      height: 1024,
    }],
  },
  design_apply_blueprint: {
    nodeId: 'n1',
    baseRevision: 0,
    pageId: '00000000-0000-7000-8000-000000000001',
    summary: 'Create typed design foundation',
    elements: [{
      id: '00000000-0000-7000-8000-000000000002',
      type: 'frame',
      name: 'Desktop',
      x: 80,
      y: 80,
      width: 1440,
      height: 1024,
    }],
    variableCollections: [{
      id: '00000000-0000-7000-8000-000000000010',
      name: 'Brand',
      modes: [{ id: '00000000-0000-7000-8000-000000000011', name: 'Light' }],
    }],
    variables: [{
      id: '00000000-0000-7000-8000-000000000012',
      collectionId: '00000000-0000-7000-8000-000000000010',
      name: 'Surface/default',
      type: 'color',
      values: { '00000000-0000-7000-8000-000000000011': { kind: 'color', value: '#ffffff' } },
    }],
    bindings: [{ elementId: '00000000-0000-7000-8000-000000000002', property: 'fill', variableId: '00000000-0000-7000-8000-000000000012' }],
    components: [{
      id: '00000000-0000-7000-8000-000000000020',
      name: 'Desktop shell',
      rootElementId: '00000000-0000-7000-8000-000000000002',
    }],
    prototypeFlows: [{
      id: '00000000-0000-7000-8000-000000000030',
      name: 'Primary flow',
      startFrameId: '00000000-0000-7000-8000-000000000002',
    }],
    presentation: { defaultFlowId: '00000000-0000-7000-8000-000000000030' },
  },
  design_comment: {
    nodeId: 'n1', baseRevision: 1,
    pageId: '00000000-0000-7000-8000-000000000001',
    elementId: '00000000-0000-7000-8000-000000000002',
    body: 'Review this layer.',
  },
  design_propose: {
    nodeId: 'n1', baseRevision: 2, title: 'Increase emphasis', description: 'Refine hierarchy.',
    operations: [{ kind: 'update', elementId: '00000000-0000-7000-8000-000000000002', changes: { opacity: 0.9 } }],
  },
  design_decide_proposal: {
    nodeId: 'n1', baseRevision: 3,
    proposalId: '00000000-0000-7000-8000-000000000003', status: 'approved', note: 'Reviewed.',
  },
  design_import_code: {
    nodeId: 'n1',
    baseRevision: 0,
    format: 'html',
    name: 'Account card',
    markup: '<article class="p-4"><h2>Account</h2></article>',
  },
  design_generate_code_preview: {
    nodeId: 'n1',
    framework: 'svelar',
    elementIds: ['00000000-0000-7000-8000-000000000001'],
    outputPath: 'src/lib/AccountCard.svelte',
    componentName: 'AccountCard',
  },
  design_generate_code_apply: {
    nodeId: 'n1',
    baseRevision: 0,
    framework: 'svelar',
    elementIds: ['00000000-0000-7000-8000-000000000001'],
    outputPath: 'src/lib/AccountCard.svelte',
    componentName: 'AccountCard',
    expectedExistingHash: null,
  },
  design_create_element: {
    nodeId: 'n1',
    baseRevision: 0,
    pageId: '00000000-0000-7000-8000-000000000001',
    type: 'frame',
    name: 'Mobile frame',
    x: 24,
    y: 24,
    width: 390,
    height: 844,
  },
  design_update_element: {
    nodeId: 'n1',
    baseRevision: 1,
    elementId: '00000000-0000-7000-8000-000000000002',
    changes: { x: 48 },
    taskId: '00000000-0000-7000-8000-000000000003',
  },
  design_delete_element: {
    nodeId: 'n1',
    baseRevision: 2,
    elementId: '00000000-0000-7000-8000-000000000002',
  },
  task_add: { title: 'tarefa' },
  task_done: { taskId: 't1' },
  portal_create: { url: 'localhost:3000' },
  portal_navigate: { nodeId: 'n1', url: 'http://localhost:3000' },
  portal_eval: { nodeId: 'n1', js: '1+1' },
  portal_dom: { nodeId: 'n1' },
  portal_screenshot: { nodeId: 'n1' },
  floor_create: { name: 'andar' },
  floor_preview: { floorId: 'f1' },
  floor_land: { floorId: 'f1' },
  notify: { message: 'oi', kind: 'project', title: 'Projeto Atlas' },
  recruit: { title: 'Novo', floorId: 'f1' },
  dismiss: { agent: 'Velho' },
};

describe('contrato MCP x bridge (todas as tools)', () => {
  it('publica referencia local e schemas de lote sem tocar a bridge', async () => {
    const referenceTool = MCP_TOOLS.find((tool) => tool.name === 'design_reference') as any;
    const elementBatchTool = MCP_TOOLS.find((tool) => tool.name === 'design_create_elements') as any;
    const blueprintTool = MCP_TOOLS.find((tool) => tool.name === 'design_apply_blueprint') as any;
    expect(referenceTool.inputSchema.properties.topic.enum).toContain('elements');
    expect(referenceTool.inputSchema.properties.topic.enum).toContain('concept');
    expect(elementBatchTool.inputSchema.properties.elements.items.required).toEqual(['type', 'name', 'x', 'y', 'width', 'height']);
    expect(blueprintTool.inputSchema.properties.variables.items.required).toContain('values');

    const input = new PassThrough();
    const chunks: string[] = [];
    let bridgeCalled = false;
    const done = runMcpServer({
      input,
      write: (chunk: string) => chunks.push(chunk),
      bridge: async () => {
        bridgeCalled = true;
        return {};
      },
      findFreePort: async () => 45678,
    });
    send(input, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'design_reference', arguments: { topic: 'elements' } } });
    const response = await waitFor(chunks, 1);
    input.end();
    await done;
    expect(bridgeCalled).toBe(false);
    expect(response.result?.content?.[0]?.text).toContain('design_create_elements');

    const apiInput = new PassThrough();
    const apiChunks: string[] = [];
    let apiBridgeCalled = false;
    const apiDone = runMcpServer({
      input: apiInput,
      write: (chunk: string) => apiChunks.push(chunk),
      bridge: async () => { apiBridgeCalled = true; return {}; },
      findFreePort: async () => 45678,
    });
    send(apiInput, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'api_client_reference', arguments: {} } });
    const apiResponse = await waitFor(apiChunks, 2);
    apiInput.end();
    await apiDone;
    expect(apiBridgeCalled).toBe(false);
    expect(apiResponse.result?.content?.[0]?.text).toContain('api_client_replace');
  });

  it('cada tool chama a rota certa com corpo que passa no schema', async () => {
    for (const [tool, expected] of Object.entries(EXPECTED)) {
      const input = new PassThrough();
      const chunks: string[] = [];
      let captured: { method: string; path: string; body: unknown } | null = null;
      const done = runMcpServer({
        input,
        write: (chunk: string) => chunks.push(chunk),
        bridge: async (method: string, path: string, body: unknown) => {
          captured = { method, path, body };
          return { ok: true };
        },
        findFreePort: async () => 45678,
        selfAgent: tool === 'huddle_say' ? '00000000-0000-7000-8000-000000000002' : 'n1',
      });
      send(input, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: TOOL_ARGS[tool] ?? {} } });
      const response = await waitFor(chunks, 1);
      input.end();
      await done.catch(() => {});

      expect(response.error, `${tool}: erro JSON-RPC`).toBeUndefined();
      expect(response.result?.isError, `${tool}: ${response.result?.content?.[0]?.text}`).toBeFalsy();
      expect(captured, `${tool}: bridge nao foi chamada`).not.toBeNull();
      expect(captured!.method, `${tool}: metodo`).toBe(expected.method);
      expect(captured!.path, `${tool}: rota`).toMatch(expected.path);
      if (expected.schema) {
        const parsed = expected.schema.safeParse(captured!.body);
        expect(parsed.success, `${tool}: schema — ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 2))}`).toBe(true);
      }
    }
  });

  it('tools de maestro sem identidade (selfAgent null) dao erro claro, nao 422', async () => {
    for (const tool of ['recruit', 'dismiss', 'portal_create', 'api_client_read', 'api_client_import', 'api_client_create', 'api_client_replace', 'api_client_sync_status', 'api_client_pull', 'api_client_push', 'api_client_export', 'api_client_run_runner', 'image_workflow_create', 'image_workflow_update', 'image_workflow_connect', 'image_workflow_disconnect', 'image_workflow_add_reference', 'image_workflow_run', 'image_workflow_complete', 'image_workflow_fail', 'image_workflow_cancel', 'image_workflow_delete']) {
      const input = new PassThrough();
      const chunks: string[] = [];
      const done = runMcpServer({
        input,
        write: (chunk: string) => chunks.push(chunk),
        bridge: async () => ({ ok: true }),
        findFreePort: async () => 45678,
        selfAgent: null,
      });
      send(input, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: TOOL_ARGS[tool] ?? {} } });
      const response = await waitFor(chunks, 1);
      input.end();
      await done.catch(() => {});
      const text = response.result?.content?.[0]?.text ?? '';
      expect(text, `${tool}: deveria explicar a identidade ausente`).toMatch(/identidade|ORKESTRAI_NODE_ID/i);
    }
  });
});

function send(input: PassThrough, message: Record<string, unknown>) {
  input.write(`${JSON.stringify(message)}\n`);
}
async function waitFor(chunks: string[], id: number): Promise<any> {
  for (let i = 0; i < 200; i += 1) {
    for (const line of chunks.join('').split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === id) return parsed;
      } catch {
        // linha incompleta
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`resposta ${id} nao chegou`);
}
