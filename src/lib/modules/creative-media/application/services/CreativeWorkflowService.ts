import { createHash } from 'node:crypto';
import { uuidv7 } from '@beeblock/svelar/support';
import { creativeWorkspaceGateway, type CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService, AutonomyGatePendingError } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeMediaRepository, type CreativeMediaRepository } from '../../infrastructure/repositories/CreativeMediaRepository.js';
import { FalVideoProvider } from '../../infrastructure/providers/FalVideoProvider.js';
import { creativeConfigSchema, creativeRunRequestSchema, creativeWorkflowSaveSchema, type CreativeRunRequest, type CreativeWorkflowSave } from '../../contracts/schemas/creative-media.schema.js';
import { ACTIVE_CREATIVE_STATUSES, CREATIVE_CATALOG_REVISION, CREATIVE_MODELS, MAX_CREATIVE_VIDEO_BYTES } from '../../domain/catalog.js';
import { CreativeMediaError, type CreativeActor, type CreativePreview, type CreativeRun, type CreativeSnapshot, type CreativeWorkflow } from '../../domain/types.js';
import type { CreativeVideoProvider, CreativeRemoteVideo } from '../ports/CreativeVideoProvider.js';
import { CreativeMediaFiles, creativeOutputPath } from './CreativeMediaFiles.js';
import { creativeProviderService, type CreativeProviderService } from './CreativeProviderService.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';
import { falModelCatalog, validateFalParameters } from './FalModelCatalogService.js';
import { genericFalInput } from '../../domain/model-input.js';
import { modelPromptField } from '../../domain/model-contract.js';
import { creativeCharacterService } from './CreativeCharacterService.js';
import { shotDirectionPrompt } from '../../domain/shot-direction.js';

const previewState = globalThis as typeof globalThis & { __orkestraiCreativePreviews?: Map<string, { workspaceId: string; actor: CreativeActor; preview: CreativePreview }> };
const previews = previewState.__orkestraiCreativePreviews ??= new Map();

export class CreativeWorkflowService {
  constructor(
    readonly repository: CreativeMediaRepository = creativeMediaRepository,
    readonly profiles: CreativeProviderService = creativeProviderService,
    readonly provider: CreativeVideoProvider = new FalVideoProvider(),
    readonly workspace: CreativeWorkspaceGateway = creativeWorkspaceGateway,
    readonly files: CreativeMediaFiles = new CreativeMediaFiles(workspace),
  ) {}

  async assertActor(workspaceId: string, actor: CreativeActor, requireActive = true) {
    const workspace = await this.workspace.workspace(workspaceId);
    if (!workspace) throw new CreativeMediaError('creative_workspace_not_found', 404);
    if (requireActive && workspace.suspendedAt) throw new CreativeMediaError('creative_workspace_suspended', 409);
    if (actor.type === 'agent' && !await this.workspace.actorCanWork(workspaceId, actor.nodeId, actor.taskId)) throw new CreativeMediaError('creative_agent_task_required', 403);
    return workspace;
  }

  async list(workspaceId: string) {
    const nodes = new Set((await this.workspace.nodes(workspaceId)).map(node => node.id));
    return (await this.repository.workflows(workspaceId)).filter(workflow => nodes.has(workflow.nodeId));
  }

  async capabilities(workspaceId: string, actor: CreativeActor) {
    await this.assertActor(workspaceId, actor, false);
    const profiles = [];
    for (const profile of await this.profiles.profiles()) {
      const policy = await this.repository.policy(workspaceId, profile.id);
      if (profile.enabled && policy?.enabled && policy.allowExternalMedia && (actor.type !== 'agent' || policy.allowAgents)) profiles.push({ id: profile.id, name: profile.name, modelIds: policy.modelIds, maxRunCents: policy.maxRunCents, maxDayCents: policy.maxDayCents, maxConcurrentRuns: policy.maxConcurrentRuns });
    }
    const nodes = await this.workspace.nodes(workspaceId);
    const inputs = nodes.filter(node => ['image', 'video', 'note'].includes(node.type)).map(node => ({ id: node.id, title: node.title, type: node.type }));
    const workflows = await this.list(workspaceId);
    const persisted = new Set(workflows.map(workflow => workflow.nodeId));
    const drafts = nodes.filter(node => node.type === 'videoWorkflow' && !persisted.has(node.id)).map(node => ({ nodeId: node.id, title: node.title, config: creativeConfigSchema.parse((node.payload as { draftConfig?: unknown }).draftConfig ?? {}) }));
    return { workflows, drafts, profiles, inputs, models: Object.values(CREATIVE_MODELS), modelDiscovery: { command: 'video_workflow_models', provider: 'fal', paginated: true } };
  }

