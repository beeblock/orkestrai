import { uuidv7 } from '@beeblock/svelar/support';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { CreativeMediaError, type CreativeRun } from '../../domain/types.js';
import { creativeWorkflowService, type CreativeWorkflowService } from './CreativeWorkflowService.js';

/** Desktop-local durable queue. A lease survives renderer reloads; an uncertain
 * paid submission is never automatically submitted for a second time. */
export class CreativeQueueService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastTickErrorAt = 0;
  constructor(readonly workflows: CreativeWorkflowService = creativeWorkflowService) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {
      if (Date.now() - this.lastTickErrorAt > 60000) {
        this.lastTickErrorAt = Date.now();
        console.warn('[creative-media] Queue checkpoint unavailable; pending runs will be retried.');
      }
    }); }, 5000);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Bound simultaneous downloads and provider polls, independent of how
      // many workspaces happen to be open in the renderer.
      const candidates = (await this.workflows.repository.candidates()).slice(0, 12);
      let next = 0;
      await Promise.all([0, 1].map(async () => {
        while (next < candidates.length) await this.process(candidates[next++]);
      }));
    } finally { this.busy = false; }
  }

  async process(candidate: CreativeRun) {
    const { repository, provider, profiles, workspace, files } = this.workflows;
    const owner = uuidv7();
    const claimed = await repository.claim(candidate.workspaceId, candidate.id, owner);
    if (!claimed) return;
    // Large reference uploads and multi-output downloads may exceed one lease.
    const heartbeat = setInterval(() => { void repository.renewLease(candidate.id, owner).catch(() => undefined); }, 60000);
    heartbeat.unref?.();
    let { run, remote } = claimed;
    let submitted = false;
    try {
      if (run.status === 'submitting' || (run.status === 'cancel_requested' && !remote)) {
        await repository.transition(run.id, owner, [run.status], 'submission_uncertain', { errorCode: 'creative_submission_uncertain' });
        return;
      }
      if (run.status === 'queued') {
        const active = await workspace.workspace(run.workspaceId);
        if (active?.suspendedAt) { await repository.transition(run.id, owner, ['queued'], 'queued', { errorCode: 'creative_workspace_suspended' }); return; }
        const workflow = await repository.workflow(run.workspaceId, run.nodeId);
        if (!workflow) throw new CreativeMediaError('creative_workflow_not_found');
        if (workflow.revision !== run.snapshot.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
        await this.workflows.authorize(workflow, run.actor);
        const credential = await profiles.credential(run.profileId);
        const references = {
          start: run.snapshot.startImage ? await files.referenceData(run.workspaceId, run.snapshot.startImage) : undefined,
          end: run.snapshot.endImage ? await files.referenceData(run.workspaceId, run.snapshot.endImage) : undefined,
          media: {} as Record<string, string>,
        };
        for (const item of run.snapshot.media ?? []) references.media[item.pointer] = await files.mediaData(run.workspaceId, item.reference);
        await this.workflows.dispatch(run, async () => {
          await this.workflows.authorize({ ...workflow, config: run.snapshot.config }, run.actor);
          if (run.snapshot.modelContract && provider.prepareMedia) references.media = await provider.prepareMedia(credential.revealInsideTrustedExecutor(), references.media);
          await this.workflows.authorize({ ...workflow, config: run.snapshot.config }, run.actor);
          if (!await repository.transition(run.id, owner, ['queued'], 'submitting', { errorCode: null })) return;
          submitted = true;
          const handle = await provider.submit(credential.revealInsideTrustedExecutor(), run.snapshot.config, run.snapshot.prompt, references, run.snapshot.modelContract);
          // Cancellation may race with the HTTP response: always retain the
          // provider handle so the following tick can cancel the actual job.
          const saved = await repository.transition(run.id, owner, ['submitting'], 'provider_running', { remote: handle });
          if (!saved) await repository.transition(run.id, owner, ['cancel_requested'], 'cancel_requested', { remote: handle });
        });
        return;
      }
      if (!remote) throw new CreativeMediaError('creative_remote_missing');
      if (['provider_running', 'cancel_requested'].includes(run.status) && Date.now() - Date.parse(run.createdAt) > 24 * 60 * 60 * 1000) {
        await repository.transition(run.id, owner, [run.status], 'download_failed', { errorCode: 'creative_provider_timeout' });
        return;
      }
      const credential = (await profiles.credential(run.profileId)).revealInsideTrustedExecutor();
      if (run.status === 'cancel_requested') {
        await provider.cancel(credential, remote);
        const status = await provider.status(credential, remote);
        if (status.status === 'cancelled') {
          await repository.transition(run.id, owner, ['cancel_requested'], 'cancelled', { errorCode: null });
          return;
        }
        if (status.status === 'completed') {
          await repository.transition(run.id, owner, ['cancel_requested'], 'downloading', { errorCode: 'creative_cancel_too_late' });
        } else if (status.status === 'failed') {
          await repository.transition(run.id, owner, ['cancel_requested'], 'failed', { errorCode: 'creative_provider_failed' });
        } else await repository.transition(run.id, owner, ['cancel_requested'], 'cancel_requested', { queuePosition: status.queuePosition });
        return;
      }
      if (run.status === 'provider_running') {
        const status = await provider.status(credential, remote);
        if (status.status === 'failed' || status.status === 'cancelled') {
          await repository.transition(run.id, owner, ['provider_running'], status.status, { errorCode: status.status === 'failed' ? 'creative_provider_failed' : null });
          return;
        }
        if (status.status !== 'completed') {
          await repository.transition(run.id, owner, ['provider_running'], 'provider_running', { queuePosition: status.queuePosition, errorCode: null });
          return;
        }
        if (!await repository.transition(run.id, owner, ['provider_running'], 'downloading', { queuePosition: null, errorCode: null })) return;
        run = { ...run, status: 'downloading' };
      }
      if (run.status === 'downloading') {
        const video = await provider.result(credential, remote, run.snapshot.modelContract);
        const outputs = [];
        const videos = [video, ...(video.variants ?? [])];
        if (videos.length > 10) throw new CreativeMediaError('creative_invalid_provider_response');
        for (const [index, result] of videos.entries()) {
          const asset = await this.workflows.download(run, result, index, credential);
          outputs.push(asset);
          const existing = (await workspace.nodes(run.workspaceId)).find(node => node.type === 'video' && (node.payload as { runId?: string }).runId === run.id && ((node.payload as { outputIndex?: number }).outputIndex ?? 0) === index);
          if (!existing) await workspace.createNode(run.workspaceId, 'video', `${run.snapshot.config.filePrefix}${index ? ` ${index + 1}` : ''}`, asset, run.nodeId);
        }
        const output = { ...outputs[0], ...(outputs.length > 1 ? { additionalOutputs: outputs.slice(1) } : {}) };
        await repository.transition(run.id, owner, ['downloading', 'cancel_requested'], 'completed', { output, errorCode: null });
        await autonomyPolicyService.recordSemanticEffect({ workspaceId: run.workspaceId, capability: 'integration', operation: 'creative.video.completed', actorType: run.actor.type, actorId: run.actor.type === 'agent' ? run.actor.nodeId : null, runId: run.id, input: { nodeId: run.nodeId } }, { path: output.path, sha256: output.sha256, size: output.size });
      }
    } catch (error) {
      const code = error instanceof CreativeMediaError ? error.code : 'creative_provider_unavailable';
      const latest = await repository.run(run.workspaceId, run.id);
      if (!latest) return;
      if (submitted) {
        const rejected = ['creative_credential_rejected', 'creative_provider_rejected', 'creative_rate_limited'].includes(code);
        await repository.transition(run.id, owner, ['submitting', 'cancel_requested'], rejected ? 'failed' : 'submission_uncertain', { errorCode: rejected ? code : 'creative_submission_uncertain', releaseReservation: rejected });
      }
      else if (latest.status === 'queued') {
        if (code === 'creative_approval_required') await repository.transition(run.id, owner, ['queued'], 'queued', { errorCode: code });
        else await repository.transition(run.id, owner, ['queued'], 'failed', { errorCode: code, releaseReservation: true });
      } else if (latest.status === 'downloading') await repository.transition(run.id, owner, ['downloading'], 'download_failed', { errorCode: code });
      else if (['provider_running', 'cancel_requested'].includes(latest.status)) {
        const expired = Date.now() - Date.parse(run.createdAt) > 24 * 60 * 60 * 1000;
        await repository.transition(run.id, owner, [latest.status], expired ? 'download_failed' : latest.status, { errorCode: code });
      }
    } finally {
      clearInterval(heartbeat);
      await repository.release(run.id, owner);
      workspace.broadcast(run.workspaceId);
    }
  }
}
const state = globalThis as typeof globalThis & { __orkestraiCreativeQueue?: CreativeQueueService };
export const creativeQueueService = state.__orkestraiCreativeQueue ??= new CreativeQueueService();
