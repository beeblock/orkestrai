import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { bridgeCanvasService, canvasImageSummary, canvasNodeSummary } from '$lib/modules/agent-room/application/services/BridgeCanvasService.js';
import { BridgeCanvasCommandDto } from '$lib/modules/agent-room/application/dto/BridgeCanvasCommandDto.js';
import { bridgeCanvasCommandSchema } from '$lib/modules/agent-room/contracts/schemas/bridge-canvas.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';

describe('agent Canvas image removal', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  afterEach(async () => {
    ptySessionManager.killAll(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function setup(leader = false, runtime: 'native' | 'wsl' = 'native') {
    const root = await mkdtemp(join(tmpdir(), 'ork-image-removal-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Image cleanup', workingDir: root,
      runtimeKind: runtime, ...(runtime === 'wsl' ? { wslDistribution: 'Ubuntu', wslWorkingDir: '/project' } : {}) });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal',
      payload: { provider: leader ? 'claude' : 'codex', maestro: leader, env: { PRIVATE_TEST_SECRET: 'never-publish' } } });
    const taskId = uuidv7();
    await AgentBoardTask.create({ id: taskId, workspace_id: workspace.id, title: 'Remove rejected images', status: 'doing',
      assignee_node_id: agent.id, created_by: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const file = join(root, 'original image.png'); await writeFile(file, 'original image bytes');
    const image = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'image', title: 'Imported', payload: { path: file } });
    const generated = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'image', title: 'Generated',
      payload: { path: file, generatedBy: { workflowNodeId: uuidv7(), runId: uuidv7(), outputIndex: 0, inputHash: 'source' } } });
    const images = [image, generated].map(node => ({ nodeId: node.id, revision: canvasImageSummary(node)!.revision }));
    const execute = (input: unknown = { command: 'remove_images', images }) => bridgeCanvasService.execute(workspace.id, agent.id,
      new BridgeCanvasCommandDto(bridgeCanvasCommandSchema.parse({ from: agent.id, taskId, input })));
    return { root, workspace, agent, taskId, file, image, generated, images, execute };
  }

  it.each([[false, 'native'], [true, 'native'], [false, 'wsl'], [true, 'wsl']] as const)
  ('removes generated and imported nodes for leader=%s, runtime=%s without deleting files or unrelated nodes', async (leader, runtime) => {
    const f = await setup(leader, runtime);
    const workflow = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'imageWorkflow' });
    const retained = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'image', payload: { path: f.file } });
    await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'computer', payload: { computerConfig: { enabled: false } } });
    const edge = await workspaceRepository.createEdge({ workspaceId: f.workspace.id, sourceNodeId: workflow.id, targetNodeId: f.image.id });
    const retainedEdge = await workspaceRepository.createEdge({ workspaceId: f.workspace.id, sourceNodeId: workflow.id, targetNodeId: retained.id });
    ptySessionManager.create({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: f.root,
      workspaceId: f.workspace.id, nodeId: f.agent.id, bridgeAgentToken: 'live-image-token' });
    const token = await bridgeService.getOrCreateToken(f.workspace.id);
    const url = new URL('http://localhost/api/agent-room/bridge/canvas');
    const broadcast = vi.fn(); vi.stubGlobal('__orkestraiBroadcast', broadcast);
    const response = await new BridgeController().canvasCommand({ url, params: {}, request: new Request(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': 'live-image-token', 'content-type': 'application/json' },
      body: JSON.stringify({ from: f.agent.id, taskId: f.taskId, input: { command: 'remove_images', images: f.images } }) }) } as any) as Response;
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ removedNodeIds: [f.image.id, f.generated.id], filesPreserved: true });
    expect(await workspaceRepository.getNode(f.image.id)).toBeNull();
    expect(await workspaceRepository.getNode(f.generated.id)).toBeNull();
    expect(await workspaceRepository.getNode(retained.id)).not.toBeNull();
    expect(await workspaceRepository.getNode(workflow.id)).not.toBeNull();
    expect(await workspaceRepository.listEdges(f.workspace.id)).not.toContainEqual(edge);
    expect(await workspaceRepository.listEdges(f.workspace.id)).toContainEqual(retainedEdge);
    expect(await readFile(f.file, 'utf8')).toBe('original image bytes');
    expect(broadcast).toHaveBeenCalledWith({ type: 'workspaceChanged', workspaceId: f.workspace.id });
  });

  it.each(['foreign', 'wrong-type', 'stale-payload', 'stale-layout', 'layout-revision', 'archived', 'missing', 'duplicate'])
  ('rejects the complete batch before deleting anything: %s', async reason => {
    const f = await setup(); const images = f.images.map(item => ({ ...item }));
    if (reason === 'foreign') {
      const other = await workspaceRepository.createWorkspace({ name: 'Other', workingDir: f.root });
      const node = await workspaceRepository.createNode({ workspaceId: other.id, type: 'image', payload: { path: f.file } });
      images[1] = { nodeId: node.id, revision: canvasImageSummary(node)!.revision };
    } else if (reason === 'wrong-type') images[1].nodeId = f.agent.id;
    else if (reason === 'missing') images[1].nodeId = uuidv7();
    else if (reason === 'duplicate') images[1] = { ...images[0] };
    else if (reason === 'layout-revision') images[1].revision = canvasNodeSummary(f.generated).revision;
    else if (reason === 'archived') await workspaceRepository.setNodeArchived(f.workspace.id, f.generated.id, true);
    else await workspaceRepository.updateNode(f.generated.id, reason === 'stale-payload' ? { payload: { path: 'new-image.png' } } : { x: 500 });
    await expect(f.execute({ command: 'remove_images', images })).rejects.toThrow();
    expect(await workspaceRepository.getNode(f.image.id)).not.toBeNull();
    expect(await workspaceRepository.getNode(f.generated.id)).not.toBeNull();
    expect(await readFile(f.file, 'utf8')).toBe('original image bytes');
  });

  it('rolls back nodes and edges if a later deletion fails and does not resolve attention prematurely', async () => {
    const f = await setup();
    const edge = await workspaceRepository.createEdge({ workspaceId: f.workspace.id, sourceNodeId: f.agent.id, targetNodeId: f.image.id });
    const original = workspaceRepository.deleteNode.bind(workspaceRepository);
    vi.spyOn(workspaceRepository, 'deleteNode').mockImplementation(async id => {
      if (id === f.generated.id) throw new Error('simulated database failure');
      return original(id);
    });
    const resolve = vi.spyOn(attentionService, 'resolveNode');
    await expect(f.execute()).rejects.toThrow('simulated database failure');
    expect(await workspaceRepository.getNode(f.image.id)).not.toBeNull();
    expect(await workspaceRepository.getNode(f.generated.id)).not.toBeNull();
    expect(await workspaceRepository.listEdges(f.workspace.id)).toContainEqual(edge);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('honors a workspace halt and refuses a stale retry without touching the retained file', async () => {
    const f = await setup(); await autonomyPolicyService.emergencyStop(f.workspace.id);
    await expect(f.execute()).rejects.toThrow(); expect(await workspaceRepository.getNode(f.image.id)).not.toBeNull();
    const other = await setup(); await other.execute();
    await expect(other.execute()).rejects.toThrow('not in this workspace');
    expect(await readFile(other.file, 'utf8')).toBe('original image bytes');
  });

  it.each(['token', 'actor', 'task'])('requires the live assigned agent, not a forged %s', async wrong => {
    const f = await setup(); const token = await bridgeService.getOrCreateToken(f.workspace.id);
    ptySessionManager.create({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: f.root,
      workspaceId: f.workspace.id, nodeId: f.agent.id, bridgeAgentToken: 'live-image-token' });
    const other = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', payload: { provider: 'claude', maestro: true } });
    if (wrong === 'task') await AgentBoardTask.query().where('id', f.taskId).update({ assignee_node_id: other.id });
    const url = new URL('http://localhost/api/agent-room/bridge/canvas');
    const response = await new BridgeController().canvasCommand({ url, params: {}, request: new Request(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': wrong === 'token' ? 'invalid-token' : 'live-image-token', 'content-type': 'application/json' },
      body: JSON.stringify({ from: wrong === 'actor' ? other.id : f.agent.id, taskId: f.taskId, input: { command: 'remove_images', images: f.images } }) }) } as any) as Response;
    expect(response.status).toBe(400);
    expect(await workspaceRepository.getNode(f.image.id)).not.toBeNull();
  });

  it.each(['halt', 'task'])('rechecks a %s change after policy approval but before the database mutation', async change => {
    const f = await setup();
    const execute = autonomyPolicyService.execute.bind(autonomyPolicyService);
    vi.spyOn(autonomyPolicyService, 'execute').mockImplementation((request, callback) => execute(request, async () => {
      if (change === 'halt') await autonomyPolicyService.emergencyStop(f.workspace.id);
      else await AgentBoardTask.query().where('id', f.taskId).update({ status: 'done' });
      return callback();
    }));
    await expect(f.execute()).rejects.toThrow();
    expect(await workspaceRepository.getNode(f.image.id)).not.toBeNull();
    expect(await workspaceRepository.getNode(f.generated.id)).not.toBeNull();
    expect(await readFile(f.file, 'utf8')).toBe('original image bytes');
  });

  it('exposes opaque image revisions without payloads and rejects file-deletion options or unbounded batches', async () => {
    const f = await setup();
    const inventory = await bridgeCanvasService.list(f.workspace.id, { includeArchived: false, limit: 100 });
    expect(inventory.nodes.find(node => node.nodeId === f.image.id)!.image).toEqual({ revision: f.images[0].revision });
    expect(JSON.stringify(inventory)).not.toContain(f.file);
    expect(JSON.stringify(inventory)).not.toContain('never-publish');
    for (const input of [{ command: 'remove_images', images: [] },
      { command: 'remove_images', images: Array.from({ length: 51 }, () => f.images[0]) },
      { command: 'remove_images', images: f.images, deleteFiles: true }]) {
      expect(bridgeCanvasCommandSchema.safeParse({ from: f.agent.id, taskId: f.taskId, input }).success).toBe(false);
    }
  });
});