  async read(workspaceId: string, nodeId: string) {
    const node = await this.workspace.node(workspaceId, nodeId);
    if (node?.type !== 'videoWorkflow') throw new CreativeMediaError('creative_workflow_not_found', 404);
    const workflow = await this.repository.workflow(workspaceId, nodeId);
    return { workflow, ...(!workflow ? { draftConfig: creativeConfigSchema.parse((node.payload as { draftConfig?: unknown }).draftConfig ?? {}) } : {}), runs: await this.repository.runs(workspaceId, nodeId), catalog: Object.values(CREATIVE_MODELS) };
  }

  async save(workspaceId: string, input: CreativeWorkflowSave, actor: CreativeActor, nodeId?: string, nearNodeId?: string) {
    await this.assertActor(workspaceId, actor);
    const value = creativeWorkflowSaveSchema.parse(input);
    await this.validateBindings(workspaceId, value.config);
    let created = false;
    if (nodeId) {
      if ((await this.workspace.node(workspaceId, nodeId))?.type !== 'videoWorkflow') throw new CreativeMediaError('creative_workflow_not_found', 404);
      if (await this.repository.activeForNodes(workspaceId, [nodeId])) throw new CreativeMediaError('creative_workflow_busy', 409);
      const current = await this.repository.workflow(workspaceId, nodeId);
      if (actor.type === 'agent' && current && (JSON.stringify(current.config.requiredCharacterIds) !== JSON.stringify(value.config.requiredCharacterIds) || JSON.stringify(current.config.requiredReferenceNodeIds) !== JSON.stringify(value.config.requiredReferenceNodeIds))) throw new CreativeMediaError('creative_character_owner_change_required', 403);
      const approved = current?.config.characterBindings ?? [];
      if (actor.type === 'agent' && approved.length && JSON.stringify(approved.map(binding => binding.id)) !== JSON.stringify(value.config.characterBindings.map(binding => binding.id))) throw new CreativeMediaError('creative_character_owner_change_required', 403);
      if (actor.type === 'agent' && approved.some(binding => binding.alias && value.config.characterBindings.some(next => next.alias === binding.alias && next.id !== binding.id))) throw new CreativeMediaError('creative_character_owner_change_required', 403);
    } else {
      if (value.revision !== undefined) throw new CreativeMediaError('creative_revision_conflict', 409);
      nodeId = (await this.workspace.createNode(workspaceId, 'videoWorkflow', value.title, { schemaVersion: 1 }, nearNodeId ?? (actor.type === 'agent' ? actor.nodeId : undefined))).id;
      created = true;
    }
    try {
      const result = await this.repository.saveWorkflow(workspaceId, nodeId, value);
      const origin = ((await this.workspace.node(workspaceId, nodeId))?.payload as { creativeOrigin?: unknown })?.creativeOrigin;
      await this.workspace.updateNode(workspaceId, nodeId, value.title, { schemaVersion: 1, workflowId: result.id, revision: result.revision, ...(origin ? { creativeOrigin: origin } : {}) });
      for (const inputId of [value.config.startImageNodeId, value.config.endImageNodeId, ...value.config.contextNodeIds, ...value.config.mediaBindings.map(binding => binding.nodeId)]) if (inputId) await this.workspace.connect(workspaceId, inputId, nodeId);
      this.workspace.broadcast(workspaceId);
      return result;
    } catch (error) {
      if (created) await this.workspace.deleteNode(workspaceId, nodeId);
      throw error;
    }
  }

