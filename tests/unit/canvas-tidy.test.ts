import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasTidyService } from '$lib/modules/agent-room/application/services/CanvasTidyService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { settingsService } from '$lib/modules/agent-room/application/services/SettingsService.js';

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id, workspaceId: 'ws', type, title: id, x: 0, y: 0, width: 280, height: 240, zIndex: 0, floorId: null, payload: {}, ...extra,
}) as any;

describe('CanvasTidyService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('archives a finished workflow with its briefing note and gathers its images by the agent', async () => {
    const nodes = [
      node('lead', 'terminal', { x: 0, y: 0, width: 600, height: 400, title: 'Codex Lider', payload: { provider: 'codex' } }),
      node('wf', 'imageWorkflow', { x: 800, y: 0, payload: { status: 'succeeded', history: [{ executorNodeId: 'lead' }] } }),
      node('wf-running', 'imageWorkflow', { x: 800, y: 600, payload: { status: 'running' } }),
      node('brief', 'note', { x: 1200, y: 0 }),
      node('shared', 'note', { x: 1200, y: 600 }),
      node('out', 'image', { x: 1600, y: 300, payload: { path: 'generated/a.png', generatedBy: { workflowNodeId: 'wf', runId: 'r', outputIndex: 0, inputHash: 'h' } } }),
      node('ref', 'image', { x: 400, y: 900, payload: { path: 'refs/b.png' } }),
    ];
    const edges = [
      ['lead', 'wf'], ['brief', 'wf'], ['brief', 'lead'], ['shared', 'wf'], ['shared', 'wf-running'], ['wf', 'out'], ['ref', 'wf'],
    ].map(([sourceNodeId, targetNodeId], index) => ({ id: `e${index}`, workspaceId: 'ws', sourceNodeId, targetNodeId }));
    vi.spyOn(workspaceRepository, 'listNodes').mockResolvedValue(nodes);
    vi.spyOn(workspaceRepository, 'listEdges').mockResolvedValue(edges as any);
    vi.spyOn(settingsService, 'get').mockResolvedValue('pt-BR');
    const createNode = vi.spyOn(workspaceRepository, 'createNode').mockImplementation(async (input: any) => ({ ...input, id: 'group-1' }));
    const updateNode = vi.spyOn(workspaceRepository, 'updateNode').mockResolvedValue(null);
    const archived: string[] = [];
    vi.spyOn(workspaceRepository, 'setNodeArchived').mockImplementation(async (_ws, id, value) => { if (value) archived.push(id); });

    const result = await new CanvasTidyService().tidyWorkflows('ws', ['wf']);

    expect(archived.sort()).toEqual(['brief', 'wf']);
    expect(result.gathered).toEqual(['out']);
    expect(createNode).toHaveBeenCalledWith(expect.objectContaining({
      type: 'group', title: 'Codex Lider · imagens', payload: expect.objectContaining({ workflowKind: 'generated-images', ownerNodeId: 'lead' }),
    }));
    // The image moved into the group; the reference image stayed where it was.
    expect(updateNode).toHaveBeenCalledWith('out', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(updateNode).not.toHaveBeenCalledWith('ref', expect.anything());
    expect(updateNode).toHaveBeenCalledWith('group-1', expect.objectContaining({ payload: expect.objectContaining({ members: ['out'] }) }));
  });

  it('leaves running workflows alone', async () => {
    vi.spyOn(workspaceRepository, 'listNodes').mockResolvedValue([node('wf', 'imageWorkflow', { payload: { status: 'running' } })]);
    vi.spyOn(workspaceRepository, 'listEdges').mockResolvedValue([]);
    const archive = vi.spyOn(workspaceRepository, 'setNodeArchived').mockResolvedValue();
    expect(await new CanvasTidyService().tidyWorkflows('ws', ['wf'])).toEqual({ archived: [], gathered: [] });
    expect(archive).not.toHaveBeenCalled();
  });
});
