import { createHash } from 'node:crypto';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { CreativeMediaError, type CreativeActor } from '../../domain/types.js';
import type { CreativeAssetInspection, CreativeAssetSnapshot, CreativeAssetSummary } from '../../domain/asset-review.js';
import { creativeAssetCommandSchema, type CreativeAssetCommand } from '../../contracts/schemas/creative-asset.schema.js';
import { creativeAssetReviewRepository } from '../../infrastructure/repositories/CreativeAssetReviewRepository.js';
import { creativeMediaRepository } from '../../infrastructure/repositories/CreativeMediaRepository.js';
import { creativeCharacterRepository } from '../../infrastructure/repositories/CreativeCharacterRepository.js';
import type { ImageWorkflowNodePayload } from '$lib/modules/agent-room/domain/types.js';
import { creativeWorkflowService } from './CreativeWorkflowService.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class CreativeAssetReviewService {
  async list(workspaceId: string): Promise<CreativeAssetSummary[]> {
    return (await creativeWorkspaceGateway.nodes(workspaceId)).filter(node => ['image', 'video'].includes(node.type) && typeof (node.payload as { path?: string }).path === 'string').map(node => {
      const payload = node.payload as { path: string; workflowNodeId?: string; generatedBy?: { workflowNodeId?: string } };
      return { nodeId: node.id, title: node.title ?? '', type: node.type as 'image' | 'video', path: payload.path, groupId: payload.generatedBy?.workflowNodeId ?? payload.workflowNodeId ?? null };
    });
  }
  async inspect(workspaceId: string, nodeId: string): Promise<CreativeAssetInspection> {
    const asset = (await this.list(workspaceId)).find(item => item.nodeId === nodeId);
    if (!asset) throw new CreativeMediaError('creative_reference_unavailable', 404);
    const media = await new CreativeMediaFiles().asset(workspaceId, nodeId);
    const node = (await creativeWorkspaceGateway.node(workspaceId, nodeId))!;
    const payload = node.payload as { runId?: string; generatedBy?: { runId?: string; inputHash?: string } };
    const runId = payload.runId ?? payload.generatedBy?.runId ?? null;
    const run = asset.type === 'video' && runId ? await creativeMediaRepository.run(workspaceId, runId) : null;
    const snapshot: CreativeAssetSnapshot = { media, origin: { workflowNodeId: asset.groupId, runId, inputHash: run ? hash(run.snapshot) : payload.generatedBy?.inputHash ?? null }, characters: run?.snapshot.characters?.map(({ id, version, digest, name }) => ({ id, version, digest, name })) ?? [] };
    if (asset.type === 'image' && asset.groupId && runId) {
      const workflow = await creativeWorkspaceGateway.node(workspaceId, asset.groupId);
      const history = (workflow?.payload as ImageWorkflowNodePayload | undefined)?.history?.find(item => item.id === runId && item.inputHash === snapshot.origin.inputHash);
      for (const refId of history?.referenceNodeIds ?? []) {
        const reference = await creativeWorkspaceGateway.node(workspaceId, refId);
        const identity = reference?.payload as { characterId?: string; characterDigest?: string } | undefined;
        if (!identity?.characterId || !identity.characterDigest) continue;
        const character = await creativeCharacterRepository.read(workspaceId, identity.characterId);
        if (character?.state === 'locked' && character.snapshot?.digest === identity.characterDigest && !snapshot.characters.some(item => item.id === character.id)) snapshot.characters.push({ id: character.id, version: character.version, digest: character.snapshot.digest, name: character.definition.name });
      }
    }
    const digest = hash(snapshot), history = await creativeAssetReviewRepository.history(workspaceId, nodeId), review = history[0] ?? null;
    return { asset, snapshot, digest, review, history, reviewCurrent: !!review && review.digest === digest };
  }
  async execute(workspaceId: string, raw: CreativeAssetCommand, actor: CreativeActor) {
    const input = creativeAssetCommandSchema.parse(raw);
    await creativeWorkflowService.assertActor(workspaceId, actor, input.command === 'decide');
    if (input.command === 'list') return this.list(workspaceId);
    if (input.command === 'inspect') return this.inspect(workspaceId, input.nodeId!);
    if (actor.type === 'agent' && input.decision !== 'proposed') throw new CreativeMediaError('creative_owner_required', 403);
    return withCreativeProfileLock(`asset-review:${workspaceId}:${input.nodeId}`, async () => {
      const current = await this.inspect(workspaceId, input.nodeId!);
      if (current.digest !== input.expectedDigest) throw new CreativeMediaError('creative_reference_changed', 409);
      await creativeAssetReviewRepository.append(workspaceId, input.nodeId!, input.revision!, current.digest, current.snapshot, input.decision!, input.comment, actor);
      await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: 'creative.asset.review', actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input: { nodeId: input.nodeId, digest: current.digest, decision: input.decision } }, { reviewed: true });
      creativeWorkspaceGateway.broadcast(workspaceId);
      return this.inspect(workspaceId, input.nodeId!);
    });
  }
}
export const creativeAssetReviewService = new CreativeAssetReviewService();
