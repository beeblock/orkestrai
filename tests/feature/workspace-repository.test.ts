import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AgentCanvasNode } from '$lib/modules/agent-room/domain/models/AgentCanvasNode.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { secretRefService, secretStorageKey } from '$lib/modules/agent-room/application/services/SecretRefService.js';
import { desktopSecretService } from '$lib/modules/agent-room/infrastructure/secrets/DesktopSecretService.js';
import { AgentAutonomyPolicy } from '$lib/modules/agent-room/domain/models/AgentAutonomyPolicy.js';
import { AgentAutonomyAuditEvent } from '$lib/modules/agent-room/domain/models/AgentAutonomyAuditEvent.js';
import { AgentApprovalGate } from '$lib/modules/agent-room/domain/models/AgentApprovalGate.js';
import { AgentAutomationIntegration } from '$lib/modules/agent-room/domain/models/AgentAutomationIntegration.js';
import { AgentIntegrationEvent } from '$lib/modules/agent-room/domain/models/AgentIntegrationEvent.js';
import { AgentWorkspaceToolRevision } from '$lib/modules/agent-room/domain/models/AgentWorkspaceToolRevision.js';
import { agentWorkspaceToolRepository } from '$lib/modules/agent-room/infrastructure/repositories/AgentWorkspaceToolRepository.js';
import { workspaceToolManifestSchema } from '$lib/modules/agent-room/contracts/schemas/agent-workspace-tool.schema.js';

