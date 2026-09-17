import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import { CreativeProviderProfile } from '../../domain/models/CreativeProviderProfile.js';
import { CreativeWorkspacePolicy as PolicyModel } from '../../domain/models/CreativeWorkspacePolicy.js';
import { CreativeWorkflow as WorkflowModel } from '../../domain/models/CreativeWorkflow.js';
import { CreativeRun as RunModel } from '../../domain/models/CreativeRun.js';
import { creativeCharacterRepository } from './CreativeCharacterRepository.js';
import { creativeConfigSchema, creativePolicySchema } from '../../contracts/schemas/creative-media.schema.js';
import type { CreativePolicy, CreativeWorkflowSave } from '../../contracts/schemas/creative-media.schema.js';
import { ACTIVE_CREATIVE_STATUSES, type CreativeRunStatus } from '../../domain/catalog.js';
import { CreativeMediaError, type CreativeActor, type CreativePreview, type CreativeProfile, type CreativeRun, type CreativeWorkflow, type CreativeWorkspacePolicy } from '../../domain/types.js';
import type { CreativeRemoteHandle } from '../../application/ports/CreativeVideoProvider.js';

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
const now = () => new Date().toISOString();
function profile(row: CreativeProviderProfile): CreativeProfile {
  return { id: String(row.getAttribute('id')), provider: 'fal', name: String(row.getAttribute('name')), enabled: Boolean(row.getAttribute('enabled')), hasCredential: Boolean(row.getAttribute('has_credential')), revision: Number(row.getAttribute('revision')) };
}
function policy(row: PolicyModel): CreativeWorkspacePolicy {
  return { ...creativePolicySchema.parse(json(row.getAttribute('policy_json'))), id: String(row.getAttribute('id')), workspaceId: String(row.getAttribute('workspace_id')), profileId: String(row.getAttribute('profile_id')), revision: Number(row.getAttribute('revision')) };
}
function workflow(row: WorkflowModel): CreativeWorkflow {
  return { id: String(row.getAttribute('id')), nodeId: String(row.getAttribute('node_id')), workspaceId: String(row.getAttribute('workspace_id')), title: String(row.getAttribute('title')), config: creativeConfigSchema.parse(json(row.getAttribute('config_json'))), revision: Number(row.getAttribute('revision')) };
}
function run(row: RunModel): CreativeRun {
  return {
    id: String(row.getAttribute('id')), workspaceId: String(row.getAttribute('workspace_id')), workflowId: String(row.getAttribute('workflow_id')),
    nodeId: String(row.getAttribute('node_id')), profileId: String(row.getAttribute('profile_id')), status: String(row.getAttribute('status')) as CreativeRunStatus,
    snapshot: json(row.getAttribute('snapshot_json')), reservedCents: Number(row.getAttribute('reserved_cents')),
    queuePosition: row.getAttribute('queue_position') == null ? null : Number(row.getAttribute('queue_position')),
    errorCode: row.getAttribute('error_code') == null ? null : String(row.getAttribute('error_code')),
    output: row.getAttribute('output_json') ? json(row.getAttribute('output_json')) : null,
    actor: json(row.getAttribute('actor_json')), createdAt: iso(row.getAttribute('created_at')), updatedAt: iso(row.getAttribute('updated_at')),
  };
}

