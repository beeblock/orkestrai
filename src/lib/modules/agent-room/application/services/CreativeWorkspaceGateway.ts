import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { findFreeCanvasPosition } from '../../domain/canvas-placement.js';
import type { CanvasNode, CanvasNodePayload, Workspace } from '../../domain/types.js';
import { workspacePathService } from './WorkspacePathService.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
import { brandBrief, type CreativeBrandKit } from '$lib/modules/creative-media/domain/brand-kit.js';

/** Narrow workspace facade for the creative-media module. */
export class CreativeWorkspaceGateway {
  async placeBrand(kit: CreativeBrandKit, position = { x: 100, y: 100 }, floorId: string | null = null) {
    const { workspaceId } = kit;
    await this.characterDestination(workspaceId, floorId);
    const all = (await this.nodes(workspaceId)).filter(node => (node.floorId ?? null) === floorId);
    const width = 888, height = Math.max(420, Math.ceil(kit.definition.assets.length / 2) * 280 + 64);
    const origin = findFreeCanvasPosition(all, { ...position, width, height });
    const identity = { brandKitId: kit.id, brandVersion: kit.version, brandDigest: kit.snapshot!.digest };
    const note = await workspaceRepository.createNode({ workspaceId, floorId, type: 'note', title: `${kit.definition.name} · v${kit.version}`, x: origin.x + 24, y: origin.y + 32, width: 300, height: 360, payload: { ...identity, formatted: true, color: 'neutral', content: brandBrief(kit) } });
    const nodes: CanvasNode[] = [note], edges = [];
    for (const [index, asset] of kit.definition.assets.entries()) {
      const image = await workspaceRepository.createNode({ workspaceId, floorId, type: 'image', title: asset.label, x: origin.x + 344 + (index % 2) * 264, y: origin.y + 32 + Math.floor(index / 2) * 280, width: 240, height: 256, payload: { ...identity, path: asset.path } });
      nodes.push(image);
      edges.push(await workspaceRepository.createEdge({ workspaceId, sourceNodeId: note.id, targetNodeId: image.id, style: 'cord' }));
    }
    const group = await workspaceRepository.createNode({ workspaceId, floorId, type: 'group', title: `${kit.definition.name} · v${kit.version}`, ...origin, width, height, zIndex: -1, payload: { ...identity, workflowKind: 'creative-brand', members: nodes.map(node => node.id) } });
    return { nodes: [group, ...nodes], edges };
  }
  async characterDestination(workspaceId: string, floorId: string | null) {
    const workspace = await this.workspace(workspaceId);
    if (!workspace || workspace.suspendedAt) throw new Error('creative_workspace_unavailable');
    if (floorId && !await AgentFloor.query().where('id', floorId).where('workspace_id', workspaceId).first()) throw new Error('creative_workspace_unavailable');
  }
  async placeCharacter(character: CreativeCharacter, position = { x: 100, y: 100 }, floorId: string | null = null) {
    const { workspaceId } = character;
    await this.characterDestination(workspaceId, floorId);
    const all = (await this.nodes(workspaceId)).filter(node => (node.floorId ?? null) === floorId);
    const count = character.definition.images.length;
    const width = 888, height = Math.max(380, Math.ceil(count / 2) * 280 + 64);
    const origin = findFreeCanvasPosition(all, { ...position, width, height });
    // The character service wraps the profile and this whole bundle in one transaction.
    const nodes: CanvasNode[] = [], edges = [];
    const identity = { characterId: character.id, characterVersion: character.version, characterDigest: character.snapshot!.digest };
    const note = await workspaceRepository.createNode({ workspaceId, floorId, type: 'note', title: `${character.definition.name} · v${character.version}`, x: origin.x + 24, y: origin.y + 32, width: 300, height: 320, payload: { ...identity, formatted: true, color: 'neutral', content: `# ${character.definition.name}\n\n${character.definition.appearance}\n\n\`\`\`json\n${JSON.stringify({ ...identity, ...character.definition }, null, 2)}\n\`\`\`` } });
    nodes.push(note);
    for (let i = 0; i < count; i++) {
      const image = await workspaceRepository.createNode({ workspaceId, floorId, type: 'image', title: `${character.definition.name} · ${i + 1}`, x: origin.x + 344 + (i % 2) * 264, y: origin.y + 32 + Math.floor(i / 2) * 280, width: 240, height: 256, payload: { ...identity, path: character.definition.images[i] } });
      nodes.push(image);
      edges.push(await workspaceRepository.createEdge({ workspaceId, sourceNodeId: note.id, targetNodeId: image.id, style: 'cord' }));
    }
    const group = await workspaceRepository.createNode({ workspaceId, floorId, type: 'group', title: `${character.definition.name} · v${character.version}`, ...origin, width, height, zIndex: -1, payload: { ...identity, workflowKind: 'creative-character', members: nodes.map(node => node.id) } });
    nodes.unshift(group);
    return { nodes, edges };
  }
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
  async createNode(workspaceId: string, type: 'image' | 'storyboard' | 'video' | 'videoWorkflow', title: string, payload: CanvasNodePayload, nearId?: string) {
    const nodes = await this.nodes(workspaceId);
    const near = nodes.find(node => node.id === nearId);
    const size = type === 'storyboard' ? { width: 860, height: 600 } : type === 'image' ? { width: 280, height: 300 } : { width: type === 'video' ? 520 : 460, height: type === 'video' ? 390 : 640 };
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
  async createStoryboardNode(workspaceId: string, title: string, floorId: string | null, position?: { x: number; y: number }, nearId?: string) {
    await this.characterDestination(workspaceId, floorId);
    const all = (await this.nodes(workspaceId)).filter(node => (node.floorId ?? null) === floorId);
    const origin = findFreeCanvasPosition(all, { ...(position ?? { x: 100, y: 100 }), width: 860, height: 600 });
    const node = await workspaceRepository.createNode({ workspaceId, floorId, type: 'storyboard', title, ...origin, width: 860, height: 600, payload: { schemaVersion: 1 } });
    if (nearId) await this.connect(workspaceId, nearId, node.id);
    return node;
  }
  async createImageDraft(workspaceId: string, input: unknown, nearId: string, executorId: string | null, references: string[]) {
    const { imageWorkflowService } = await import('./ImageWorkflowService.js');
    return imageWorkflowService.createDraft(workspaceId, input, nearId, executorId, references);
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
