import { Action } from '@beeblock/svelar/actions';
import type { CreativeMediaDto } from '../dto/CreativeMediaDto.js';
import type { CreativeRunRequest, CreativeWorkflowSave } from '../../contracts/schemas/creative-media.schema.js';
import { creativeWorkflowService } from '../services/CreativeWorkflowService.js';
import { falModelCatalog } from '../services/FalModelCatalogService.js';
import { creativeCatalogQuerySchema } from '../../contracts/schemas/creative-media.schema.js';
export class ExecuteCreativeMediaAction extends Action<CreativeMediaDto, unknown> {
  async execute(dto: CreativeMediaDto): Promise<unknown> {
    const service = creativeWorkflowService;
    await service.assertActor(dto.workspaceId, dto.actor, !['models', 'read', 'list', 'cancel', 'close_unconfirmed', 'remove'].includes(dto.command));
    switch (dto.command) {
      case 'models': {
        const input = creativeCatalogQuerySchema.parse(dto.input);
        if (input.endpoint) return falModelCatalog.contract(input.endpoint);
        if (input.refresh) await falModelCatalog.list(true);
        const catalog = falModelCatalog.discover();
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
