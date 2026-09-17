import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { Connection } from '@beeblock/svelar/database';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeBrandKitRepository } from '../../infrastructure/repositories/CreativeBrandKitRepository.js';
import { creativeBrandCommandSchema, type CreativeBrandCommand } from '../../contracts/schemas/creative-brand.schema.js';
import { CreativeMediaError, type CreativeActor, type CreativeMediaReference } from '../../domain/types.js';
import type { CreativeBrandSnapshot } from '../../domain/brand-kit.js';
import { creativeWorkflowService } from './CreativeWorkflowService.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';

export class CreativeBrandKitService {
  async read(workspaceId: string, id: string) { const kit = await creativeBrandKitRepository.read(workspaceId, id); if (!kit) throw new CreativeMediaError('creative_brand_not_found', 404); return kit; }
  async execute(workspaceId: string, raw: CreativeBrandCommand, actor: CreativeActor) {
    const input = creativeBrandCommandSchema.parse(raw);
    await creativeWorkflowService.assertActor(workspaceId, actor, !['list', 'read', 'library'].includes(input.command));
    if (input.command === 'list') return creativeBrandKitRepository.list(workspaceId);
    if (input.command === 'read') return this.read(workspaceId, input.id!);
    if (input.command === 'library') {
      if (actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
      const seen = new Set<string>(), items = [];
      for (const kit of await creativeBrandKitRepository.library()) {
        const key = `${kit.familyId}:${kit.version}`;
        if (seen.has(key)) continue;
        const workspace = await creativeWorkspaceGateway.workspace(kit.workspaceId);
        if (!workspace) continue;
        seen.add(key); items.push({ ...kit, workspaceName: workspace.name });
      }
      return items;
    }
    if (input.command === 'lock' && actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
    return withCreativeProfileLock('brand-library', async () => {
      const files = new CreativeMediaFiles();
      let result;
      if (input.command === 'place') {
        const sourceId = input.sourceWorkspaceId ?? workspaceId;
        if (sourceId !== workspaceId && actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
        const source = await this.read(sourceId, input.id!);
        if (source.state !== 'locked' || !source.snapshot) throw new CreativeMediaError('creative_brand_lock_required');
        await creativeWorkspaceGateway.characterDestination(workspaceId, input.floorId ?? null);
        await files.freezeMany(workspaceId, source.snapshot.assets.map(reference => ({ reference, path: reference.path })), sourceId);
        result = await Connection.transaction(async () => {
          const kit = await creativeBrandKitRepository.importLocked(workspaceId, source);
          return { kit, ...await creativeWorkspaceGateway.placeBrand(kit, input.position, input.floorId ?? null) };
        });
      } else if (input.command === 'create') result = await creativeBrandKitRepository.create(workspaceId, input.definition!);
      else {
        const kit = await this.read(workspaceId, input.id!);
        if (input.command === 'fork') {
          if (kit.state !== 'locked') throw new CreativeMediaError('creative_brand_lock_required');
          result = await creativeBrandKitRepository.create(workspaceId, kit.definition, kit.familyId);
        } else {
          if (kit.state !== 'draft') throw new CreativeMediaError('creative_brand_locked', 409);
          if (kit.revision !== input.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
          if (input.command === 'remove') { await creativeBrandKitRepository.remove(workspaceId, kit.id, kit.revision); result = { removed: true }; }
          else if (input.command === 'update') result = await creativeBrandKitRepository.update(workspaceId, kit.id, kit.revision, input.definition!);
          else {
            const definition = structuredClone(kit.definition), sources: Array<{ reference: CreativeMediaReference; path: string }> = [];
            if (!definition.assets.length && !definition.colors.length && !definition.rules) throw new CreativeMediaError('creative_brand_incomplete');
            let size = 0;
            for (const [index, asset] of definition.assets.entries()) {
              const reference = await files.media(workspaceId, { path: asset.path }); size += reference.size;
              if (!reference.mimeType.startsWith('image/') || size > 100 * 1024 * 1024) throw new CreativeMediaError('creative_reference_invalid');
              sources.push({ reference, path: `generated/brands/${kit.familyId}/v${kit.version}/r${kit.revision}/${index + 1}-${reference.sha256.slice(0, 12)}${extname(reference.path).toLowerCase()}` });
            }
            const assets = await files.freezeMany(workspaceId, sources);
            definition.assets = definition.assets.map((asset, index) => ({ ...asset, path: assets[index].path }));
            const content = { definition, assets };
            const snapshot: CreativeBrandSnapshot = { ...content, digest: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
            result = await creativeBrandKitRepository.update(workspaceId, kit.id, kit.revision, definition, snapshot);
          }
        }
      }
      await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: `creative.brand.${input.command}`, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input: { id: input.id, sourceWorkspaceId: input.sourceWorkspaceId, revision: input.revision } }, { saved: true });
      creativeWorkspaceGateway.broadcast(workspaceId);
      return result;
    });
  }
}
export const creativeBrandKitService = new CreativeBrandKitService();