  private async validateBindings(workspaceId: string, config: CreativeWorkflowSave['config']) {
    for (const binding of config.mediaBindings ?? []) {
      if (binding.nodeId && !['image', 'video'].includes((await this.workspace.node(workspaceId, binding.nodeId))?.type ?? '')) throw new CreativeMediaError('creative_reference_unavailable');
      if (binding.path) await this.workspace.existingPath(workspaceId, binding.path);
    }
    for (const id of [config.startImageNodeId, config.endImageNodeId]) {
      if (id && (await this.workspace.node(workspaceId, id))?.type !== 'image') throw new CreativeMediaError('creative_reference_unavailable');
    }
    for (const id of config.contextNodeIds) if ((await this.workspace.node(workspaceId, id))?.type !== 'note') throw new CreativeMediaError('creative_context_unavailable');
    await this.workspace.writablePath(workspaceId, config.outputDirectory);
  }

  async snapshot(workflow: CreativeWorkflow): Promise<CreativeSnapshot> {
    await this.validateBindings(workflow.workspaceId, workflow.config);
    const origin = ((await this.workspace.node(workflow.workspaceId, workflow.nodeId))?.payload as { creativeOrigin?: import('../../domain/asset-lineage.js').CreativeAssetLineage })?.creativeOrigin;
    if (origin?.frozenReference) {
      const current = await this.files.media(workflow.workspaceId, { path: origin.frozenReference.path });
      if (current.sha256 !== origin.frozenReference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
    }
    let config = creativeConfigSchema.parse(workflow.config);
    const legacyModel = CREATIVE_MODELS[config.modelId as keyof typeof CREATIVE_MODELS];
    if (!legacyModel && (config.startImageNodeId || config.endImageNodeId)) throw new CreativeMediaError('creative_unsupported_input');
    if (config.requiredCharacterIds.some(id => !config.characterBindings.some(binding => binding.id === id))) throw new CreativeMediaError('creative_character_binding_required');
    const references = new Set(legacyModel ? [config.startImageNodeId, config.endImageNodeId] : config.mediaBindings.map(binding => binding.nodeId));
    if (config.requiredReferenceNodeIds.some(id => !references.has(id))) throw new CreativeMediaError('creative_reference_required');
    const contexts: string[] = [];
    for (const id of config.contextNodeIds) {
      const node = await this.workspace.node(workflow.workspaceId, id);
      const text = (node?.payload as { content?: string } | undefined)?.content ?? '';
      if (typeof text !== 'string') throw new CreativeMediaError('creative_context_unavailable');
      contexts.push(text);
    }
    const modelContract = legacyModel ? undefined : await falModelCatalog.contract(config.modelId);
    const identities = await creativeCharacterService.resolve(workflow.workspaceId, config, modelContract);
    config = identities.config;
    const configuredPrompt = config.parameters[modelContract ? modelPromptField(modelContract.schema) ?? 'prompt' : 'prompt'];
    const prompt = [config.prompt || (typeof configuredPrompt === 'string' ? configuredPrompt : ''), shotDirectionPrompt(config.shot), ...contexts, ...identities.directions].filter(Boolean).join('\n\n').trim();
    if (/@\{[^}\n]+\}/.test(prompt)) throw new CreativeMediaError('creative_reference_alias_missing');
    if (modelContract) {
      const media = [];
      let size = 0;
      for (const binding of config.mediaBindings) {
        const reference = await this.files.media(workflow.workspaceId, binding);
        size += reference.size;
        if (size > 100 * 1024 * 1024) throw new CreativeMediaError('creative_reference_size');
        media.push({ pointer: binding.pointer, reference });
      }
      const input = genericFalInput(config, prompt, Object.fromEntries(media.map(item => [item.pointer, `https://media.invalid/${item.reference.sha256}`])), modelContract);
      validateFalParameters(modelContract, input);
      return { config, prompt, catalogRevision: CREATIVE_CATALOG_REVISION, revision: workflow.revision, startImage: null, endImage: null, modelContract, media, ...(identities.characters.length ? { characters: identities.characters } : {}) };
    }
    if (!prompt) throw new CreativeMediaError('creative_prompt_required');
    if (prompt.length > legacyModel.promptLimit) throw new CreativeMediaError('creative_prompt_too_long');
    const startImage = config.startImageNodeId ? await this.files.image(workflow.workspaceId, config.startImageNodeId) : null;
    const endImage = config.endImageNodeId ? await this.files.image(workflow.workspaceId, config.endImageNodeId) : null;
    if (legacyModel.startImage && !startImage) throw new CreativeMediaError('creative_reference_required');
    return { config, prompt, catalogRevision: CREATIVE_CATALOG_REVISION, revision: workflow.revision, startImage, endImage };
  }

