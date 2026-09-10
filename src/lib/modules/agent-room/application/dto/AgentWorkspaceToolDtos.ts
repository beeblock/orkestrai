import type {
  CreateWorkspaceToolInput, ExecuteWorkspaceToolInput, UpdateWorkspaceToolInput,
  WorkspaceToolActor,
} from '../../contracts/schemas/agent-workspace-tool.schema.js';

export class CreateAgentWorkspaceToolDto {
  constructor(public readonly workspaceId: string, public readonly input: CreateWorkspaceToolInput) {}
}

export class UpdateAgentWorkspaceToolDto {
  constructor(public readonly workspaceId: string, public readonly toolId: string, public readonly input: UpdateWorkspaceToolInput) {}
}

export class ExecuteAgentWorkspaceToolDto {
  constructor(public readonly workspaceId: string, public readonly toolId: string, public readonly input: ExecuteWorkspaceToolInput) {}
}

export class PublishAgentWorkspaceToolDto {
  constructor(public readonly workspaceId: string, public readonly toolId: string, public readonly actor: WorkspaceToolActor) {}
}

export class RollbackAgentWorkspaceToolDto {
  constructor(public readonly workspaceId: string, public readonly toolId: string, public readonly revision: number, public readonly actor: WorkspaceToolActor) {}
}
