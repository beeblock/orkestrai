import type { CreativeActor } from '../../domain/types.js';
import { CreativeMediaError } from '../../domain/types.js';
import { creativeCatalogQuerySchema, creativeRunCommandSchema, creativeRunRequestSchema, creativeWorkflowSaveSchema } from '../../contracts/schemas/creative-media.schema.js';
export type CreativeCommand = 'models' | 'list' | 'read' | 'create' | 'update' | 'preview' | 'run' | 'cancel' | 'retry_download' | 'close_unconfirmed' | 'remove';
export class CreativeMediaDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly command: CreativeCommand, readonly nodeId?: string, readonly input?: unknown, readonly runId?: string) {}
  static from(workspaceId: string, actor: CreativeActor, command: CreativeCommand, nodeId?: string, input?: unknown, runId?: string) {
    const value = command === 'models' ? creativeCatalogQuerySchema.parse(input ?? {}) : command === 'create' || command === 'update' ? creativeWorkflowSaveSchema.parse(input)
      : command === 'run' ? creativeRunRequestSchema.parse(input)
      : ['cancel', 'retry_download', 'close_unconfirmed'].includes(command) ? creativeRunCommandSchema.parse({ command, runId }) : undefined;
    if (!['models', 'list', 'create', 'cancel', 'retry_download', 'close_unconfirmed'].includes(command) && !nodeId) throw new CreativeMediaError('creative_node_required');
    return new CreativeMediaDto(workspaceId, actor, command, nodeId, value, runId);
  }
}
