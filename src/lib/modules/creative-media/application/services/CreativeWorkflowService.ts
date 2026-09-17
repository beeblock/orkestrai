import { createHash } from 'node:crypto';
import { uuidv7 } from '@beeblock/svelar/support';
import { creativeWorkspaceGateway, type CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService, AutonomyGatePendingError } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeMediaRepository, type CreativeMediaRepository } from '../../infrastructure/repositories/CreativeMediaRepository.js';
import { FalVideoProvider } from '../../infrastructure/providers/FalVideoProvider.js';
import { creativeConfigSchema, creativeRunRequestSchema, creativeWorkflowSaveSchema, type CreativeRunRequest, type CreativeWorkflowSave } from '../../contracts/schemas/creative-media.schema.js';
import { ACTIVE_CREATIVE_STATUSES, CREATIVE_CATALOG_REVISION, CREATIVE_MODELS } from '../../domain/catalog.js';
import { CreativeMediaError, type CreativeActor, type CreativePreview, type CreativeRun, type CreativeSnapshot, type CreativeWorkflow } from '../../domain/types.js';
import type { CreativeVideoProvider } from '../ports/CreativeVideoProvider.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { creativeProviderService, type CreativeProviderService } from './CreativeProviderService.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';

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
    const inputs = nodes.filter(node => node.type === 'image' || node.type === 'note').map(node => ({ id: node.id, title: node.title, type: node.type }));
    const workflows = await this.list(workspaceId);
    const persisted = new Set(workflows.map(workflow => workflow.nodeId));
    const drafts = nodes.filter(node => node.type === 'videoWorkflow' && !persisted.has(node.id)).map(node => ({ nodeId: node.id, title: node.title, config: creativeConfigSchema.parse((node.payload as { draftConfig?: unknown }).draftConfig ?? {}) }));
    return { workflows, drafts, profiles, inputs, models: Object.values(CREATIVE_MODELS) };
  }

  async read(workspaceId: string, nodeId: string) {
    const node = await this.workspace.node(workspaceId, nodeId);
    if (node?.type !== 'videoWorkflow') throw new CreativeMediaError('creative_workflow_not_found', 404);
    const workflow = await this.repository.workflow(workspaceId, nodeId);
    return { workflow, ...(!workflow ? { draftConfig: creativeConfigSchema.parse((node.payload as { draftConfig?: unknown }).draftConfig ?? {}) } : {}), runs: await this.repository.runs(workspaceId, nodeId), catalog: Object.values(CREATIVE_MODELS) };
  }

  async save(workspaceId: string, input: CreativeWorkflowSave, actor: CreativeActor, nodeId?: string) {
    await this.assertActor(workspaceId, actor);
    const value = creativeWorkflowSaveSchema.parse(input);
    await this.validateBindings(workspaceId, value.config);
    let created = false;
    if (nodeId) {
      if ((await this.workspace.node(workspaceId, nodeId))?.type !== 'videoWorkflow') throw new CreativeMediaError('creative_workflow_not_found', 404);
      if (await this.repository.activeForNodes(workspaceId, [nodeId])) throw new CreativeMediaError('creative_workflow_busy', 409);
    } else {
      if (value.revision !== undefined) throw new CreativeMediaError('creative_revision_conflict', 409);
      nodeId = (await this.workspace.createNode(workspaceId, 'videoWorkflow', value.title, { schemaVersion: 1 }, actor.type === 'agent' ? actor.nodeId : undefined)).id;
      created = true;
    }
    try {
      const result = await this.repository.saveWorkflow(workspaceId, nodeId, value);
      await this.workspace.updateNode(workspaceId, nodeId, value.title, { schemaVersion: 1, workflowId: result.id, revision: result.revision });
      for (const inputId of [value.config.startImageNodeId, value.config.endImageNodeId, ...value.config.contextNodeIds]) if (inputId) await this.workspace.connect(workspaceId, inputId, nodeId);
      this.workspace.broadcast(workspaceId);
      return result;
    } catch (error) {
      if (created) await this.workspace.deleteNode(workspaceId, nodeId);
      throw error;
    }
  }

  private async validateBindings(workspaceId: string, config: CreativeWorkflowSave['config']) {
    for (const id of [config.startImageNodeId, config.endImageNodeId]) {
      if (id && (await this.workspace.node(workspaceId, id))?.type !== 'image') throw new CreativeMediaError('creative_reference_unavailable');
    }
    for (const id of config.contextNodeIds) if ((await this.workspace.node(workspaceId, id))?.type !== 'note') throw new CreativeMediaError('creative_context_unavailable');
    await this.workspace.writablePath(workspaceId, config.outputDirectory);
  }

  async snapshot(workflow: CreativeWorkflow): Promise<CreativeSnapshot> {
    await this.validateBindings(workflow.workspaceId, workflow.config);
    const config = creativeConfigSchema.parse(workflow.config);
    const contexts: string[] = [];
    for (const id of config.contextNodeIds) {
      const node = await this.workspace.node(workflow.workspaceId, id);
      const text = (node?.payload as { content?: string } | undefined)?.content ?? '';
      if (typeof text !== 'string') throw new CreativeMediaError('creative_context_unavailable');
      contexts.push(text);
    }
    const prompt = [config.prompt, ...contexts].filter(Boolean).join('\n\n').trim();
    if (!prompt) throw new CreativeMediaError('creative_prompt_required');
    if (prompt.length > CREATIVE_MODELS[config.modelId].promptLimit) throw new CreativeMediaError('creative_prompt_too_long');
    const startImage = config.startImageNodeId ? await this.files.image(workflow.workspaceId, config.startImageNodeId) : null;
    const endImage = config.endImageNodeId ? await this.files.image(workflow.workspaceId, config.endImageNodeId) : null;
    if (CREATIVE_MODELS[config.modelId].startImage && !startImage) throw new CreativeMediaError('creative_reference_required');
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
    const estimate = await this.provider.estimate(credential.revealInsideTrustedExecutor(), snapshot.config);
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
      network: { url: `https://queue.fal.run/${CREATIVE_MODELS[run.snapshot.config.modelId].endpoint}`, method: 'POST' },
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
}
export const creativeWorkflowService = new CreativeWorkflowService();
