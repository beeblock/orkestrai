import type { LeadershipCommand } from '../../contracts/schemas/leadership.schema.js';

export class WorkspaceLeadershipDto {
  constructor(readonly workspaceId: string, readonly input: LeadershipCommand) {}
}
