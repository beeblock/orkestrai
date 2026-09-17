import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreativeAssetReviewService } from '$lib/modules/creative-media/application/services/CreativeAssetReviewService.js';
import { CreativeMediaFiles } from '$lib/modules/creative-media/application/services/CreativeMediaFiles.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { creativeAssetReviewRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeAssetReviewRepository.js';
import type { CreativeAssetInspection } from '$lib/modules/creative-media/domain/asset-review.js';
vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined) } }));
const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
describe('creative approval evidence', () => {
  useSvelarTest({ refreshDatabase: true });
  const owner = { type: 'user' as const };
  async function fixture() {
    const folder = await mkdtemp(join(tmpdir(), 'orkestrai-review-')); folders.push(folder);
    const workspaceId = (await workspaceRepository.createWorkspace({ name: 'Review fixture', workingDir: folder })).id;
    const bytes = await readFile('electron/resources/icons/512x512.png'); await writeFile(join(folder, 'output.png'), bytes);
    const node = await workspaceRepository.createNode({ workspaceId, type: 'image', title: 'Variant', payload: { path: 'output.png' }, x: 0, y: 0, width: 200, height: 200 });
    const service = new CreativeAssetReviewService();
    return { workspaceId, folder, bytes, node, service };
  }
  it('retains immutable review history and invalidates decisions after file changes', async () => {
    const f = await fixture(), initial = await f.service.inspect(f.workspaceId, f.node.id);
    const decide = (item: CreativeAssetInspection) => ({ command: 'decide' as const, nodeId: f.node.id, expectedDigest: item.digest, revision: item.review?.revision ?? 0, decision: 'approved' as const, comment: 'Identity and framing reviewed.' });
    expect(initial.reviewCurrent).toBe(false);
    const approved = await f.service.execute(f.workspaceId, decide(initial), owner) as CreativeAssetInspection;
    expect(approved).toMatchObject({ reviewCurrent: true, review: { decision: 'approved', revision: 1 } });
    await writeFile(join(f.folder, 'output.png'), Buffer.concat([f.bytes, Buffer.from('changed')]));
    const changed = await f.service.inspect(f.workspaceId, f.node.id);
    expect(changed.reviewCurrent).toBe(false);
    expect(changed.review!.snapshot.media.sha256).toBe(initial.snapshot.media.sha256);
    await expect(f.service.execute(f.workspaceId, decide(approved), owner)).rejects.toThrow('creative_reference_changed');
    await f.service.execute(f.workspaceId, decide(changed), owner);
    expect(await creativeAssetReviewRepository.history(f.workspaceId, f.node.id)).toHaveLength(2);
  });
  it('rejects stale review revisions, cross-workspace inspection and agent self-approval', async () => {
    const f = await fixture(), current = await f.service.inspect(f.workspaceId, f.node.id);
    await expect(f.service.inspect(uuidv7(), f.node.id)).rejects.toThrow('creative_reference_unavailable');
    vi.spyOn(creativeWorkspaceGateway, 'actorCanWork').mockResolvedValue(true);
    const agent = { type: 'agent' as const, nodeId: uuidv7(), taskId: uuidv7() };
    const input = { command: 'decide' as const, nodeId: f.node.id, expectedDigest: current.digest, revision: 0, decision: 'approved' as const, comment: 'Looks good' };
    await expect(f.service.execute(f.workspaceId, input, agent)).rejects.toThrow('creative_owner_required');
    await f.service.execute(f.workspaceId, { ...input, decision: 'proposed' }, agent);
    await expect(f.service.execute(f.workspaceId, input, owner)).rejects.toThrow('creative_revision_conflict');
    expect((await f.service.inspect(f.workspaceId, f.node.id)).review?.decision).toBe('proposed');
  });
  it('streams large video evidence without limiting it to the reference-upload size', async () => {
    const f = await fixture();
    const bytes = Buffer.alloc(65 * 1024 * 1024); bytes.writeUInt32BE(24, 0); bytes.write('ftypisom', 4); await writeFile(join(f.folder, 'clip.mp4'), bytes);
    const node = await workspaceRepository.createNode({ workspaceId: f.workspaceId, type: 'video', title: 'Clip', payload: { path: 'clip.mp4' }, x: 0, y: 0, width: 200, height: 200 });
    const result = await new CreativeMediaFiles().asset(f.workspaceId, node.id);
    expect(result.size).toBe(bytes.length); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    await workspaceRepository.updateNode(node.id, { payload: { path: '../outside.mp4' } });
    await expect(new CreativeMediaFiles().asset(f.workspaceId, node.id)).rejects.toThrow();
  });
  it('creates connected native action drafts without altering or generating the source', async () => {
    const f = await fixture(), source = await f.service.inspect(f.workspaceId, f.node.id);
    for (const operation of ['variation', 'remove_background', 'annotated_change', 'animate'] as const) {
      const result = await f.service.execute(f.workspaceId, { command: 'prepare', nodeId: f.node.id, expectedDigest: source.digest, comment: '', edit: { operation, direction: 'Make the jacket green.', count: 3, executorNodeId: null, ...(operation === 'annotated_change' ? { annotation: { sourceWidth: 512, sourceHeight: 512, x: 0.2, y: 0.25, width: 0.4, height: 0.5 } } : {}) } }, owner) as { nodeId: string; referenceNodeId: string; lineage: { frozenReference: { path: string } } };
      const node = await creativeWorkspaceGateway.node(f.workspaceId, result.nodeId);
      expect(node?.type).toBe(operation === 'animate' ? 'videoWorkflow' : 'imageWorkflow');
      expect(await readFile(join(f.folder, 'output.png'))).toEqual(f.bytes);
      expect(await readFile(join(f.folder, result.lineage.frozenReference.path))).toEqual(f.bytes);
      if (operation !== 'animate') expect(node?.payload).toMatchObject({ status: 'idle', count: 3, history: [], transparentBackground: operation === 'remove_background', referenceOrder: [result.referenceNodeId] });
      const edges = await workspaceRepository.listEdges(f.workspaceId);
      expect(edges.some(edge => edge.sourceNodeId === f.node.id && edge.targetNodeId === result.referenceNodeId)).toBe(true);
      expect(edges.filter(edge => edge.sourceNodeId === result.nodeId || edge.targetNodeId === result.nodeId)).toHaveLength(1);
      expect(edges.some(edge => edge.sourceNodeId === result.referenceNodeId && edge.targetNodeId === result.nodeId)).toBe(true);
    }
  });
  it('rejects changed inputs and forged annotation geometry before preparing an action', async () => {
    const f = await fixture(), source = await f.service.inspect(f.workspaceId, f.node.id);
    const command = { command: 'prepare' as const, nodeId: f.node.id, expectedDigest: source.digest, comment: '', edit: { operation: 'annotated_change' as const, direction: 'Change only the marked region.', count: 1, executorNodeId: null, annotation: { sourceWidth: 1024, sourceHeight: 1024, x: 0.5, y: 0.5, width: 0.4, height: 0.4 } } };
    await expect(f.service.execute(f.workspaceId, command, owner)).rejects.toThrow('creative_reference_changed');
    expect(await creativeWorkspaceGateway.nodes(f.workspaceId)).toHaveLength(1);
    await writeFile(join(f.folder, 'output.png'), Buffer.concat([f.bytes, Buffer.from('changed')]));
    await expect(f.service.execute(f.workspaceId, command, owner)).rejects.toThrow('creative_reference_changed');
    expect(await creativeWorkspaceGateway.nodes(f.workspaceId)).toHaveLength(1);
  });
});
