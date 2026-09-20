import { Action } from '@beeblock/svelar/actions';
import type { CreativeMediaDto } from '../dto/CreativeMediaDto.js';
import type { CreativeRunRequest, CreativeWorkflowSave } from '../../contracts/schemas/creative-media.schema.js';
import { creativeWorkflowService } from '../services/CreativeWorkflowService.js';
import { creativeModelCatalog } from '../services/CreativeModelCatalogService.js';
import { creativeCatalogQuerySchema } from '../../contracts/schemas/creative-media.schema.js';
import { CreativeCharacterDto } from '../dto/CreativeCharacterDto.js';
import { ExecuteCreativeCharacterAction } from './ExecuteCreativeCharacterAction.js';
import { CreativeStoryboardDto } from '../dto/CreativeStoryboardDto.js';
import { ExecuteCreativeStoryboardAction } from './ExecuteCreativeStoryboardAction.js';
import { CreativeAssetReviewDto } from '../dto/CreativeAssetReviewDto.js';
import { ExecuteCreativeAssetReviewAction } from './ExecuteCreativeAssetReviewAction.js';
import { CreativeBrandKitDto } from '../dto/CreativeBrandKitDto.js';
import { ExecuteCreativeBrandKitAction } from './ExecuteCreativeBrandKitAction.js';
import { CreativeSequenceDto } from '../dto/CreativeSequenceDto.js';
import { ExecuteCreativeSequenceAction } from './ExecuteCreativeSequenceAction.js';
import { CreativeRecipeDto } from '../dto/CreativeRecipeDto.js';
import { ExecuteCreativeRecipeAction } from './ExecuteCreativeRecipeAction.js';
export class ExecuteCreativeMediaAction extends Action<CreativeMediaDto, unknown> {
  async execute(dto: CreativeMediaDto): Promise<unknown> {
    const service = creativeWorkflowService;
    await service.assertActor(dto.workspaceId, dto.actor, !['models', 'read', 'list', 'cancel', 'close_unconfirmed', 'remove'].includes(dto.command));
    switch (dto.command) {
      case 'sequences': return new ExecuteCreativeSequenceAction().execute(CreativeSequenceDto.from(dto.workspaceId, dto.actor, dto.input));
      case 'recipes': return new ExecuteCreativeRecipeAction().execute(CreativeRecipeDto.from(dto.workspaceId, dto.actor, dto.input));
      case 'brands': return new ExecuteCreativeBrandKitAction().execute(CreativeBrandKitDto.from(dto.workspaceId, dto.actor, dto.input));
      case 'assets': return new ExecuteCreativeAssetReviewAction().execute(CreativeAssetReviewDto.from(dto.workspaceId, dto.actor, dto.input));
      case 'storyboards': return new ExecuteCreativeStoryboardAction().execute(CreativeStoryboardDto.from(dto.workspaceId, dto.actor, dto.input));
      case 'characters': return new ExecuteCreativeCharacterAction().execute(CreativeCharacterDto.from(dto.workspaceId, dto.actor, dto.input));
      case 'models': {
        const input = creativeCatalogQuerySchema.parse(dto.input);
        if (input.pricingIds) return service.prices(dto.workspaceId, dto.actor, input.profileId!, input.pricingIds);
        if (input.endpoint) return creativeModelCatalog.contract(input.endpoint, input.provider);
        const catalog = await creativeModelCatalog.discover(input.provider, input.refresh);
        const models = catalog.models.filter(model => `${model.id} ${model.name} ${model.category}`.toLowerCase().includes(input.query.toLowerCase()));
        return { models: models.slice(input.offset, input.offset + input.limit), total: models.length, nextOffset: input.offset + input.limit < models.length ? input.offset + input.limit : null, source: catalog.source, fetchedAt: catalog.fetchedAt };
      }
      case 'list': return service.capabilities(dto.workspaceId, dto.actor);
      case 'read': return service.read(dto.workspaceId, dto.nodeId!);
      case 'create': case 'update': return service.save(dto.workspaceId, dto.input as CreativeWorkflowSave, dto.actor, dto.nodeId);
      case 'preview': return service.preview(dto.workspaceId, dto.nodeId!, dto.actor);
      case 'run': return service.run(dto.workspaceId, dto.nodeId!, dto.input as CreativeRunRequest, dto.actor);
      case 'cancel': case 'retry_download': case 'close_unconfirmed': return service.command(dto.workspaceId, dto.runId!, dto.command, dto.actor);
      case 'remove': await service.remove(dto.workspaceId, dto.nodeId!, dto.actor); return { removed: true };
    }
  }
}
