import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AgentCanvasNode } from '$lib/modules/agent-room/domain/models/AgentCanvasNode.js';

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
