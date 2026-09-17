import { Action } from '@beeblock/svelar/actions';
import type { CreativeMediaDto } from '../dto/CreativeMediaDto.js';
import type { CreativeRunRequest, CreativeWorkflowSave } from '../../contracts/schemas/creative-media.schema.js';
import { creativeWorkflowService } from '../services/CreativeWorkflowService.js';
export class ExecuteCreativeMediaAction extends Action<CreativeMediaDto, unknown> {
  async execute(dto: CreativeMediaDto): Promise<unknown> {
    const service = creativeWorkflowService;
    await service.assertActor(dto.workspaceId, dto.actor, !['read', 'list', 'cancel', 'close_unconfirmed', 'remove'].includes(dto.command));
    switch (dto.command) {
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
