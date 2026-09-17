import { createHash } from 'node:crypto';
import { Connection } from '@beeblock/svelar/database';
import { creativeWorkspaceGateway, type CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeStoryboardRepository, type CreativeStoryboardRepository } from '../../infrastructure/repositories/CreativeStoryboardRepository.js';
import { creativeMediaRepository } from '../../infrastructure/repositories/CreativeMediaRepository.js';
import { creativeCharacterRepository } from '../../infrastructure/repositories/CreativeCharacterRepository.js';
import { applyStoryboardOperations, sceneBrief, transferStoryboard, type CreativeStoryboard, type StoryboardRead } from '../../domain/storyboard.js';
import { creativeStoryboardCommandSchema, storyboardDocumentSchema, type CreativeStoryboardCommand, type StoryboardDocument, type StoryboardScene } from '../../contracts/schemas/creative-storyboard.schema.js';
import { creativeConfigSchema } from '../../contracts/schemas/creative-media.schema.js';
import { CreativeMediaError, type CreativeActor } from '../../domain/types.js';
import { creativeWorkflowService } from './CreativeWorkflowService.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';
import { shotDirectionPrompt, requestedDurationParameters } from '../../domain/shot-direction.js';
import { CREATIVE_MODELS } from '../../domain/catalog.js';
import { falModelCatalog } from './FalModelCatalogService.js';

