import type { OpenWorkspaceFolderInput } from '../../contracts/schemas/fsSchemas.js';

export class OpenWorkspaceFolderDto {
  constructor(
    public readonly workspaceId: string,
    public readonly actorId: string | null,
    public readonly path: string,
    public readonly select: boolean = false,
  ) {}

  static from(workspaceId: string, actorId: string | null, input: OpenWorkspaceFolderInput) {
    return new OpenWorkspaceFolderDto(workspaceId, actorId, input.path, input.select);
  }
}