  async authorize(workflow: CreativeWorkflow, actor: CreativeActor) {
    await this.assertActor(workflow.workspaceId, actor);
    const profileId = workflow.config.profileId;
    if (!profileId) throw new CreativeMediaError('creative_profile_required');
    const profile = await this.repository.profile(profileId);
    const policy = await this.repository.policy(workflow.workspaceId, profileId);
    if (!profile?.enabled) throw new CreativeMediaError('creative_profile_disabled', 403);
    if (!policy?.enabled || !policy.allowExternalMedia || !policy.modelIds.includes(workflow.config.modelId) || (actor.type === 'agent' && !policy.allowAgents)) throw new CreativeMediaError('creative_workspace_disabled', 403);
    const autonomy = await autonomyPolicyService.get(workflow.workspaceId);
    if (autonomy.policy.halted) throw new CreativeMediaError('creative_workspace_halted', 403);
    return { profile, policy };
  }

  async preview(workspaceId: string, nodeId: string, actor: CreativeActor): Promise<CreativePreview> {
    const workflow = (await this.read(workspaceId, nodeId)).workflow;
    if (!workflow) throw new CreativeMediaError('creative_workflow_not_found', 404);
    const { profile, policy } = await this.authorize(workflow, actor);
    const snapshot = await this.snapshot(workflow);
    const credential = await this.profiles.credential(profile.id);
    const estimate = await this.provider.estimate(credential.revealInsideTrustedExecutor(), snapshot.config, snapshot.modelContract);
    if (estimate.reservedCents > policy.maxRunCents || estimate.reservedCents > policy.maxDayCents) throw new CreativeMediaError('creative_budget_exceeded', 403);
    const preview: CreativePreview = { id: uuidv7(), workflowId: workflow.id, revision: workflow.revision, snapshot, profileId: profile.id, profileRevision: profile.revision, policyRevision: policy.revision, ...estimate, currency: 'USD', expiresAt: new Date(Date.now() + 300000).toISOString() };
    for (const [id, entry] of previews) if (new Date(entry.preview.expiresAt).getTime() <= Date.now()) previews.delete(id);
    if (previews.size >= 100) throw new CreativeMediaError('creative_preview_limit', 429);
    previews.set(preview.id, { workspaceId, actor, preview });
    return preview;
  }