export class CreativeMediaRepository {
  async profiles(): Promise<CreativeProfile[]> { return (await CreativeProviderProfile.query().orderBy('name').get()).map(profile); }
  async profile(id: string): Promise<CreativeProfile | null> { const row = await CreativeProviderProfile.find(id); return row ? profile(row) : null; }
  async saveProfile(input: Omit<CreativeProfile, 'revision'>, revision?: number): Promise<CreativeProfile> {
    const stamp = now();
    const fields = { name: input.name, provider: input.provider, enabled: input.enabled, has_credential: input.hasCredential, updated_at: stamp };
    if (revision !== undefined) {
      const changed = await CreativeProviderProfile.query().where('id', input.id).where('revision', revision).update({ ...fields, revision: revision + 1 });
      if (!changed) throw new CreativeMediaError('creative_revision_conflict', 409);
    } else await CreativeProviderProfile.create({ ...fields, id: input.id, revision: 1, created_at: stamp });
    return (await this.profile(input.id))!;
  }
  async removeProfile(id: string) {
    await Connection.transaction(async () => {
      await PolicyModel.query().where('profile_id', id).delete();
      await CreativeProviderProfile.query().where('id', id).delete();
    });
  }
  async policy(workspaceId: string, profileId: string): Promise<CreativeWorkspacePolicy | null> {
    const row = await PolicyModel.query().where('workspace_id', workspaceId).where('profile_id', profileId).first();
    return row ? policy(row) : null;
  }
  async savePolicy(workspaceId: string, profileId: string, value: CreativePolicy, revision?: number): Promise<CreativeWorkspacePolicy> {
    const existing = await this.policy(workspaceId, profileId);
    const fields = { policy_json: JSON.stringify(creativePolicySchema.parse(value)), updated_at: now() };
    if (existing) {
      if (revision !== existing.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
      const changed = await PolicyModel.query().where('id', existing.id).where('revision', revision).update({ ...fields, revision: revision + 1 });
      if (!changed) throw new CreativeMediaError('creative_revision_conflict', 409);
    } else {
      if (revision !== undefined) throw new CreativeMediaError('creative_revision_conflict', 409);
      await PolicyModel.create({ ...fields, id: uuidv7(), workspace_id: workspaceId, profile_id: profileId, revision: 1, created_at: now() });
    }
    return (await this.policy(workspaceId, profileId))!;
  }
  async workflows(workspaceId: string): Promise<CreativeWorkflow[]> {
    return (await WorkflowModel.query().where('workspace_id', workspaceId).orderBy('created_at').get()).map(workflow);
  }
  async workflow(workspaceId: string, nodeId: string): Promise<CreativeWorkflow | null> {
    const row = await WorkflowModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).first();
    return row ? workflow(row) : null;
  }
  async saveWorkflow(workspaceId: string, nodeId: string, input: CreativeWorkflowSave): Promise<CreativeWorkflow> {
    const existing = await this.workflow(workspaceId, nodeId);
    const fields = { title: input.title, config_json: JSON.stringify(input.config), updated_at: now() };
    if (existing) {
      if (input.revision !== existing.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
      const changed = await WorkflowModel.query().where('id', existing.id).where('revision', input.revision).update({ ...fields, revision: input.revision + 1 });
      if (!changed) throw new CreativeMediaError('creative_revision_conflict', 409);
    } else {
      if (input.revision !== undefined) throw new CreativeMediaError('creative_revision_conflict', 409);
      await WorkflowModel.create({ ...fields, id: uuidv7(), workspace_id: workspaceId, node_id: nodeId, revision: 1, created_at: now() });
    }
    return (await this.workflow(workspaceId, nodeId))!;
  }
  async removeWorkflow(workspaceId: string, nodeId: string): Promise<void> {
    await WorkflowModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).delete();
  }
  async runs(workspaceId: string, nodeId?: string): Promise<CreativeRun[]> {
    const query = RunModel.query().where('workspace_id', workspaceId);
    if (nodeId) query.where('node_id', nodeId);
    return (await query.orderBy('created_at', 'desc').limit(100).get()).map(run);
  }
  async run(workspaceId: string, id: string): Promise<CreativeRun | null> {
    const row = await RunModel.query().where('workspace_id', workspaceId).where('id', id).first();
    return row ? run(row) : null;
  }
  async activeForProfile(profileId: string): Promise<boolean> {
    return Boolean(await RunModel.query().where('profile_id', profileId).whereIn('status', [...ACTIVE_CREATIVE_STATUSES, 'download_failed']).first());
  }
  async activeForNodes(workspaceId: string, nodeIds: string[]): Promise<boolean> {
    return Boolean(await RunModel.query().where('workspace_id', workspaceId).whereIn('node_id', nodeIds).whereIn('status', ACTIVE_CREATIVE_STATUSES).first());
  }
  async activeForWorkspace(workspaceId: string): Promise<boolean> {
    return Boolean(await RunModel.query().where('workspace_id', workspaceId).whereIn('status', ACTIVE_CREATIVE_STATUSES).first());
  }
  async removeWorkspace(workspaceId: string): Promise<void> {
    await Connection.transaction(async () => {
      const { creativeStoryboardRepository } = await import('./CreativeStoryboardRepository.js');
      await creativeStoryboardRepository.removeWorkspace(workspaceId);
      const { creativeAssetReviewRepository } = await import('./CreativeAssetReviewRepository.js');
      await creativeAssetReviewRepository.removeWorkspace(workspaceId);
      await creativeCharacterRepository.removeWorkspace(workspaceId);
      await RunModel.query().where('workspace_id', workspaceId).delete();
      await WorkflowModel.query().where('workspace_id', workspaceId).delete();
      await PolicyModel.query().where('workspace_id', workspaceId).delete();
    });
  }
  async byKey(workspaceId: string, key: string): Promise<CreativeRun | null> {
    const row = await RunModel.query().where('workspace_id', workspaceId).where('idempotency_key', key).first();
    return row ? run(row) : null;
  }
  async reserve(workspaceId: string, nodeId: string, preview: CreativePreview, actor: CreativeActor, idempotencyKey: string): Promise<CreativeRun> {
    return Connection.transaction(async () => {
      const existing = await this.byKey(workspaceId, idempotencyKey);
      if (existing) {
        if (existing.nodeId !== nodeId || JSON.stringify(existing.snapshot) !== JSON.stringify(preview.snapshot) || JSON.stringify(existing.actor) !== JSON.stringify(actor)) throw new CreativeMediaError('creative_idempotency_conflict', 409);
        return existing;
      }
      const account = await this.profile(preview.profileId);
      const grant = await this.policy(workspaceId, preview.profileId);
      const current = await this.workflow(workspaceId, nodeId);
      if (!account?.enabled || account.revision !== preview.profileRevision || !grant?.enabled || !grant.allowExternalMedia || grant.revision !== preview.policyRevision || current?.revision !== preview.revision) throw new CreativeMediaError('creative_preview_expired', 409);
      if (!grant.modelIds.includes(preview.snapshot.config.modelId) || (actor.type === 'agent' && !grant.allowAgents)) throw new CreativeMediaError('creative_workspace_disabled', 403);
      const today = now().slice(0, 10);
      const recent = await RunModel.query().where('workspace_id', workspaceId).where('profile_id', preview.profileId).where('created_at', '>=', `${today}T00:00:00.000Z`).get();
      const pending = await RunModel.query().where('workspace_id', workspaceId).where('profile_id', preview.profileId).where('created_at', '<', `${today}T00:00:00.000Z`).whereIn('status', ACTIVE_CREATIVE_STATUSES).get();
      const reservations = [...recent, ...pending];
      let reserved = 0;
      let active = 0;
      for (const row of reservations) {
        const item = run(row);
        const working = ACTIVE_CREATIVE_STATUSES.includes(item.status);
        if (working) active++;
        if (working || item.createdAt.slice(0, 10) === today) reserved += item.reservedCents;
        if (working && item.nodeId === nodeId) throw new CreativeMediaError('creative_workflow_busy', 409);
      }
      if (active >= grant.maxConcurrentRuns) throw new CreativeMediaError('creative_concurrency_limit', 409);
      if (preview.reservedCents > grant.maxRunCents || reserved + preview.reservedCents > grant.maxDayCents) throw new CreativeMediaError('creative_budget_exceeded', 403);
      const stamp = now();
      const created = await RunModel.create({ id: uuidv7(), workspace_id: workspaceId, workflow_id: preview.workflowId, node_id: nodeId,
        profile_id: preview.profileId, status: 'queued', snapshot_json: JSON.stringify(preview.snapshot), reserved_cents: preview.reservedCents,
        actor_json: JSON.stringify(actor), idempotency_key: idempotencyKey, remote_json: null, output_json: null, queue_position: null,
        error_code: null, lease_owner: null, lease_expires_at: null, next_poll_at: stamp, created_at: stamp, updated_at: stamp });
      return run(created);
    });
  }
  async candidates(): Promise<CreativeRun[]> {
    return (await RunModel.query().whereIn('status', ACTIVE_CREATIVE_STATUSES.filter(status => status !== 'submission_uncertain')).where('next_poll_at', '<=', now()).orderBy('next_poll_at').limit(100).get()).map(run);
  }
  async claim(workspaceId: string, id: string, owner: string): Promise<{ run: CreativeRun; remote: CreativeRemoteHandle | null } | null> {
    const row = await RunModel.query().where('workspace_id', workspaceId).where('id', id).first();
    if (!row || !ACTIVE_CREATIVE_STATUSES.includes(String(row.getAttribute('status')) as CreativeRunStatus)) return null;
    const expires = row.getAttribute('lease_expires_at');
    const poll = row.getAttribute('next_poll_at');
    if ((expires && new Date(String(expires)).getTime() > Date.now()) || (poll && new Date(String(poll)).getTime() > Date.now())) return null;
    const query = RunModel.query().where('id', id).where('status', String(row.getAttribute('status')));
    if (expires) query.where('lease_expires_at', expires); else query.whereNull('lease_expires_at');
    const claimed = await query.update({ lease_owner: owner, lease_expires_at: new Date(Date.now() + 300000).toISOString() });
    return claimed ? { run: run(row), remote: row.getAttribute('remote_json') ? json(row.getAttribute('remote_json')) : null } : null;
  }
  async transition(id: string, owner: string, from: CreativeRunStatus[], to: CreativeRunStatus, updates: { remote?: CreativeRemoteHandle; output?: CreativeRun['output']; errorCode?: string | null; queuePosition?: number | null; releaseReservation?: boolean } = {}): Promise<boolean> {
    const changed = await RunModel.query().where('id', id).where('lease_owner', owner).whereIn('status', from).update({
      status: to, updated_at: now(), next_poll_at: new Date(Date.now() + 5000).toISOString(),
      ...(updates.remote !== undefined ? { remote_json: JSON.stringify(updates.remote) } : {}),
      ...(updates.output !== undefined ? { output_json: JSON.stringify(updates.output) } : {}),
      ...(updates.errorCode !== undefined ? { error_code: updates.errorCode } : {}),
      ...(updates.queuePosition !== undefined ? { queue_position: updates.queuePosition } : {}),
      ...(updates.releaseReservation ? { reserved_cents: 0 } : {}),
    });
    return changed > 0;
  }
  async release(id: string, owner: string) {
    await RunModel.query().where('id', id).where('lease_owner', owner).update({ lease_owner: null, lease_expires_at: null });
  }
  async renewLease(id: string, owner: string) {
    return (await RunModel.query().where('id', id).where('lease_owner', owner).update({ lease_expires_at: new Date(Date.now() + 300000).toISOString() })) > 0;
  }
  async command(workspaceId: string, id: string, command: 'cancel' | 'retry_download' | 'close_unconfirmed'): Promise<CreativeRun> {
    const current = await this.run(workspaceId, id);
    if (!current) throw new CreativeMediaError('creative_run_not_found', 404);
    if (command === 'close_unconfirmed') {
      if (!['submission_uncertain', 'download_failed'].includes(current.status)) throw new CreativeMediaError('creative_invalid_state', 409);
      await RunModel.query().where('id', id).where('status', current.status).update({ status: 'closed_unconfirmed', updated_at: now() });
    } else if (command === 'retry_download') {
      if (current.status !== 'download_failed') throw new CreativeMediaError('creative_invalid_state', 409);
      await RunModel.query().where('id', id).where('status', 'download_failed').update({ status: 'downloading', error_code: null, next_poll_at: now(), updated_at: now() });
    } else if (current.status === 'queued') {
      await RunModel.query().where('id', id).where('status', 'queued').update({ status: 'cancelled', reserved_cents: 0, updated_at: now() });
      const latest = await this.run(workspaceId, id);
      if (latest?.status === 'submitting') await RunModel.query().where('id', id).where('status', 'submitting').update({ status: 'cancel_requested', updated_at: now() });
    } else if (ACTIVE_CREATIVE_STATUSES.includes(current.status) && current.status !== 'submission_uncertain') {
      await RunModel.query().where('id', id).whereIn('status', ['submitting', 'provider_running', 'downloading']).update({ status: 'cancel_requested', next_poll_at: now(), updated_at: now() });
    } else if (current.status === 'submission_uncertain') throw new CreativeMediaError('creative_submission_uncertain', 409);
    return (await this.run(workspaceId, id))!;
  }
}
export const creativeMediaRepository = new CreativeMediaRepository();
