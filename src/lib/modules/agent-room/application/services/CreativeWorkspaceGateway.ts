import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { findFreeCanvasPosition } from '../../domain/canvas-placement.js';
import type { CanvasNode, CanvasNodePayload, Workspace } from '../../domain/types.js';
import { workspacePathService } from './WorkspacePathService.js';

/** Narrow workspace facade for the creative-media module. */
export class CreativeWorkspaceGateway {
  async workspace(id: string): Promise<Workspace | null> { return workspaceRepository.getWorkspace(id); }
  async nodes(workspaceId: string): Promise<CanvasNode[]> { return workspaceRepository.listNodes(workspaceId); }
  async node(workspaceId: string, id: string): Promise<CanvasNode | null> {
    return (await this.nodes(workspaceId)).find(node => node.id === id) ?? null;
  }
  async actorCanWork(workspaceId: string, nodeId: string, taskId: string): Promise<boolean> {
    const node = await this.node(workspaceId, nodeId);
    const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).first();
    return Boolean(node?.type === 'terminal' && task && !task.getAttribute('archived_at') && task.getAttribute('status') !== 'done' && task.getAttribute('assignee_node_id') === nodeId);
  }
  async createNode(workspaceId: string, type: 'video' | 'videoWorkflow', title: string, payload: CanvasNodePayload, nearId?: string) {
    const nodes = await this.nodes(workspaceId);
    const near = nodes.find(node => node.id === nearId);
    const size = { width: type === 'video' ? 520 : 460, height: type === 'video' ? 390 : 640 };
    const floorId = near?.floorId ?? null;
    const rect = findFreeCanvasPosition(nodes.filter(node => (node.floorId ?? null) === floorId), { x: near ? near.x + near.width + 64 : 100, y: near?.y ?? 100, ...size });
    const node = await workspaceRepository.createNode({ workspaceId, type, title, payload, floorId, ...size, ...rect });
    if (near) await this.connect(workspaceId, near.id, node.id);
    this.broadcast(workspaceId);
    return node;
  }
  async updateNode(workspaceId: string, nodeId: string, title: string, payload: CanvasNodePayload) {
    if (!await this.node(workspaceId, nodeId)) return;
    await workspaceRepository.updateNode(nodeId, { title, payload });
    this.broadcast(workspaceId);
  }
  async deleteNode(workspaceId: string, nodeId: string) {
    if (await this.node(workspaceId, nodeId)) await workspaceRepository.deleteNode(nodeId);
    this.broadcast(workspaceId);
  }
  async connect(workspaceId: string, source: string, target: string) {
    if (!await this.node(workspaceId, source) || !await this.node(workspaceId, target)) return;
    const edges = await workspaceRepository.listEdges(workspaceId);
    if (!edges.some(edge => (edge.sourceNodeId === source && edge.targetNodeId === target) || (edge.sourceNodeId === target && edge.targetNodeId === source))) {
      await workspaceRepository.createEdge({ workspaceId, sourceNodeId: source, targetNodeId: target, style: 'cord' });
    }
  }
  async existingPath(workspaceId: string, path: string) {
    const workspace = await this.workspace(workspaceId);
    if (!workspace) throw new Error('creative_workspace_not_found');
    return workspacePathService.resolveExisting(workspace, path);
  }
  async writablePath(workspaceId: string, path: string) {
    const workspace = await this.workspace(workspaceId);
    if (!workspace) throw new Error('creative_workspace_not_found');
    return workspacePathService.resolveWritable(workspace, path);
  }
  broadcast(workspaceId: string) {
    const runtime = globalThis as typeof globalThis & { __orkestraiBroadcast?: (event: unknown) => void };
    runtime.__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId });
  }
}
export const creativeWorkspaceGateway = new CreativeWorkspaceGateway();
