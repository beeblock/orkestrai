import type { OpenWorkspaceFolderInput } from '../../contracts/schemas/fsSchemas.js';

export class OpenWorkspaceFolderDto {
  constructor(
    public readonly workspaceId: string,
    public readonly actorId: string,
    public readonly path: string,
  ) {}

  static from(workspaceId: string, actorId: string, input: OpenWorkspaceFolderInput) {
    return new OpenWorkspaceFolderDto(workspaceId, actorId, input.path);
  }
}