const briefHash = (scene: StoryboardScene) => createHash('sha256').update(JSON.stringify(sceneBrief(scene))).digest('hex');
export class CreativeStoryboardService {
  constructor(readonly repository: CreativeStoryboardRepository = creativeStoryboardRepository, readonly workspace: CreativeWorkspaceGateway = creativeWorkspaceGateway) {}
  async read(workspaceId: string, nodeId: string): Promise<StoryboardRead> {
    const nodes = await this.workspace.nodes(workspaceId);
    if (nodes.find(node => node.id === nodeId)?.type !== 'storyboard') throw new CreativeMediaError('creative_storyboard_not_found', 404);
    const storyboard = await this.repository.read(workspaceId, nodeId);
    if (!storyboard) throw new CreativeMediaError('creative_storyboard_not_found', 404);
    const progress = [];
    for (const scene of storyboard.document.scenes) {
      const image = nodes.find(node => node.id === scene.imageWorkflowNodeId);
      const video = nodes.find(node => node.id === scene.videoWorkflowNodeId);
      const runs = video ? await creativeMediaRepository.runs(workspaceId, video.id) : [];
      const latest = runs[0];
      progress.push({ id: scene.id,
        image: image ? String((image.payload as Record<string, unknown>).status ?? 'idle') : scene.imageWorkflowNodeId ? 'missing' : 'unprepared',
        video: video ? latest?.status ?? 'idle' : scene.videoWorkflowNodeId ? 'missing' : 'unprepared',
        imageStale: !!scene.imageWorkflowNodeId && scene.imageBriefHash !== briefHash(scene),
        videoStale: !!scene.videoWorkflowNodeId && scene.videoBriefHash !== briefHash(scene),
        outputs: nodes.filter(node => {
          const payload = node.payload as { generatedBy?: { workflowNodeId?: string }; workflowNodeId?: string };
          return (node.type === 'image' && !!scene.imageWorkflowNodeId && payload.generatedBy?.workflowNodeId === scene.imageWorkflowNodeId) || (node.type === 'video' && !!scene.videoWorkflowNodeId && payload.workflowNodeId === scene.videoWorkflowNodeId);
        }).map(node => ({ id: node.id, type: node.type, title: node.title ?? '' })),
      });
    }
    return { storyboard, progress, inputs: nodes.filter(node => ['image', 'video', 'imageWorkflow', 'videoWorkflow'].includes(node.type)).map(node => ({ id: node.id, type: node.type, title: node.title ?? '', path: (node.payload as { path?: string }).path })), executors: nodes.filter(node => node.type === 'terminal' && (node.payload as { provider?: string }).provider === 'codex').map(node => ({ id: node.id, title: node.title ?? '' })) };
  }
  private async validate(workspaceId: string, document: StoryboardDocument, previous?: StoryboardDocument, strictSceneId?: string) {
    const nodes = new Map((await this.workspace.nodes(workspaceId)).map(node => [node.id, node]));
    for (const scene of document.scenes) {
      const before = strictSceneId === scene.id ? undefined : previous?.scenes.find(item => item.id === scene.id);
      // Preserve broken imported links for explicit repair, but never generate with them.
      if (scene.referenceNodeIds.some(id => !['image', 'video'].includes(nodes.get(id)?.type ?? '') && !before?.referenceNodeIds.includes(id))) throw new CreativeMediaError('creative_reference_unavailable');
      if (scene.executorNodeId && scene.executorNodeId !== before?.executorNodeId && (nodes.get(scene.executorNodeId)?.type !== 'terminal' || (nodes.get(scene.executorNodeId)?.payload as { provider?: string }).provider !== 'codex')) throw new CreativeMediaError('creative_storyboard_executor_invalid');
      for (const [id, type, prior] of [[scene.imageWorkflowNodeId, 'imageWorkflow', before?.imageWorkflowNodeId], [scene.videoWorkflowNodeId, 'videoWorkflow', before?.videoWorkflowNodeId]]) if (id && id !== prior && nodes.get(id)?.type !== type) throw new CreativeMediaError('creative_reference_unavailable');
      for (const id of scene.characterIds) if (!before?.characterIds.includes(id) && (await creativeCharacterRepository.read(workspaceId, id))?.state !== 'locked') throw new CreativeMediaError('creative_character_lock_required');
    }
  }
  async execute(workspaceId: string, raw: CreativeStoryboardCommand, actor: CreativeActor) {
    const input = creativeStoryboardCommandSchema.parse(raw);
    await creativeWorkflowService.assertActor(workspaceId, actor, !['list', 'read'].includes(input.command));
    if (input.command === 'list') {
      const ids = new Set((await this.workspace.nodes(workspaceId)).filter(node => node.type === 'storyboard').map(node => node.id));
      return (await this.repository.list(workspaceId)).filter(board => ids.has(board.nodeId));
    }
    if (input.command === 'read') return this.read(workspaceId, input.nodeId!);
    return withCreativeProfileLock(`storyboard:${workspaceId}`, async () => {
      const result = await Connection.transaction(async () => {
        if (input.command === 'create') {
          const nearId = input.nearNodeId ?? (actor.type === 'agent' ? actor.nodeId : undefined);
          const near = nearId ? await this.workspace.node(workspaceId, nearId) : null;
          if (nearId && !near) throw new CreativeMediaError('creative_reference_unavailable');
          const node = await this.workspace.createStoryboardNode(workspaceId, input.title!, input.floorId ?? near?.floorId ?? null, input.position, nearId);
          return this.repository.create(workspaceId, node.id, storyboardDocumentSchema.parse({ title: input.title }));
        }
        const current = (await this.read(workspaceId, input.nodeId!)).storyboard;
        if (current.revision !== input.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
        if (input.command === 'remove') {
          await this.repository.remove(workspaceId, current.nodeId);
          await this.workspace.deleteNode(workspaceId, current.nodeId);
          return { removed: true };
        }
        const document = input.command === 'apply' ? applyStoryboardOperations(current.document, input.operations!) : structuredClone(current.document);
        if (actor.type === 'agent') for (const scene of document.scenes) {
          const before = current.document.scenes.find(item => item.id === scene.id);
          if (before?.characterIds.length && JSON.stringify(before.characterIds) !== JSON.stringify(scene.characterIds)) throw new CreativeMediaError('creative_character_owner_change_required', 403);
        }
        await this.validate(workspaceId, document, current.document, input.command === 'materialize' ? input.sceneId : undefined);
        if (input.command === 'materialize') await this.materialize(current, document, input, actor);
        const saved = await this.repository.update(workspaceId, current.nodeId, current.revision, document);
        await this.workspace.updateNode(workspaceId, current.nodeId, document.title, { schemaVersion: 1, revision: saved.revision });
        return saved;
      });
      await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: `creative.storyboard.${input.command}`, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input: { nodeId: input.nodeId, revision: input.revision, sceneId: input.sceneId } }, { revision: 'revision' in result ? result.revision : null });
      this.workspace.broadcast(workspaceId);
      return result;
    });
  }
  private async materialize(board: CreativeStoryboard, document: StoryboardDocument, input: CreativeStoryboardCommand, actor: CreativeActor) {
    const scene = document.scenes.find(item => item.id === input.sceneId);
    if (!scene) throw new CreativeMediaError('creative_storyboard_scene_missing', 404);
    if (!scene.direction.trim()) throw new CreativeMediaError('creative_prompt_required');
    const hash = briefHash(scene);
    const linked = input.kind === 'image' ? scene.imageWorkflowNodeId : scene.videoWorkflowNodeId;
    if (linked && (input.kind === 'image' ? scene.imageBriefHash : scene.videoBriefHash) === hash) return;
    const prompt = [scene.direction, scene.dialogue ? `Dialogue (${scene.language}): ${scene.dialogue}` : '', `Requested duration: ${scene.duration} seconds.`].filter(Boolean).join('\n\n');
    if (input.kind === 'video') {
      const config = creativeConfigSchema.parse({ ...(input.config ?? {}), duration: scene.duration, shot: scene.shot, prompt, requiredCharacterIds: scene.characterIds, requiredReferenceNodeIds: scene.referenceNodeIds });
      if (!Object.hasOwn(CREATIVE_MODELS, config.modelId)) config.parameters = requestedDurationParameters(config.parameters, await falModelCatalog.contract(config.modelId), scene.duration);
      const workflow = await creativeWorkflowService.save(board.workspaceId, { title: scene.title, config }, actor, undefined, board.nodeId);
      scene.videoWorkflowNodeId = workflow.nodeId; scene.videoBriefHash = hash;
      await this.workspace.connect(board.workspaceId, board.nodeId, workflow.nodeId);
      for (const id of scene.referenceNodeIds) await this.workspace.connect(board.workspaceId, id, workflow.nodeId);
      return;
    }
    const nodes = await this.workspace.nodes(board.workspaceId);
    if (scene.referenceNodeIds.some(id => nodes.find(node => node.id === id)?.type !== 'image')) throw new CreativeMediaError('creative_reference_unavailable');
    const references = [...scene.referenceNodeIds];
    const characters = [];
    const files = new CreativeMediaFiles(this.workspace);
    for (const id of scene.characterIds) {
      const character = await creativeCharacterRepository.read(board.workspaceId, id);
      if (!character?.snapshot) throw new CreativeMediaError('creative_character_lock_required');
      characters.push(character);
      for (const reference of character.snapshot.images) if ((await files.media(board.workspaceId, { path: reference.path })).sha256 !== reference.sha256) throw new CreativeMediaError('creative_reference_changed');
    }
    const paths = new Set(characters.flatMap(character => character.definition.images));
    const existingPaths = new Set(references.map(id => (nodes.find(node => node.id === id)?.payload as { path?: string })?.path));
    if (references.length + [...paths].filter(path => !existingPaths.has(path)).length > 5) throw new CreativeMediaError('creative_storyboard_reference_limit');
    for (const character of characters) for (const path of character.definition.images) {
      if (existingPaths.has(path)) continue;
      const existing = nodes.find(node => node.type === 'image' && (node.payload as { path?: string }).path === path);
      const node = existing ?? await this.workspace.createNode(board.workspaceId, 'image', character.definition.name, { path, characterId: character.id, characterVersion: character.version, characterDigest: character.snapshot!.digest }, board.nodeId);
      references.push(node.id); existingPaths.add(path);
    }
    const draft = await this.workspace.createImageDraft(board.workspaceId, { title: scene.title, prompt: [scene.direction, shotDirectionPrompt(scene.shot, true), ...characters.map(character => `${character.definition.name}: ${character.definition.appearance}`)].filter(Boolean).join('\n\n'), from: 'storyboard', filePrefix: `scene-${scene.id.slice(0, 8)}` }, board.nodeId, scene.executorNodeId, references);
    scene.imageWorkflowNodeId = draft.id; scene.imageBriefHash = hash;
  }
  async clone(sourceWorkspaceId: string, nodeId: string, targetWorkspaceId: string, targetNodeId: string, ids: ReadonlyMap<string, string>) {
    const source = await this.repository.read(sourceWorkspaceId, nodeId);
    if (!source) throw new CreativeMediaError('creative_storyboard_not_found', 404);
    return this.repository.create(targetWorkspaceId, targetNodeId, transferStoryboard(source.document, ids));
  }
}
export const creativeStoryboardService = new CreativeStoryboardService();
