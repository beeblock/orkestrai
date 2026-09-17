import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreativeStoryboardService } from '$lib/modules/creative-media/application/services/CreativeStoryboardService.js';
import { CreativeStoryboardRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeStoryboardRepository.js';
import { storyboardSceneContentSchema, type CreativeStoryboardCommand } from '$lib/modules/creative-media/contracts/schemas/creative-storyboard.schema.js';
import type { CreativeStoryboard } from '$lib/modules/creative-media/domain/storyboard.js';
import { creativeMediaRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeMediaRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { CanvasNodeTransferService } from '$lib/modules/agent-room/application/services/CanvasNodeTransferService.js';
import { TransferCanvasNodesDto } from '$lib/modules/agent-room/application/dto/TransferCanvasNodesDto.js';

vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined) } }));
const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
describe('revisioned storyboards share the native workspace', () => {
  useSvelarTest({ refreshDatabase: true });
  async function fixture() {
    const folder = await mkdtemp(join(tmpdir(), 'orkestrai-storyboard-')); folders.push(folder);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Storyboard test', workingDir: folder });
    const gateway = new CreativeWorkspaceGateway(), service = new CreativeStoryboardService(new CreativeStoryboardRepository(), gateway);
    const execute = (input: CreativeStoryboardCommand) => service.execute(workspace.id, input, { type: 'user' }) as Promise<CreativeStoryboard>;
    const board = await execute({ command: 'create', title: 'Campaign' });
    const sceneId = uuidv7();
    const scene = { id: sceneId, ...storyboardSceneContentSchema.parse({ title: 'Opening', direction: 'The same character enters the shop.', dialogue: 'Welcome', duration: 5 }) };
    return { service, gateway, workspace, execute, board, scene, sceneId };
  }
  it('persists operations and rejects stale or cross-workspace writes', async () => {
    const f = await fixture();
    const saved = await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'add', scene: f.scene }] });
    expect(saved.revision).toBe(2);
    expect((await new CreativeStoryboardService().read(f.workspace.id, f.board.nodeId)).storyboard).toEqual(saved);
    await expect(f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'rename', title: 'Wrong' }] })).rejects.toThrow('creative_revision_conflict');
    await expect(f.service.read(uuidv7(), f.board.nodeId)).rejects.toThrow('creative_storyboard_not_found');
    expect((await workspaceRepository.getNode(f.board.nodeId))?.payload).toMatchObject({ revision: 2 });
  });
  it('creates image and video drafts without executing or charging, and detects stale briefs', async () => {
    const f = await fixture();
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'add', scene: f.scene }] });
    const image = await f.execute({ command: 'materialize', nodeId: f.board.nodeId, revision: 2, sceneId: f.sceneId, kind: 'image' });
    const imageId = image.document.scenes[0].imageWorkflowNodeId!;
    expect((await workspaceRepository.getNode(imageId))?.payload).toMatchObject({ prompt: f.scene.direction, status: 'idle' });
    const same = await f.execute({ command: 'materialize', nodeId: f.board.nodeId, revision: 3, sceneId: f.sceneId, kind: 'image' });
    expect(same.document.scenes[0].imageWorkflowNodeId).toBe(imageId);
    const video = await f.execute({ command: 'materialize', nodeId: f.board.nodeId, revision: 4, sceneId: f.sceneId, kind: 'video' });
    const videoId = video.document.scenes[0].videoWorkflowNodeId!;
    expect((await creativeMediaRepository.workflow(f.workspace.id, videoId))?.config.prompt).toContain('Dialogue (en-US): Welcome');
    expect(await creativeMediaRepository.runs(f.workspace.id, videoId)).toEqual([]);
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 5, operations: [{ type: 'update', id: f.sceneId, patch: { direction: 'Changed' } }] });
    expect((await f.service.read(f.workspace.id, f.board.nodeId)).progress[0]).toMatchObject({ imageStale: true, videoStale: true });
    expect((await workspaceRepository.getNode(imageId))?.payload).toMatchObject({ prompt: f.scene.direction });
  });
  it('validates the entire batch before writing and rolls back prepared nodes on failure', async () => {
    const f = await fixture();
    await expect(f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'add', scene: f.scene }, { type: 'add', scene: { ...f.scene, id: uuidv7(), referenceNodeIds: [uuidv7()] } }] })).rejects.toThrow('creative_reference_unavailable');
    expect((await f.service.read(f.workspace.id, f.board.nodeId)).storyboard.document.scenes).toEqual([]);
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'add', scene: f.scene }] });
    vi.spyOn(f.service.repository, 'update').mockRejectedValueOnce(new Error('commit failure'));
    await expect(f.execute({ command: 'materialize', nodeId: f.board.nodeId, revision: 2, sceneId: f.sceneId, kind: 'image' })).rejects.toThrow('commit failure');
    expect((await workspaceRepository.listNodes(f.workspace.id)).map(node => node.type)).toEqual(['storyboard']);
  });
  it('can repair a deleted reference without discarding unrelated scenes or outputs', async () => {
    const f = await fixture();
    const input = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'image', title: 'Reference', payload: { path: 'reference.png' }, x: 0, y: 0, width: 200, height: 200 });
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'add', scene: { ...f.scene, referenceNodeIds: [input.id] } }] });
    await workspaceRepository.deleteNode(input.id);
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 2, operations: [{ type: 'update', id: f.sceneId, patch: { title: 'Recoverable' } }] });
    await expect(f.execute({ command: 'materialize', nodeId: f.board.nodeId, revision: 3, sceneId: f.sceneId, kind: 'image' })).rejects.toThrow('creative_reference_unavailable');
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 3, operations: [{ type: 'update', id: f.sceneId, patch: { referenceNodeIds: [] } }] });
    expect((await f.service.read(f.workspace.id, f.board.nodeId)).storyboard.document.scenes[0].title).toBe('Recoverable');
  });
  it('requires assigned agent tasks and preserves native outputs when removing a board', async () => {
    const f = await fixture();
    await expect(f.service.execute(f.workspace.id, { command: 'read', nodeId: f.board.nodeId }, { type: 'agent', nodeId: uuidv7(), taskId: uuidv7() })).rejects.toThrow('creative_agent_task_required');
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'add', scene: f.scene }] });
    const saved = await f.execute({ command: 'materialize', nodeId: f.board.nodeId, revision: 2, sceneId: f.sceneId, kind: 'image' });
    await f.execute({ command: 'remove', nodeId: f.board.nodeId, revision: 3 });
    expect(await f.service.repository.read(f.workspace.id, f.board.nodeId)).toBeNull();
    expect(await workspaceRepository.getNode(saved.document.scenes[0].imageWorkflowNodeId!)).not.toBeNull();
  });
  it('copies a storyboard with selected workflow links and moves its document atomically', async () => {
    const f = await fixture(), target = await fixture();
    await f.execute({ command: 'apply', nodeId: f.board.nodeId, revision: 1, operations: [{ type: 'add', scene: f.scene }] });
    const saved = await f.execute({ command: 'materialize', nodeId: f.board.nodeId, revision: 2, sceneId: f.sceneId, kind: 'image' });
    const transfer = new CanvasNodeTransferService();
    const copied = await transfer.transfer(new TransferCanvasNodesDto(f.workspace.id, target.workspace.id, [f.board.nodeId, saved.document.scenes[0].imageWorkflowNodeId!], 'copy'));
    const targetBoard = copied.nodes.find(node => node.type === 'storyboard')!;
    const targetWorkflow = copied.nodes.find(node => node.type === 'imageWorkflow')!;
    const document = (await f.service.read(target.workspace.id, targetBoard.id)).storyboard.document;
    expect(document.scenes[0]).toMatchObject({ imageWorkflowNodeId: targetWorkflow.id, imageBriefHash: null });
    expect(await f.service.repository.read(f.workspace.id, f.board.nodeId)).not.toBeNull();
    await transfer.transfer(new TransferCanvasNodesDto(f.workspace.id, target.workspace.id, [f.board.nodeId], 'move'));
    expect(await f.service.repository.read(f.workspace.id, f.board.nodeId)).toBeNull();
  });
  it('cleans prepared destination documents after a failed transfer without removing source data', async () => {
    const f = await fixture(), target = await fixture();
    const before = await f.service.repository.list(target.workspace.id);
    vi.spyOn(workspaceRepository, 'commitNodeTransfer').mockRejectedValueOnce(new Error('transfer failure'));
    await expect(new CanvasNodeTransferService().transfer(new TransferCanvasNodesDto(f.workspace.id, target.workspace.id, [f.board.nodeId], 'move'))).rejects.toThrow('canvas_transfer_failed');
    expect(await f.service.repository.list(target.workspace.id)).toEqual(before);
    expect(await workspaceRepository.getNode(f.board.nodeId)).not.toBeNull();
    expect(await f.service.repository.read(f.workspace.id, f.board.nodeId)).not.toBeNull();
  });
});