describe('WorkspaceRepository', () => {
  useSvelarTest({ refreshDatabase: true });

  it('cria, atualiza, lista e apaga workspaces com cascata de nos e arestas', async () => {
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Orkestrai',
      workingDir: '/tmp/orkestrai',
      icon: '🏛️',
    });
    expect(workspace.name).toBe('Orkestrai');
    expect(workspace.syncAgentInstructionFiles).toBe(false);
    expect(workspace.runtimeKind).toBe('native');
    expect(workspace.wslDistribution).toBeNull();
    expect(workspace.wslWorkingDir).toBeNull();

    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Claude',
      x: 10,
      y: 20,
      payload: { command: 'claude', provider: 'claude' },
    });
    const note = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'note',
      payload: { content: '# tarefa' },
    });
    const edge = await workspaceRepository.createEdge({
      workspaceId: workspace.id,
      sourceNodeId: node.id,
      targetNodeId: note.id,
    });

    expect(await workspaceRepository.listNodes(workspace.id)).toHaveLength(2);
    expect(await workspaceRepository.listEdges(workspace.id)).toHaveLength(1);

    const updated = await workspaceRepository.updateWorkspace(workspace.id, { syncAgentInstructionFiles: true });
    expect(updated?.syncAgentInstructionFiles).toBe(true);

    expect(await workspaceRepository.deleteWorkspace(workspace.id)).toBe(true);
    expect(await workspaceRepository.listNodes(workspace.id)).toHaveLength(0);
    expect(await workspaceRepository.listEdges(workspace.id)).toHaveLength(0);
    expect(edge.style).toBe('cord');
  });

  it('valida nome e diretorio vazios', async () => {
    await expect(workspaceRepository.createWorkspace({ name: '  ', workingDir: '/tmp' })).rejects.toThrow('vazio');
    await expect(workspaceRepository.createWorkspace({ name: 'x', workingDir: ' ' })).rejects.toThrow('diretorio');
  });

  it('deletes policy, audit, credentials, integration events and tools only for the requested workspace', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Delete fixture', workingDir: '/tmp' });
    const other = await workspaceRepository.createWorkspace({ name: 'Keep fixture', workingDir: '/tmp' });
    const now = new Date();
    for (const id of [workspace.id, other.id]) {
      await autonomyPolicyService.recordSemanticEffect({ workspaceId: id, capability: 'filesystem', operation: 'test:read', mutation: false, actorType: 'user', actorId: 'owner' });
    }
    const secret = await secretRefService.create(workspace.id, { name: 'Fixture', provider: 'desktop', bindings: { integrations: [], operations: [], destinations: [] } });
    const keepSecret = await secretRefService.create(other.id, { name: 'Keep', provider: 'desktop', bindings: { integrations: [], operations: [], destinations: [] } });
    await AgentApprovalGate.create({ id: uuidv7(), workspace_id: workspace.id, risk: 'external_publication', capability: 'browser', summary: 'Pending fixture', request_digest: 'fixture', created_at: now, updated_at: now });
    const integrationId = uuidv7();
    await AgentAutomationIntegration.create({ id: integrationId, workspace_id: workspace.id, type: 'webhook', name: 'Fixture', created_at: now, updated_at: now });
    await AgentIntegrationEvent.create({ id: uuidv7(), workspace_id: workspace.id, integration_id: integrationId, direction: 'inbound', kind: 'fixture', idempotency_key: 'fixture', created_at: now, updated_at: now });
    const tool = await agentWorkspaceToolRepository.create({ workspaceId: workspace.id, nodeId: null, name: 'Fixture', slug: 'fixture', description: '', createdBy: { type: 'user', id: 'owner' }, manifest: workspaceToolManifestSchema.parse({ schemaVersion: 1, executor: { kind: 'transform', operations: [{ kind: 'set', path: 'ok', value: true }] }, inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, capabilities: ['tool'] }) });
    await agentWorkspaceToolRepository.startRun({ workspaceId: workspace.id, toolId: tool.id, revision: 1, actor: { type: 'user', id: 'owner' }, automationRunId: null, idempotencyKey: 'fixture', requestDigest: 'fixture', input: {}, startedAt: now.toISOString() });
    const removeSecret = vi.spyOn(desktopSecretService, 'delete').mockResolvedValue();
    try {
      expect(await workspaceRepository.deleteWorkspace(workspace.id)).toBe(true);
      expect(await workspaceRepository.getWorkspace(workspace.id)).toBeNull();
      expect(await AgentAutonomyPolicy.query().where('workspace_id', workspace.id).count()).toBe(0);
      expect(await autonomyPolicyService.listAudit(workspace.id)).toHaveLength(0);
      expect(await AgentApprovalGate.query().where('workspace_id', workspace.id).count()).toBe(0);
      expect(await AgentIntegrationEvent.query().where('workspace_id', workspace.id).count()).toBe(0);
      expect(await agentWorkspaceToolRepository.list(workspace.id)).toHaveLength(0);
      expect(await agentWorkspaceToolRepository.listRuns(workspace.id)).toHaveLength(0);
      expect(await AgentWorkspaceToolRevision.query().where('tool_id', tool.id).count()).toBe(0);
      expect(await secretRefService.list(workspace.id)).toHaveLength(0);
      expect(removeSecret).toHaveBeenCalledExactlyOnceWith(secretStorageKey(workspace.id, secret.id));
      expect(await workspaceRepository.getWorkspace(other.id)).not.toBeNull();
      expect(await AgentAutonomyAuditEvent.query().where('workspace_id', other.id).count()).toBe(1);
      expect(await secretRefService.list(other.id)).toEqual([keepSecret]);
    } finally { removeSecret.mockRestore(); }
  });

  it('move/redimensiona nos e apaga no removendo arestas ligadas', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'w', workingDir: '/tmp' });
    const a = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
    const b = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'note' });
    await workspaceRepository.createEdge({ workspaceId: workspace.id, sourceNodeId: a.id, targetNodeId: b.id });

    const moved = await workspaceRepository.updateNode(a.id, { x: 400, y: 300, width: 640 });
    expect(moved?.x).toBe(400);
    expect(moved?.width).toBe(640);

    expect(await workspaceRepository.deleteNode(a.id)).toBe(true);
    expect(await workspaceRepository.listEdges(workspace.id)).toHaveLength(0);
  });

  it('updates only requested node columns so payload writes cannot reset a concurrent drag', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'partial', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'imageWorkflow',
      x: 120,
      y: 240,
      width: 440,
      height: 560,
      payload: { status: 'idle' },
    });
    const update = vi.spyOn(AgentCanvasNode.prototype, 'update');

    await workspaceRepository.updateNode(node.id, { payload: { status: 'running' } });

    expect(update).toHaveBeenLastCalledWith({ payload_json: JSON.stringify({ status: 'running' }) });
    update.mockRestore();
  });

  it('alterna estilo da aresta (cord/circuit)', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'w', workingDir: '/tmp' });
    const a = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
    const b = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
    const edge = await workspaceRepository.createEdge({ workspaceId: workspace.id, sourceNodeId: a.id, targetNodeId: b.id });

    const updated = await workspaceRepository.updateEdgeStyle(edge.id, 'circuit');
    expect(updated?.style).toBe('circuit');
    expect(await workspaceRepository.deleteEdge(edge.id)).toBe(true);
  });
});
