import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { creativeMediaRepository as repository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeMediaRepository.js';
import { CreativeRun as RunModel } from '$lib/modules/creative-media/domain/models/CreativeRun.js';
import { creativeConfigSchema, creativePolicySchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import { CreativeQueueService } from '$lib/modules/creative-media/application/services/CreativeQueueService.js';
import { CreativeMediaError } from '$lib/modules/creative-media/domain/types.js';
import type { CreativePreview, CreativeRun } from '$lib/modules/creative-media/domain/types.js';
import { CreativeWorkflowService } from '$lib/modules/creative-media/application/services/CreativeWorkflowService.js';
import { CreativeProviderService } from '$lib/modules/creative-media/application/services/CreativeProviderService.js';

vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined), get: vi.fn(async () => ({ policy: { halted: false } })) }, AutonomyGatePendingError: class extends Error {} }));

describe('Creative video persistence and queue', () => {
  useSvelarTest({ refreshDatabase: true });
  async function fixture() {
    const workspaceId = uuidv7(), nodeId = uuidv7(), profileId = uuidv7();
    const profile = await repository.saveProfile({ id: profileId, name: 'Test fal', provider: 'fal', enabled: true, hasCredential: true });
    const policy = await repository.savePolicy(workspaceId, profileId, creativePolicySchema.parse({ enabled: true, allowExternalMedia: true, allowAgents: true, modelIds: ['wan-2.7-text'], maxRunCents: 400, maxDayCents: 600, maxConcurrentRuns: 2 }));
    const config = creativeConfigSchema.parse({ profileId, prompt: 'A test landscape' });
    const workflow = await repository.saveWorkflow(workspaceId, nodeId, { title: 'Test video', config });
    const preview: CreativePreview = { id: uuidv7(), workflowId: workflow.id, revision: workflow.revision, profileId, profileRevision: profile.revision, policyRevision: policy.revision, estimatedCents: 100, reservedCents: 400, currency: 'USD', expiresAt: new Date(Date.now() + 300000).toISOString(), snapshot: { config, prompt: config.prompt, revision: 1, catalogRevision: 'test', startImage: null, endImage: null } };
    const key = uuidv7();
    const run = await repository.reserve(workspaceId, nodeId, preview, { type: 'user' }, key);
    return { workspaceId, nodeId, profileId, policy, workflow, preview, run, key };
  }
  const remote = { requestId: 'test-request-123456', statusUrl: 'https://queue.fal.run/fal-ai/test/requests/test-request-123456/status', responseUrl: 'https://queue.fal.run/fal-ai/test/requests/test-request-123456', cancelUrl: 'https://queue.fal.run/fal-ai/test/requests/test-request-123456/cancel' };
  it('exposes unsaved Canvas and transferred drafts to agents without requiring a fabricated revision', async () => {
    const workspaceId = uuidv7(), nodeId = uuidv7();
    const node = { id: nodeId, type: 'videoWorkflow', title: 'Copied draft', payload: { draftConfig: { prompt: 'Animate this scene' } } };
    const workspace = { workspace: vi.fn(async () => ({})), actorCanWork: vi.fn(async () => true), node: vi.fn(async () => node), nodes: vi.fn(async () => [node]), writablePath: vi.fn(async () => '/confined/generated/videos'), updateNode: vi.fn(), connect: vi.fn(), broadcast: vi.fn() };
    const service = new CreativeWorkflowService(repository, { profiles: async () => [] } as never, {} as never, workspace as never);
    const actor = { type: 'agent' as const, nodeId: uuidv7(), taskId: uuidv7() };
    expect((await service.capabilities(workspaceId, actor)).drafts).toMatchObject([{ nodeId, config: { prompt: 'Animate this scene', profileId: null } }]);
    expect(await service.read(workspaceId, nodeId)).toMatchObject({ workflow: null, draftConfig: { prompt: 'Animate this scene' } });
    const saved = await service.save(workspaceId, { title: node.title, config: creativeConfigSchema.parse(node.payload.draftConfig) }, actor, nodeId);
    expect(saved.revision).toBe(1);
    expect((await service.capabilities(workspaceId, actor)).drafts).toEqual([]);
    await expect(service.save(workspaceId, { title: node.title, config: saved.config }, actor, nodeId)).rejects.toThrow('creative_revision_conflict');
  });
  async function ready(run: CreativeRun) {
    await RunModel.query().where('id', run.id).update({ next_poll_at: new Date(0).toISOString(), lease_expires_at: null });
    return (await repository.run(run.workspaceId, run.id))!;
  }
  function runtime(workflow: unknown) {
    const provider = { submit: vi.fn(async () => remote), status: vi.fn(async () => ({ status: 'completed', queuePosition: null })), cancel: vi.fn(async () => 'requested'), result: vi.fn(async () => ({ url: 'https://fal.media/video.mp4' })), download: vi.fn(async () => new Response('test')) };
    const output = { path: 'generated/videos/test.mp4', sha256: 'a'.repeat(64), size: 42, mimeType: 'video/mp4' };
    const service = { repository, provider, profiles: { credential: vi.fn(async () => ({ revealInsideTrustedExecutor: () => 'not-a-real-key' })) },
      workspace: { workspace: vi.fn(async () => ({ suspendedAt: null })), nodes: vi.fn(async () => []), createNode: vi.fn(), broadcast: vi.fn() },
      files: { store: vi.fn(async () => output), referenceData: vi.fn() }, authorize: vi.fn(async () => workflow), dispatch: vi.fn(async (_run, submit) => submit()),
    };
    return { service, provider, queue: new CreativeQueueService(service as unknown as CreativeWorkflowService) };
  }
  it('persists strict revisions, public run data and idempotent reservation', async () => {
    const f = await fixture();
    expect(await repository.reserve(f.workspaceId, f.nodeId, f.preview, { type: 'user' }, f.key)).toEqual(f.run);
    await expect(repository.saveWorkflow(f.workspaceId, f.nodeId, { title: 'Stale', config: f.workflow.config, revision: 2 })).rejects.toThrow('creative_revision_conflict');
    expect(JSON.stringify(f.run)).not.toMatch(/remote_json|credential|not-a-real-key/);
    await expect(repository.reserve(f.workspaceId, uuidv7(), f.preview, { type: 'user' }, f.key)).rejects.toThrow('creative_idempotency_conflict');
  });
  it('enforces daily budget across separate workflows and changed policies', async () => {
    const f = await fixture();
    const nodeId = uuidv7();
    const workflow = await repository.saveWorkflow(f.workspaceId, nodeId, { title: 'Other', config: f.workflow.config });
    await expect(repository.reserve(f.workspaceId, nodeId, { ...f.preview, workflowId: workflow.id }, { type: 'user' }, uuidv7())).rejects.toThrow('creative_budget_exceeded');
    await repository.savePolicy(f.workspaceId, f.profileId, { ...creativePolicySchema.parse({}), enabled: false }, f.policy.revision);
    await expect(repository.reserve(f.workspaceId, nodeId, { ...f.preview, workflowId: workflow.id }, { type: 'user' }, uuidv7())).rejects.toThrow('creative_preview_expired');
  });
  it('allows only one lease and submits once before downloading a reusable result', async () => {
    const f = await fixture();
    const first = await repository.claim(f.workspaceId, f.run.id, 'owner-a');
    expect(first).not.toBeNull();
    expect(await repository.claim(f.workspaceId, f.run.id, 'owner-b')).toBeNull();
    await repository.release(f.run.id, 'owner-a');
    const r = runtime(f.workflow);
    await r.queue.process(f.run);
    expect(r.provider.submit).toHaveBeenCalledTimes(1);
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('provider_running');
    await r.queue.process(await ready(f.run));
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('completed');
    expect(r.service.workspace.createNode).toHaveBeenCalledOnce();
    await r.queue.process(await ready(f.run));
    expect(r.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('never re-submits after a lost response or a crash during paid submission', async () => {
    const f = await fixture(); const r = runtime(f.workflow);
    r.provider.submit.mockRejectedValueOnce(new Error('network failed with SECRET'));
    await r.queue.process(f.run);
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('submission_uncertain');
    expect(JSON.stringify(await repository.run(f.workspaceId, f.run.id))).not.toContain('SECRET');
    await r.queue.process(await ready(f.run));
    expect(r.provider.submit).toHaveBeenCalledTimes(1);
    await RunModel.query().where('id', f.run.id).update({ status: 'submitting' });
    await r.queue.process(await ready(f.run));
    expect(r.provider.submit).toHaveBeenCalledTimes(1);
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('submission_uncertain');
  });
  it('keeps approval pending without sending and cancels queued work without charging', async () => {
    const f = await fixture(); const r = runtime(f.workflow);
    r.service.dispatch.mockRejectedValueOnce(new CreativeMediaError('creative_approval_required'));
    await r.queue.process(f.run);
    expect(r.provider.submit).not.toHaveBeenCalled();
    expect((await repository.run(f.workspaceId, f.run.id))?.errorCode).toBe('creative_approval_required');
    const result = await repository.command(f.workspaceId, f.run.id, 'cancel');
    expect(result.status).toBe('cancelled'); expect(result.reservedCents).toBe(0);
  });
  it('retries a failed download without another paid generation', async () => {
    const f = await fixture(); const r = runtime(f.workflow);
    await r.queue.process(f.run);
    r.service.files.store.mockRejectedValueOnce(new Error('disk full'));
    await r.queue.process(await ready(f.run));
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('download_failed');
    await repository.command(f.workspaceId, f.run.id, 'retry_download');
    await r.queue.process(await ready(f.run));
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('completed');
    expect(r.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('retains the budget when an owner closes an uncertain submission', async () => {
    const f = await fixture(); const r = runtime(f.workflow);
    r.provider.submit.mockRejectedValueOnce(new Error('connection reset'));
    await r.queue.process(f.run);
    const closed = await repository.command(f.workspaceId, f.run.id, 'close_unconfirmed');
    expect(closed.status).toBe('closed_unconfirmed');
    expect(closed.reservedCents).toBe(400);
    expect(await repository.activeForNodes(f.workspaceId, [f.nodeId])).toBe(false);
    await r.queue.process(await ready(closed));
    expect(r.provider.submit).toHaveBeenCalledTimes(1);
  });
  it('retains the provider handle when cancellation races with submit', async () => {
    const f = await fixture(); const r = runtime(f.workflow);
    r.provider.submit.mockImplementationOnce(async () => {
      await repository.command(f.workspaceId, f.run.id, 'cancel');
      return remote;
    });
    await r.queue.process(f.run);
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('cancel_requested');
    await ready(f.run);
    const claimed = await repository.claim(f.workspaceId, f.run.id, 'verify');
    expect(claimed?.remote).toEqual(remote);
    await repository.release(f.run.id, 'verify');
    await r.queue.process(await ready(f.run));
    expect(r.provider.cancel).toHaveBeenCalledWith('not-a-real-key', remote);
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('downloading');
  });
  it('does not submit suspended workspaces or leak an explicit provider rejection', async () => {
    const f = await fixture(); const r = runtime(f.workflow);
    r.service.workspace.workspace.mockResolvedValueOnce({ suspendedAt: '2026-09-17' } as never);
    await r.queue.process(f.run);
    expect(r.provider.submit).not.toHaveBeenCalled();
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('queued');
    r.provider.submit.mockRejectedValueOnce(new CreativeMediaError('creative_credential_rejected'));
    await r.queue.process(await ready(f.run));
    expect((await repository.run(f.workspaceId, f.run.id))?.status).toBe('failed');
    expect((await repository.run(f.workspaceId, f.run.id))?.reservedCents).toBe(0);
  });
  it('uses the same guarded workflow contract for agents and owners', async () => {
    const f = await fixture();
    await repository.command(f.workspaceId, f.run.id, 'cancel');
    const r = runtime(f.workflow);
    const workspace = { ...r.service.workspace, actorCanWork: vi.fn(async () => false), node: vi.fn(async () => ({ id: f.nodeId, type: 'videoWorkflow' })), writablePath: vi.fn(async () => '/tmp/generated/videos') };
    const provider = { ...r.provider, estimate: vi.fn(async () => ({ estimatedCents: 100, reservedCents: 400 })) };
    const service = new CreativeWorkflowService(repository, r.service.profiles as never, provider as never, workspace as never, r.service.files as never);
    const actor = { type: 'agent' as const, nodeId: uuidv7(), taskId: uuidv7() };
    await expect(service.preview(f.workspaceId, f.nodeId, actor)).rejects.toThrow('creative_agent_task_required');
    workspace.actorCanWork.mockResolvedValue(true);
    const { id: _id, workspaceId: _workspace, profileId: _profile, revision: _revision, ...grant } = f.policy;
    await repository.savePolicy(f.workspaceId, f.profileId, { ...grant, allowAgents: false }, f.policy.revision);
    await expect(service.preview(f.workspaceId, f.nodeId, actor)).rejects.toThrow('creative_workspace_disabled');
    expect(provider.estimate).not.toHaveBeenCalled();
    const preview = await service.preview(f.workspaceId, f.nodeId, { type: 'user' });
    expect(JSON.stringify(preview)).not.toContain('not-a-real-key');
    const input = { revision: preview.revision, previewId: preview.id, idempotencyKey: uuidv7() };
    const run = await service.run(f.workspaceId, f.nodeId, input, { type: 'user' });
    expect((await service.run(f.workspaceId, f.nodeId, input, { type: 'user' })).id).toBe(run.id);
    await expect(service.command(f.workspaceId, run.id, 'close_unconfirmed', actor)).rejects.toThrow('creative_owner_required');
    await expect(service.run(f.workspaceId, uuidv7(), input, { type: 'user' })).rejects.toThrow('creative_idempotency_conflict');
  });
  it('stores credentials only in the vault and rolls back a failed replacement', async () => {
    const vault = new Map<string, string>();
    const secrets = { get: vi.fn(async (key: string) => vault.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { vault.set(key, value); }), delete: vi.fn(async (key: string) => { vault.delete(key); }) };
    const service = new CreativeProviderService(repository, secrets as never);
    const input = { name: 'Account', provider: 'fal' as const, enabled: true, credential: 'test-secret-original' };
    const profile = await service.save(input);
    expect(JSON.stringify(await service.profiles())).not.toContain(input.credential);
    expect((await service.credential(profile.id)).revealInsideTrustedExecutor()).toBe(input.credential);
    secrets.get.mockResolvedValueOnce(input.credential).mockRejectedValueOnce(new Error('vault unavailable'));
    await expect(service.save({ ...input, credential: 'test-secret-replacement', revision: profile.revision }, profile.id)).rejects.toThrow('creative_vault_unavailable');
    expect((await service.credential(profile.id)).revealInsideTrustedExecutor()).toBe(input.credential);
    expect((await repository.profile(profile.id))?.revision).toBe(1);
    await service.remove(profile.id);
    expect(vault.size).toBe(0);
  });
});
