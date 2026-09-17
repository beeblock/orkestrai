import { uuidv7 } from '@beeblock/svelar/support';
import { Connection } from '@beeblock/svelar/database';
import { extname, join } from 'node:path';
import { rm, readdir } from 'node:fs/promises';
import { creativeWorkspaceGateway, type CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService, AutonomyGatePendingError } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeSequenceRepository, type CreativeSequenceRepository } from '../../infrastructure/repositories/CreativeSequenceRepository.js';
import { sequenceEncoderRuntime, encoderRoot } from '../../infrastructure/SequenceEncoderRuntime.js';
import { SequenceEncoder } from '../../infrastructure/SequenceEncoder.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { CreativeMediaError, type CreativeActor } from '../../domain/types.js';
import type { CreativeSequence, SequenceExport } from '../../domain/sequence.js';
import { creativeSequenceCommandSchema, sequenceDocumentSchema, sequenceClipSchema, type CreativeSequenceCommand, type SequenceDocument } from '../../contracts/schemas/creative-sequence.schema.js';
import { creativeWorkflowService } from './CreativeWorkflowService.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';

const global = globalThis as typeof globalThis & { __orkestraiSequenceJobs?: Map<string, AbortController> };
const jobs = global.__orkestraiSequenceJobs ??= new Map();
export class CreativeSequenceService {
  readonly encoder: SequenceEncoder;
  constructor(readonly repository: CreativeSequenceRepository = creativeSequenceRepository, readonly workspace: CreativeWorkspaceGateway = creativeWorkspaceGateway, encoder?: SequenceEncoder) { this.encoder = encoder ?? new SequenceEncoder(workspace); }
  async read(workspaceId: string, nodeId: string) {
    const node = await this.workspace.node(workspaceId, nodeId), current = await this.repository.read(workspaceId, nodeId);
    if (node?.type !== 'sequence' || !current) throw new CreativeMediaError('creative_sequence_not_found', 404);
    if (current.export?.state === 'running' && !jobs.has(current.export.id)) {
      current.export = { ...current.export, state: 'failed', error: 'creative_sequence_interrupted' };
      await this.repository.setExport(workspaceId, nodeId, current.export);
      await rm(join(encoderRoot(), '..', 'jobs', current.export.id), { recursive: true, force: true });
    }
    return current;
  }
  async execute(workspaceId: string, raw: CreativeSequenceCommand, actor: CreativeActor): Promise<unknown> {
    const input = creativeSequenceCommandSchema.parse(raw);
    await creativeWorkflowService.assertActor(workspaceId, actor, !['list', 'read', 'runtime'].includes(input.command));
    if (input.command === 'runtime') return this.encoder.runtime.status();
    if (input.command === 'install_runtime') {
      if (actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
      return this.encoder.runtime.startInstall();
    }
    if (input.command === 'list') {
      const nodes = await this.workspace.nodes(workspaceId), ids = new Set(nodes.filter(node => node.type === 'sequence').map(node => node.id));
      return (await this.repository.list(workspaceId)).filter(row => ids.has(row.nodeId));
    }
    if (input.command === 'read') return { sequence: await this.read(workspaceId, input.nodeId!), runtime: await this.encoder.runtime.status(), inputs: (await this.workspace.nodes(workspaceId)).filter(node => node.type === 'video').map(node => ({ id: node.id, title: node.title, path: (node.payload as { path?: string }).path })) };
    return withCreativeProfileLock('creative-sequence-mutation', async () => {
      let result: unknown;
      if (input.command === 'create') {
        await this.workspace.characterDestination(workspaceId, input.floorId ?? null);
        if (input.nearNodeId && !await this.workspace.node(workspaceId, input.nearNodeId)) throw new CreativeMediaError('creative_reference_unavailable');
        result = await Connection.transaction(async () => {
          const node = await this.workspace.createNode(workspaceId, 'sequence', input.title!, { schemaVersion: 1, revision: 1 }, input.nearNodeId, input.floorId);
          return this.repository.create(workspaceId, node.id, sequenceDocumentSchema.parse({ title: input.title }));
        });
      } else {
        const current = await this.read(workspaceId, input.nodeId!);
        if (input.command === 'cancel') { jobs.get(current.export?.id ?? '')?.abort(); return current; }
        if (input.command === 'export' && current.export && current.export.id === input.idempotencyKey) {
          if (current.export.revision !== input.revision || current.revision !== input.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
          return current;
        }
        if (current.revision !== input.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
        if (current.export?.state === 'running') throw new CreativeMediaError('creative_sequence_busy', 409);
        if (input.command === 'remove') {
          await this.repository.remove(workspaceId, current.nodeId); await this.workspace.deleteNode(workspaceId, current.nodeId); result = { removed: true };
        } else if (input.command === 'export') {
          if (!current.document.clips.length) throw new CreativeMediaError('creative_sequence_empty');
          if (jobs.size) throw new CreativeMediaError('creative_sequence_busy', 409);
          await this.encoder.runtime.require();
          for (const clip of current.document.clips) await this.authorizeFile(workspaceId, actor, clip.path, 'read', input.idempotencyKey!);
          await this.authorizeFile(workspaceId, actor, `generated/videos/sequences/${input.idempotencyKey}.mp4`, 'create', input.idempotencyKey!);
          const directory = join(encoderRoot(), '..', 'jobs');
          for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
            if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) await rm(join(directory, entry.name), { recursive: true, force: true });
          }
          const job: SequenceExport = { id: input.idempotencyKey!, revision: current.revision, state: 'running', progress: 0, error: null, outputNodeId: null, path: null, sha256: null, startedAt: new Date().toISOString() };
          const controller = new AbortController(); jobs.set(job.id, controller);
          try { await this.repository.setExport(workspaceId, current.nodeId, job); } catch (error) { jobs.delete(job.id); throw error; }
          void this.run(current, job, controller, actor);
          result = { ...current, export: job };
        } else {
          const document = structuredClone(current.document);
          for (const operation of input.operations!) {
            if (operation.type === 'settings') { const { type: _, ...settings } = operation; Object.assign(document, settings); continue; }
            if (operation.type === 'add') {
              if (document.clips.length >= 30) throw new CreativeMediaError('creative_sequence_limit');
              const node = await this.workspace.node(workspaceId, operation.nodeId);
              if (node?.type !== 'video') throw new CreativeMediaError('creative_reference_unavailable');
              await this.authorizeFile(workspaceId, actor, String((node.payload as { path?: string }).path ?? ''), 'read', node.id);
              const reference = await new CreativeMediaFiles(this.workspace).asset(workspaceId, node.id);
              if (!['.mp4', '.webm', '.mkv'].includes(extname(reference.path).toLowerCase())) throw new CreativeMediaError('creative_sequence_source_invalid');
              const { duration, ...metadata } = await this.encoder.probe(await this.workspace.existingPath(workspaceId, reference.path));
              document.clips.push(sequenceClipSchema.parse({ id: uuidv7(), nodeId: node.id, title: node.title ?? '', path: reference.path, sha256: reference.sha256, sourceDuration: duration, out: duration, ...metadata }));
              continue;
            }
            const index = document.clips.findIndex(clip => clip.id === operation.clipId);
            if (index < 0) throw new CreativeMediaError('creative_sequence_clip_missing');
            if (operation.type === 'remove') document.clips.splice(index, 1);
            else if (operation.type === 'move') document.clips.splice(Math.min(operation.index, document.clips.length - 1), 0, document.clips.splice(index, 1)[0]);
            else document.clips[index] = sequenceClipSchema.parse({ ...document.clips[index], ...operation.patch });
          }
          const validated = sequenceDocumentSchema.parse(document);
          result = await Connection.transaction(async () => {
            const saved = await this.repository.update(workspaceId, current.nodeId, current.revision, validated);
            await this.workspace.updateNode(workspaceId, current.nodeId, saved.document.title, { schemaVersion: 1, revision: saved.revision });
            for (const clip of validated.clips) await this.workspace.connect(workspaceId, clip.nodeId, current.nodeId);
            return saved;
          });
        }
      }
      await this.audit(workspaceId, actor, input.command, { nodeId: input.nodeId, revision: input.revision });
      this.workspace.broadcast(workspaceId); return result;
    });
  }
  private async audit(workspaceId: string, actor: CreativeActor, operation: string, input: Record<string, unknown>) { await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: `creative.sequence.${operation}`, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input }, {}); }
  private async authorizeFile(workspaceId: string, actor: CreativeActor, path: string, permission: 'read' | 'create', runId: string) {
    await creativeWorkflowService.assertActor(workspaceId, actor);
    const absolute = permission === 'read' ? await this.workspace.existingPath(workspaceId, path) : await this.workspace.writablePath(workspaceId, path);
    try { await autonomyPolicyService.execute({ workspaceId, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, capability: 'filesystem', operation: 'creative.sequence.file', runId, stepId: `${permission}:${path}`, mutation: permission !== 'read', certainty: 'semantic', filesystem: { path: absolute, permission, size: permission === 'create' ? 1024 ** 3 : 512 * 1024 ** 2 }, input: { path, permission } }, async () => ({ authorized: true })); }
    catch (error) { throw new CreativeMediaError(error instanceof AutonomyGatePendingError ? 'creative_approval_required' : 'creative_policy_denied', 403); }
  }
  private async run(sequence: CreativeSequence, job: SequenceExport, controller: AbortController, actor: CreativeActor) {
    const { workspaceId, nodeId } = sequence;
    const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    try {
      const output = await this.encoder.render(workspaceId, sequence.document, job.id, controller.signal, async progress => { job.progress = progress; await this.repository.setExport(workspaceId, nodeId, job); this.workspace.broadcast(workspaceId); }, (path, permission) => this.authorizeFile(workspaceId, actor, path, permission, job.id));
      // A workspace removed during encoding must not be recreated by a late result.
      if (!await this.repository.read(workspaceId, nodeId) || !await this.workspace.node(workspaceId, nodeId)) throw new CreativeMediaError('creative_sequence_not_found');
      const node = await this.workspace.createNode(workspaceId, 'video', sequence.document.title, { ...output, sequenceNodeId: nodeId, sequenceRevision: sequence.revision, sequenceExportId: job.id }, nodeId);
      Object.assign(job, { state: 'completed', progress: 100, outputNodeId: node.id, path: output.path, sha256: output.sha256 });
      await this.audit(workspaceId, actor, 'export.completed', { nodeId, revision: sequence.revision, outputNodeId: node.id, sha256: output.sha256 });
    } catch (error) { job.state = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error instanceof CreativeMediaError ? error.code : 'creative_sequence_encoder_failed'; }
    finally { clearTimeout(timeout); await this.repository.setExport(workspaceId, nodeId, job).catch(() => undefined); jobs.delete(job.id); this.workspace.broadcast(workspaceId); }
  }
  async clone(sourceWorkspaceId: string, sourceNodeId: string, targetWorkspaceId: string, targetNodeId: string, ids: ReadonlyMap<string, string>) {
    const source = await this.repository.read(sourceWorkspaceId, sourceNodeId);
    if (!source) throw new CreativeMediaError('creative_sequence_not_found');
    if (source.export?.state === 'running') throw new CreativeMediaError('creative_sequence_busy');
    const document: SequenceDocument = structuredClone(source.document);
    for (const clip of document.clips) {
      const targetId = ids.get(clip.nodeId), target = targetId ? await this.workspace.node(targetWorkspaceId, targetId) : null;
      if (target?.type !== 'video') throw new CreativeMediaError('creative_sequence_transfer_sources');
      const asset = await new CreativeMediaFiles(this.workspace).asset(targetWorkspaceId, target.id);
      if (asset.sha256 !== clip.sha256) throw new CreativeMediaError('creative_reference_changed');
      clip.nodeId = target.id; clip.path = asset.path;
    }
    return this.repository.create(targetWorkspaceId, targetNodeId, document);
  }
}
export const creativeSequenceService = new CreativeSequenceService();
