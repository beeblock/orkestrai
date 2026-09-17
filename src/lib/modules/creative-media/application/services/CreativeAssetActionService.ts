import { uuidv7 } from '@beeblock/svelar/support';
import { Connection } from '@beeblock/svelar/database';
import { extname } from 'node:path';
import { imageSize } from 'image-size';
import { readFile, unlink } from 'node:fs/promises';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import type { CreativeAssetInspection } from '../../domain/asset-review.js';
import { CreativeMediaError, type CreativeActor } from '../../domain/types.js';
import { creativeConfigSchema } from '../../contracts/schemas/creative-media.schema.js';
import { creativeEditPrompt, creativeEditSchema, type CreativeEdit } from '../../contracts/schemas/creative-edit.schema.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { creativeWorkflowService } from './CreativeWorkflowService.js';

export class CreativeAssetActionService {
  async prepare(workspaceId: string, source: CreativeAssetInspection, raw: CreativeEdit, actor: CreativeActor) {
    await creativeWorkflowService.assertActor(workspaceId, actor);
    const edit = creativeEditSchema.parse(raw), files = new CreativeMediaFiles();
    if (!source.snapshot.media.mimeType.startsWith('image/')) throw new CreativeMediaError('creative_unsupported_input');
    if (edit.executorNodeId) {
      const executor = await creativeWorkspaceGateway.node(workspaceId, edit.executorNodeId);
      if (executor?.type !== 'terminal' || (executor.payload as { provider?: string }).provider !== 'codex') throw new CreativeMediaError('creative_storyboard_executor_invalid');
    }
    const id = uuidv7(), path = `generated/creative-actions/${id}/reference${extname(source.snapshot.media.path).toLowerCase()}`;
    const frozen = await files.freeze(workspaceId, source.snapshot.media, path);
    let committed = false;
    try {
    if (edit.annotation) {
      const metadata = imageSize(await readFile(await creativeWorkspaceGateway.existingPath(workspaceId, path)));
      if (metadata.width !== edit.annotation.sourceWidth || metadata.height !== edit.annotation.sourceHeight) throw new CreativeMediaError('creative_reference_changed', 409);
    }
    const prompt = creativeEditPrompt(edit);
    const title = `${source.asset.title || 'Image'} · ${edit.operation.replaceAll('_', ' ')}`.slice(0, 120);
    const lineage = { actionId: id, sourceNodeId: source.asset.nodeId, sourceDigest: source.digest, source: source.snapshot, frozenReference: frozen, operation: edit.operation, annotation: edit.annotation ?? null };
    const result = await Connection.transaction(async () => {
      const reference = await creativeWorkspaceGateway.createNode(workspaceId, 'image', source.asset.title, { path: frozen.path }, source.asset.nodeId);
      let nodeId: string;
      if (edit.operation === 'animate') {
        const config = creativeConfigSchema.parse(edit.config ?? { modelId: 'kling-v3-pro-image' });
        config.prompt = prompt;
        config.requiredReferenceNodeIds = [...new Set([...config.requiredReferenceNodeIds, reference.id])];
        config.requiredCharacterIds = [...new Set([...config.requiredCharacterIds, ...source.snapshot.characters.map(character => character.id)])];
        // Generic endpoints keep this as a required input until explicitly mapped.
        if (config.modelId === 'kling-v3-pro-image') config.startImageNodeId = reference.id;
        nodeId = (await creativeWorkflowService.save(workspaceId, { title, config }, actor, undefined, reference.id)).nodeId;
        await creativeWorkspaceGateway.connect(workspaceId, reference.id, nodeId);
      } else {
        const draft = await creativeWorkspaceGateway.createImageDraft(workspaceId, { title, from: 'creative-action', prompt, count: edit.count, transparentBackground: edit.operation === 'remove_background', outputDirectory: 'generated/images', filePrefix: `edit-${id.slice(0, 8)}` }, reference.id, edit.executorNodeId, [reference.id]);
        nodeId = draft.id;
      }
      const node = (await creativeWorkspaceGateway.node(workspaceId, nodeId))!;
      await creativeWorkspaceGateway.updateNode(workspaceId, nodeId, node.title ?? title, { ...node.payload, creativeOrigin: lineage } as typeof node.payload);
      return { nodeId, referenceNodeId: reference.id, lineage };
    });
    committed = true;
    await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: `creative.asset.${edit.operation}`, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input: { sourceNodeId: source.asset.nodeId, sourceDigest: source.digest } }, { nodeId: result.nodeId });
    creativeWorkspaceGateway.broadcast(workspaceId);
    return result;
    } catch (error) {
      if (!committed) await unlink(await creativeWorkspaceGateway.writablePath(workspaceId, path)).catch(() => undefined);
      throw error;
    }
  }
}
export const creativeAssetActionService = new CreativeAssetActionService();
