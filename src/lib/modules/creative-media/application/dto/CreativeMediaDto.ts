import type { CreativeActor } from '../../domain/types.js';
import { creativeVideoUploadSchema } from '../../contracts/schemas/creative-video-upload.schema.js';

export class CreativeVideoUploadDto {
  private constructor(readonly workspaceId: string, readonly file: File, readonly x: number, readonly y: number, readonly floorId: string | null) {}
  static from(workspaceId: string, input: unknown) {
    const value = creativeVideoUploadSchema.parse(input);
    return new CreativeVideoUploadDto(workspaceId, value.file, value.x, value.y, value.floorId);
  }
}
import { CreativeMediaError } from '../../domain/types.js';
import { creativeCatalogQuerySchema, creativeRunCommandSchema, creativeRunRequestSchema, creativeWorkflowSaveSchema, creativeWorkflowReadSchema, creativeVideoImportSchema } from '../../contracts/schemas/creative-media.schema.js';
import { creativeCharacterCommandSchema } from '../../contracts/schemas/creative-character.schema.js';
import { creativeStoryboardCommandSchema } from '../../contracts/schemas/creative-storyboard.schema.js';
import { creativeAssetCommandSchema } from '../../contracts/schemas/creative-asset.schema.js';
import { creativeBrandCommandSchema } from '../../contracts/schemas/creative-brand.schema.js';
import { creativeSequenceCommandSchema } from '../../contracts/schemas/creative-sequence.schema.js';
import { creativeRecipeCommandSchema } from '../../contracts/schemas/creative-recipe.schema.js';
export type CreativeCommand = 'import' | 'sequences' | 'recipes' | 'brands' | 'assets' | 'storyboards' | 'characters' | 'models' | 'list' | 'read' | 'create' | 'update' | 'preview' | 'run' | 'cancel' | 'retry_download' | 'close_unconfirmed' | 'remove';
export class CreativeMediaDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly command: CreativeCommand, readonly nodeId?: string, readonly input?: unknown, readonly runId?: string) {}
  static from(workspaceId: string, actor: CreativeActor, command: CreativeCommand, nodeId?: string, input?: unknown, runId?: string) {
    const value = command === 'sequences' ? creativeSequenceCommandSchema.parse(input) : command === 'recipes' ? creativeRecipeCommandSchema.parse(input) : command === 'brands' ? creativeBrandCommandSchema.parse(input) : command === 'assets' ? creativeAssetCommandSchema.parse(input) : command === 'storyboards' ? creativeStoryboardCommandSchema.parse(input) : command === 'characters' ? creativeCharacterCommandSchema.parse(input) : command === 'models' ? creativeCatalogQuerySchema.parse(input ?? {}) : command === 'create' || command === 'update' ? creativeWorkflowSaveSchema.parse(input)
      : command === 'run' ? creativeRunRequestSchema.parse(input)
      : command === 'read' ? creativeWorkflowReadSchema.parse(input ?? {})
      : command === 'import' ? creativeVideoImportSchema.parse(input)
      : ['cancel', 'retry_download', 'close_unconfirmed'].includes(command) ? creativeRunCommandSchema.parse({ command, runId }) : undefined;
    if (!['import', 'sequences', 'recipes', 'brands', 'assets', 'storyboards', 'characters', 'models', 'list', 'create', 'cancel', 'retry_download', 'close_unconfirmed'].includes(command) && !nodeId) throw new CreativeMediaError('creative_node_required');
    return new CreativeMediaDto(workspaceId, actor, command, nodeId, value, runId);
  }
}
