import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreativeRecipeService } from '$lib/modules/creative-media/application/services/CreativeRecipeService.js';
import { creativeStoryboardService } from '$lib/modules/creative-media/application/services/CreativeStoryboardService.js';
import { creativeStoryboardRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeStoryboardRepository.js';
import { creativeRecipeRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeRecipeRepository.js';
import { creativeMediaRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeMediaRepository.js';
import { creativeWorkflowService } from '$lib/modules/creative-media/application/services/CreativeWorkflowService.js';
import { creativeCharacterService } from '$lib/modules/creative-media/application/services/CreativeCharacterService.js';
import { creativeCharacterDefinitionSchema } from '$lib/modules/creative-media/contracts/schemas/creative-character.schema.js';
import { CreativeMediaDto } from '$lib/modules/creative-media/application/dto/CreativeMediaDto.js';
import { ExecuteCreativeMediaAction } from '$lib/modules/creative-media/application/actions/ExecuteCreativeMediaAction.js';
import { creativeRecipeBindingsSchema, type CreativeRecipeCommand } from '$lib/modules/creative-media/contracts/schemas/creative-recipe.schema.js';
import { storyboardSceneContentSchema } from '$lib/modules/creative-media/contracts/schemas/creative-storyboard.schema.js';
import type { CreativeStoryboard } from '$lib/modules/creative-media/domain/storyboard.js';
import type { CreativeRecipe } from '$lib/modules/creative-media/domain/creative-recipe.js';
import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';

vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined) } }));
const folders: string[] = [], user = { type: 'user' as const };
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
describe('reusable native creative workflows', () => {
  useSvelarTest({ refreshDatabase: true });
  async function fixture() {
    const folder = await mkdtemp(join(tmpdir(), 'orkestrai-recipe-')); folders.push(folder);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Recipe test', workingDir: folder });
    await writeFile(join(folder, 'product.png'), await readFile('electron/resources/icons/512x512.png'));
    const image = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'image', title: 'Product master', x: 0, y: 0, width: 200, height: 200, payload: { path: 'product.png' } });
    const initial = await creativeStoryboardService.execute(workspace.id, { command: 'create', title: 'Product campaign' }, user) as CreativeStoryboard;
    const board = await creativeStoryboardService.execute(workspace.id, { command: 'apply', nodeId: initial.nodeId, revision: 1, operations: [{ type: 'add', scene: storyboardSceneContentSchema.parse({ title: 'Opening', direction: 'Show the product. {{script}}', referenceNodeIds: [image.id], aspectRatio: '9:16' }) }] }, user) as CreativeStoryboard;
    const service = new CreativeRecipeService();
    const execute = (input: CreativeRecipeCommand) => service.execute(workspace.id, input, user);
    const recipe = await execute({ command: 'capture', capture: { sourceNodeId: board.nodeId, revision: board.revision, name: 'Product launch', description: 'Reusable introduction' } }) as CreativeRecipe;
    return { folder, workspace, image, board, service, execute, recipe };
  }
  it('captures immutable allowlisted scenes and versions without execution state or paths', async () => {
    const f = await fixture();
    expect(f.recipe.definition.inputs).toEqual([{ key: 'reference-1', kind: 'image', label: 'Product master', scenes: [0] }]);
    const serialized = JSON.stringify(f.recipe.definition);
    for (const value of ['product.png', f.image.id, 'imageWorkflowNodeId', 'executorNodeId', 'profileId', 'activeRun', 'token']) expect(serialized).not.toContain(value);
    expect(f.recipe.digest).toMatch(/^[a-f0-9]{64}$/);
    const next = await f.execute({ command: 'capture', capture: { sourceNodeId: f.board.nodeId, revision: f.board.revision, name: 'Product launch v2', description: '', previousId: f.recipe.id } }) as CreativeRecipe;
    expect(next).toMatchObject({ familyId: f.recipe.familyId, version: 2 });
    expect(await f.service.read(f.workspace.id, f.recipe.id)).toEqual(f.recipe);
    await expect(f.execute({ command: 'capture', capture: { sourceNodeId: f.board.nodeId, revision: 1, name: 'stale', description: '' } })).rejects.toThrow('creative_revision_conflict');
  });
  it('instantiates in another workspace using explicit local inputs and exact output format', async () => {
    const f = await fixture(), target = await fixture();
    const bindings = creativeRecipeBindingsSchema.parse({ script: 'Keep {{character}} literal, no recursive interpolation.', aspectRatio: '9:16', values: [{ key: 'reference-1', id: target.image.id }] });
    const result = await target.execute({ command: 'instantiate', id: f.recipe.id, sourceWorkspaceId: f.workspace.id, bindings }) as { nodeId: string; storyboard: CreativeStoryboard };
    const scene = result.storyboard.document.scenes[0];
    expect(scene).toMatchObject({ direction: 'Show the product. Keep {{character}} literal, no recursive interpolation.', referenceNodeIds: [target.image.id], aspectRatio: '9:16', executorNodeId: null, imageWorkflowNodeId: null, videoWorkflowNodeId: null });
    expect((await workspaceRepository.listNodes(target.workspace.id)).filter(node => ['imageWorkflow', 'videoWorkflow'].includes(node.type))).toEqual([]);
    const image = await creativeStoryboardService.execute(target.workspace.id, { command: 'materialize', nodeId: result.nodeId, revision: 1, sceneId: scene.id, kind: 'image' }, user) as CreativeStoryboard;
    expect((await workspaceRepository.getNode(image.document.scenes[0].imageWorkflowNodeId!))?.payload).toMatchObject({ targetWidth: 1080, targetHeight: 1920, outputPreset: 'custom', status: 'idle' });
    await f.execute({ command: 'remove', id: f.recipe.id });
    expect(await creativeStoryboardRepository.read(target.workspace.id, result.nodeId)).not.toBeNull();
  });
  it('rejects missing, unknown, stale and foreign references before creating any node', async () => {
    const f = await fixture(), other = await fixture();
    const count = (await workspaceRepository.listNodes(f.workspace.id)).length;
    for (const values of [[], [{ key: 'wrong', id: f.image.id }], [{ key: 'reference-1', id: other.image.id }]]) {
      await expect(f.execute({ command: 'instantiate', id: f.recipe.id, bindings: creativeRecipeBindingsSchema.parse({ script: 'Test', values }) })).rejects.toThrow();
    }
    await expect(f.execute({ command: 'instantiate', id: f.recipe.id, bindings: creativeRecipeBindingsSchema.parse({ values: [{ key: 'reference-1', id: f.image.id }] }) })).rejects.toThrow('creative_recipe_inputs_required');
    expect((await workspaceRepository.listNodes(f.workspace.id)).length).toBe(count);
    vi.spyOn(creativeStoryboardRepository, 'create').mockRejectedValueOnce(new Error('atomic failure'));
    await expect(f.execute({ command: 'instantiate', id: f.recipe.id, bindings: creativeRecipeBindingsSchema.parse({ script: 'Test', values: [{ key: 'reference-1', id: f.image.id }] }) })).rejects.toThrow('atomic failure');
    expect((await workspaceRepository.listNodes(f.workspace.id)).length).toBe(count);
  });
  it('accepts one storyboard inside an existing group, rejects ambiguous groups', async () => {
    const f = await fixture();
    const group = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'group', title: 'Flow', x: 0, y: 0, width: 900, height: 700, payload: { members: [f.board.nodeId, f.image.id] } });
    const capture = { sourceNodeId: group.id, revision: f.board.revision, name: 'Grouped flow', description: '' };
    expect(await f.execute({ command: 'capture', capture })).toMatchObject({ definition: f.recipe.definition });
    const extra = await creativeStoryboardService.execute(f.workspace.id, { command: 'create', title: 'Other' }, user) as CreativeStoryboard;
    await workspaceRepository.updateNode(group.id, { payload: { members: [f.board.nodeId, extra.nodeId] } });
    await expect(f.execute({ command: 'capture', capture })).rejects.toThrow('creative_recipe_board_required');
  });
  it('keeps owner-only library access and exact agent character identity through the same bridge', async () => {
    const f = await fixture(), agent = { type: 'agent' as const, nodeId: uuidv7(), taskId: uuidv7() };
    await expect(f.service.execute(f.workspace.id, { command: 'list' }, agent)).rejects.toThrow('creative_agent_task_required');
    const wav = Buffer.alloc(128); wav.write('RIFF'); wav.write('WAVE', 8); await writeFile(join(f.folder, 'voice.wav'), wav);
    async function character(name: string) {
      const definition = creativeCharacterDefinitionSchema.parse({ name, appearance: 'Approved red geometric mascot.', images: ['product.png'], voice: { kind: 'audio', path: 'voice.wav', language: 'en-US' } });
      const draft = await creativeCharacterService.execute(f.workspace.id, { command: 'create', definition }, user) as CreativeCharacter;
      return await creativeCharacterService.execute(f.workspace.id, { command: 'lock', id: draft.id, revision: 1 }, user) as CreativeCharacter;
    }
    const original = await character('Original'), replacement = await character('Other');
    const saved = await creativeStoryboardService.execute(f.workspace.id, { command: 'apply', nodeId: f.board.nodeId, revision: f.board.revision, operations: [{ type: 'update', id: f.board.document.scenes[0].id, patch: { characterIds: [original.id] } }] }, user) as CreativeStoryboard;
    const recipe = await f.execute({ command: 'capture', capture: { sourceNodeId: saved.nodeId, revision: saved.revision, name: 'Identity', description: '' } }) as CreativeRecipe;
    vi.spyOn(creativeWorkflowService, 'assertActor').mockResolvedValue(f.workspace);
    const bridge = await new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(f.workspace.id, agent, 'recipes', undefined, { command: 'read', id: recipe.id })); expect(bridge).toEqual(recipe);
    await expect(f.service.execute(f.workspace.id, { command: 'library' }, agent)).rejects.toThrow('creative_owner_required');
    const values = recipe.definition.inputs.map(slot => ({ key: slot.key, id: slot.kind === 'character' ? replacement.id : f.image.id }));
    await expect(f.service.execute(f.workspace.id, { command: 'instantiate', id: recipe.id, bindings: creativeRecipeBindingsSchema.parse({ script: 'Test', values }) }, agent)).rejects.toThrow('creative_character_owner_change_required');
    values.find(value => value.id === replacement.id)!.id = original.id;
    expect(await f.service.execute(f.workspace.id, { command: 'instantiate', id: recipe.id, bindings: creativeRecipeBindingsSchema.parse({ script: 'Test', values }) }, agent)).toHaveProperty('nodeId');
  });
  it('shows actual failed/uncertain queue state and never exposes a resubmit action', async () => {
    const f = await fixture();
    const image = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'imageWorkflow', title: 'Images', x: 0, y: 0, width: 200, height: 200, payload: { status: 'failed', lastError: 'image_gen_tool_failed' } });
    const video = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'videoWorkflow', title: 'Video', x: 0, y: 0, width: 200, height: 200, payload: {} });
    vi.spyOn(creativeMediaRepository, 'runs').mockResolvedValue([{ id: uuidv7(), status: 'submission_uncertain', reservedCents: 125, queuePosition: null, errorCode: 'creative_submission_uncertain' }] as never);
    const queue = await f.service.queue(f.workspace.id);
    expect(queue.find(item => item.nodeId === image.id)).toMatchObject({ status: 'failed', outputs: [] });
    expect(queue.find(item => item.nodeId === video.id)).toMatchObject({ status: 'submission_uncertain', reservedCents: 125, canCancel: false, canRetryDownload: false });
    await creativeMediaRepository.removeWorkspace(f.workspace.id);
    expect(await creativeRecipeRepository.list(f.workspace.id)).toEqual([]);
  });
  it('reconciles interrupted image runs before reporting a cancellable active job', async () => {
    const f = await fixture();
    const node = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'imageWorkflow', title: 'Interrupted', x: 0, y: 0, width: 200, height: 200, payload: { status: 'running' } });
    vi.spyOn(creativeWorkspaceGateway, 'reconcileImageWorkflow').mockResolvedValue({ ...node, payload: { status: 'failed', lastError: 'image_workflow_interrupted' } });
    expect((await f.service.queue(f.workspace.id)).find(item => item.nodeId === node.id)).toMatchObject({ status: 'failed', canCancel: false, errorCode: 'image_workflow_interrupted' });
  });
});
