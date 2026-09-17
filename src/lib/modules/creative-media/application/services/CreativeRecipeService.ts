import { uuidv7 } from '@beeblock/svelar/support';
import { Connection } from '@beeblock/svelar/database';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeRecipeRepository } from '../../infrastructure/repositories/CreativeRecipeRepository.js';
import { creativeStoryboardRepository } from '../../infrastructure/repositories/CreativeStoryboardRepository.js';
import { creativeCharacterRepository } from '../../infrastructure/repositories/CreativeCharacterRepository.js';
import { creativeMediaRepository } from '../../infrastructure/repositories/CreativeMediaRepository.js';
import { creativeRecipeCommandSchema, creativeRecipeSceneSchema, type CreativeRecipeCommand, type CreativeRecipeDefinition } from '../../contracts/schemas/creative-recipe.schema.js';
import { storyboardDocumentSchema } from '../../contracts/schemas/creative-storyboard.schema.js';
import { CreativeMediaError, type CreativeActor } from '../../domain/types.js';
import type { CreativeQueueItem } from '../../domain/creative-recipe.js';
import { creativeWorkflowService } from './CreativeWorkflowService.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';

export class CreativeRecipeService {
  async read(workspaceId: string, id: string) {
    const recipe = await creativeRecipeRepository.read(workspaceId, id);
    if (!recipe) throw new CreativeMediaError('creative_recipe_not_found', 404);
    return recipe;
  }
  async execute(workspaceId: string, raw: CreativeRecipeCommand, actor: CreativeActor) {
    const input = creativeRecipeCommandSchema.parse(raw);
    await creativeWorkflowService.assertActor(workspaceId, actor, !['list', 'library', 'read', 'queue'].includes(input.command));
    if (input.command === 'list') return creativeRecipeRepository.list(workspaceId);
    if (input.command === 'read') return this.read(workspaceId, input.id!);
    if (input.command === 'queue') return this.queue(workspaceId);
    if (input.command === 'library') {
      if (actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
      const items = [];
      for (const recipe of await creativeRecipeRepository.list()) {
        const workspace = await creativeWorkspaceGateway.workspace(recipe.workspaceId);
        if (workspace) items.push({ ...recipe, workspaceName: workspace.name });
      }
      return items;
    }
    return withCreativeProfileLock('recipe-library', async () => {
      const result = await Connection.transaction(async () => {
        if (input.command === 'capture') return this.capture(workspaceId, input);
        if (input.command === 'remove') {
          await this.read(workspaceId, input.id!);
          await creativeRecipeRepository.remove(workspaceId, input.id!);
          return { removed: true };
        }
        const sourceWorkspaceId = input.sourceWorkspaceId ?? workspaceId;
        if (sourceWorkspaceId !== workspaceId && actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
        const recipe = await this.read(sourceWorkspaceId, input.id!);
        const bindings = input.bindings!, nodes = await creativeWorkspaceGateway.nodes(workspaceId);
        if (!bindings.script && recipe.definition.scenes.some(scene => scene.direction.includes('{{script}}') || scene.dialogue.includes('{{script}}'))) throw new CreativeMediaError('creative_recipe_inputs_required');
        await creativeWorkspaceGateway.characterDestination(workspaceId, input.floorId ?? null);
        if (bindings.values.length !== recipe.definition.inputs.length || bindings.values.some(value => !recipe.definition.inputs.some(slot => slot.key === value.key))) throw new CreativeMediaError('creative_recipe_inputs_required');
        if (bindings.executorNodeId && !nodes.some(node => node.id === bindings.executorNodeId && node.type === 'terminal' && (node.payload as { provider?: string }).provider === 'codex')) throw new CreativeMediaError('creative_storyboard_executor_invalid');
        const selected = new Map(bindings.values.map(value => [value.key, value.id]));
        const files = new CreativeMediaFiles();
        for (const slot of recipe.definition.inputs) {
          const id = selected.get(slot.key)!;
          if (slot.kind === 'character') {
            const character = await creativeCharacterRepository.read(workspaceId, id);
            if (!character?.snapshot || character.state !== 'locked') throw new CreativeMediaError('creative_character_lock_required');
            if (actor.type === 'agent' && slot.identity && (slot.identity.familyId !== character.familyId || slot.identity.version !== character.version || slot.identity.digest !== character.snapshot.digest)) throw new CreativeMediaError('creative_character_owner_change_required', 403);
            for (const reference of [...character.snapshot.images, ...(character.snapshot.voice ? [character.snapshot.voice] : [])]) {
              if ((await files.media(workspaceId, { path: reference.path })).sha256 !== reference.sha256) throw new CreativeMediaError('creative_reference_changed');
            }
          } else {
            const node = nodes.find(node => node.id === id);
            if (node?.type !== slot.kind) throw new CreativeMediaError('creative_reference_unavailable');
            await files.media(workspaceId, { nodeId: id });
          }
        }
        const document = storyboardDocumentSchema.parse({ title: recipe.name, scenes: recipe.definition.scenes.map((scene, index) => ({
          ...scene, id: uuidv7(), aspectRatio: bindings.aspectRatio,
          direction: bindings.script ? (scene.direction.includes('{{script}}') ? scene.direction.replaceAll('{{script}}', () => bindings.script) : `${scene.direction}\n\nProduction brief:\n${bindings.script}`) : scene.direction,
          dialogue: scene.dialogue.replaceAll('{{script}}', () => bindings.script),
          characterIds: [...new Set(recipe.definition.inputs.filter(slot => slot.kind === 'character' && slot.scenes.includes(index)).map(slot => selected.get(slot.key)!))],
          referenceNodeIds: [...new Set(recipe.definition.inputs.filter(slot => slot.kind !== 'character' && slot.scenes.includes(index)).map(slot => selected.get(slot.key)!))],
          executorNodeId: bindings.executorNodeId,
        })) });
        const node = await creativeWorkspaceGateway.createStoryboardNode(workspaceId, recipe.name, input.floorId ?? null, input.position);
        const board = await creativeStoryboardRepository.create(workspaceId, node.id, document);
        await creativeWorkspaceGateway.updateNode(workspaceId, node.id, recipe.name, { schemaVersion: 1, revision: board.revision, recipeId: recipe.id, recipeVersion: recipe.version, recipeDigest: recipe.digest });
        for (const id of new Set(bindings.values.filter(value => recipe.definition.inputs.find(slot => slot.key === value.key)?.kind !== 'character').map(value => value.id))) await creativeWorkspaceGateway.connect(workspaceId, id, node.id);
        if (bindings.executorNodeId) await creativeWorkspaceGateway.connect(workspaceId, bindings.executorNodeId, node.id);
        return { storyboard: board, nodeId: node.id };
      });
      await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: `creative.recipe.${input.command}`, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input: { id: input.id, sourceNodeId: input.capture?.sourceNodeId } }, { saved: true });
      creativeWorkspaceGateway.broadcast(workspaceId);
      return result;
    });
  }
  private async capture(workspaceId: string, input: CreativeRecipeCommand) {
    const capture = input.capture!, nodes = await creativeWorkspaceGateway.nodes(workspaceId);
    const source = nodes.find(node => node.id === capture.sourceNodeId);
    const members = source?.type === 'group' ? (source.payload as { members?: string[] }).members ?? [] : [];
    const candidates = source?.type === 'storyboard' ? [source] : nodes.filter(node => node.type === 'storyboard' && members.includes(node.id));
    if (candidates.length !== 1) throw new CreativeMediaError('creative_recipe_board_required');
    const board = await creativeStoryboardRepository.read(workspaceId, candidates[0].id);
    if (!board || !board.document.scenes.length) throw new CreativeMediaError('creative_recipe_board_required');
    if (board.revision !== capture.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
    const definition: CreativeRecipeDefinition = { title: board.document.title, scenes: [], inputs: [] };
    const keys = new Map<string, CreativeRecipeDefinition['inputs'][number]>();
    for (const [index, scene] of board.document.scenes.entries()) {
      // Deliberate allowlist: no runs, paths, executors, provider profiles or grants.
      definition.scenes.push(creativeRecipeSceneSchema.parse({ title: scene.title, direction: scene.direction, dialogue: scene.dialogue, language: scene.language, duration: scene.duration, shot: scene.shot, aspectRatio: scene.aspectRatio }));
      for (const id of scene.characterIds) {
        let slot = keys.get(id);
        if (!slot) {
          const character = await creativeCharacterRepository.read(workspaceId, id);
          if (!character?.snapshot) throw new CreativeMediaError('creative_character_lock_required');
          slot = { key: `character-${keys.size + 1}`, kind: 'character', label: character.definition.name, scenes: [], identity: { familyId: character.familyId, version: character.version, digest: character.snapshot.digest } }; keys.set(id, slot); definition.inputs.push(slot);
        }
        slot.scenes.push(index);
      }
      for (const id of scene.referenceNodeIds) {
        let slot = keys.get(id);
        if (!slot) {
          const node = nodes.find(node => node.id === id);
          if (!node || !['image', 'video'].includes(node.type)) throw new CreativeMediaError('creative_reference_unavailable');
          slot = { key: `reference-${keys.size + 1}`, kind: node.type as 'image' | 'video', label: (node.title || node.type).slice(0, 120), scenes: [] }; keys.set(id, slot); definition.inputs.push(slot);
        }
        slot.scenes.push(index);
      }
    }
    const previous = capture.previousId ? await this.read(workspaceId, capture.previousId) : null;
    return creativeRecipeRepository.create(workspaceId, capture.name, capture.description, definition, previous?.familyId);
  }
  async queue(workspaceId: string): Promise<CreativeQueueItem[]> {
    const nodes = await creativeWorkspaceGateway.nodes(workspaceId), items: CreativeQueueItem[] = [];
    for (const node of nodes.filter(node => ['imageWorkflow', 'videoWorkflow'].includes(node.type))) {
      const outputs = nodes.filter(output => output.type === 'video' ? (output.payload as { workflowNodeId?: string }).workflowNodeId === node.id : output.type === 'image' && (output.payload as { generatedBy?: { workflowNodeId?: string } }).generatedBy?.workflowNodeId === node.id).map(output => ({ nodeId: output.id, title: output.title ?? '' }));
      if (node.type === 'imageWorkflow') {
        const current = (node.payload as { status?: string }).status === 'running' ? await creativeWorkspaceGateway.reconcileImageWorkflow(workspaceId, node.id) : node;
        if (!current) continue;
        const payload = current.payload as { status?: string; activeRun?: { id: string }; lastError?: string };
        items.push({ nodeId: node.id, title: node.title ?? '', kind: 'image', status: payload.status ?? 'idle', runId: payload.activeRun?.id ?? null, errorCode: payload.lastError ?? null, queuePosition: null, reservedCents: null, outputs, canCancel: payload.status === 'running', canRetryDownload: false });
      } else {
        const run = (await creativeMediaRepository.runs(workspaceId, node.id))[0];
        items.push({ nodeId: node.id, title: node.title ?? '', kind: 'video', status: run?.status ?? 'idle', runId: run?.id ?? null, errorCode: run?.errorCode ?? null, queuePosition: run?.queuePosition ?? null, reservedCents: run?.reservedCents ?? null, outputs, canCancel: !!run && ['queued', 'submitting', 'provider_running'].includes(run.status), canRetryDownload: run?.status === 'download_failed' });
      }
    }
    return items;
  }
}
export const creativeRecipeService = new CreativeRecipeService();