  async run(workspaceId: string, nodeId: string, input: CreativeRunRequest, actor: CreativeActor): Promise<CreativeRun> {
    const value = creativeRunRequestSchema.parse(input);
    await this.assertActor(workspaceId, actor);
    const existing = await this.repository.byKey(workspaceId, value.idempotencyKey);
    if (existing) {
      if (existing.nodeId !== nodeId || existing.snapshot.revision !== value.revision || JSON.stringify(existing.actor) !== JSON.stringify(actor)) throw new CreativeMediaError('creative_idempotency_conflict', 409);
      return existing;
    }
    const entry = previews.get(value.previewId);
    if (!entry || entry.workspaceId !== workspaceId || JSON.stringify(entry.actor) !== JSON.stringify(actor) || Date.parse(entry.preview.expiresAt) <= Date.now() || entry.preview.revision !== value.revision) throw new CreativeMediaError('creative_preview_expired', 409);
    const workflow = (await this.read(workspaceId, nodeId)).workflow;
    if (!workflow || workflow.id !== entry.preview.workflowId) throw new CreativeMediaError('creative_preview_expired', 409);
    await this.authorize(workflow, actor);
    if (JSON.stringify(await this.snapshot(workflow)) !== JSON.stringify(entry.preview.snapshot)) throw new CreativeMediaError('creative_reference_changed', 409);
    const result = await withCreativeProfileLock(entry.preview.profileId, () => this.repository.reserve(workspaceId, nodeId, entry.preview, actor, value.idempotencyKey));
    previews.delete(value.previewId);
    await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'integration', operation: 'creative.run.queued', actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, runId: result.id, input: { nodeId, modelId: result.snapshot.config.modelId, reservedCents: result.reservedCents } }, { status: result.status });
    this.workspace.broadcast(workspaceId);
    return result;
  }

  async command(workspaceId: string, runId: string, command: 'cancel' | 'retry_download' | 'close_unconfirmed', actor: CreativeActor) {
    await this.assertActor(workspaceId, actor, false);
    if (command === 'close_unconfirmed' && actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
    const current = await this.repository.run(workspaceId, runId);
    if (!current || (actor.type === 'agent' && (current.actor.type !== 'agent' || current.actor.nodeId !== actor.nodeId))) throw new CreativeMediaError('creative_run_not_found', 404);
    const result = await this.repository.command(workspaceId, runId, command);
    await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'integration', operation: `creative.run.${command}`, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, runId, input: { command } }, { status: result.status });
    this.workspace.broadcast(workspaceId);
    return result;
  }

  async remove(workspaceId: string, nodeId: string, actor: CreativeActor) {
    await this.assertActor(workspaceId, actor, false);
    if (await this.repository.activeForNodes(workspaceId, [nodeId])) throw new CreativeMediaError('creative_workflow_busy', 409);
    await this.repository.removeWorkflow(workspaceId, nodeId);
    await this.workspace.deleteNode(workspaceId, nodeId);
  }

  async dispatch(run: CreativeRun, submit: () => Promise<unknown>) {
    const outputPath = await this.workspace.writablePath(run.workspaceId, `${run.snapshot.config.outputDirectory}/${run.snapshot.config.filePrefix}-${run.id}.mp4`);
    const operation = { workspaceId: run.workspaceId, capability: 'integration' as const, operation: 'creative.video.submit',
      actorType: run.actor.type, actorId: run.actor.type === 'agent' ? run.actor.nodeId : null, runId: run.id,
      mutation: true, risk: 'purchase' as const, certainty: 'semantic' as const,
      network: { url: `https://queue.fal.run/${run.snapshot.modelContract?.id ?? CREATIVE_MODELS[run.snapshot.config.modelId as keyof typeof CREATIVE_MODELS].endpoint}`, method: 'POST' },
      filesystem: { path: outputPath, permission: 'create' as const },
      input: { modelId: run.snapshot.config.modelId, promptDigest: createHash('sha256').update(run.snapshot.prompt).digest('hex'), reservedCents: run.reservedCents },
      auditOutput: () => ({ accepted: true }),
    };
    try { return await autonomyPolicyService.execute(operation, submit); }
    catch (error) {
      if (error instanceof AutonomyGatePendingError) throw new CreativeMediaError('creative_approval_required', 409);
      if (error instanceof CreativeMediaError) throw error;
      throw new CreativeMediaError('creative_policy_denied', 403);
    }
  }

  async download(run: CreativeRun, video: CreativeRemoteVideo, outputIndex: number, credential: string) {
    const path = creativeOutputPath(run, video, outputIndex);
    const destination = await this.workspace.writablePath(run.workspaceId, path);
    try {
      // Recheck the actual file, not the provisional MP4 name approved before
      // generation. Each variant respects current exclusions and size grants.
      return await autonomyPolicyService.execute({
        workspaceId: run.workspaceId, capability: 'filesystem', operation: 'creative.video.download',
        actorType: run.actor.type, actorId: run.actor.type === 'agent' ? run.actor.nodeId : null,
        runId: run.id, stepId: `output:${outputIndex}`, mutation: true, certainty: 'semantic',
        filesystem: { path: destination, permission: 'create', size: video.size ?? MAX_CREATIVE_VIDEO_BYTES },
        network: { url: new URL(video.url).origin, method: 'GET' },
        input: { path, outputIndex, mimeType: video.mimeType ?? 'video/mp4', size: video.size },
        auditOutput: result => { const asset = result as { path: string; sha256: string; size: number }; return { path: asset.path, sha256: asset.sha256, size: asset.size }; },
      }, async () => this.files.store(run, video, await this.provider.download(credential, video), outputIndex));
    } catch (error) {
      if (error instanceof AutonomyGatePendingError) throw new CreativeMediaError('creative_approval_required', 409);
      if (error instanceof CreativeMediaError) throw error;
      throw new CreativeMediaError('creative_policy_denied', 403);
    }
  }
}
export const creativeWorkflowService = new CreativeWorkflowService();
