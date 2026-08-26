import type {
  CanvasEdgeStyle,
  CanvasNodePayload,
  CanvasNodeType,
  Workspace,
  WorkspaceHooks,
  WorkspaceRepositoryRoot,
} from '../../domain/types.js';
import type {
  CreateCanvasEdgeInput,
  CreateCanvasNodeInput,
  CreateWorkspaceInput,
  ChangeTerminalProviderInput,
  ChangeTerminalRuntimeInput,
  UpdateCanvasEdgeInput,
  UpdateCanvasNodeInput,
  UpdateWorkspaceInput,
} from '../../contracts/schemas/workspaceSchemas.js';

export class ChangeTerminalProviderDto {
  constructor(
    public readonly workspaceId: string,
    public readonly nodeId: string,
    public readonly provider: string,
    public readonly profileId: string | null = null,
  ) {}

  static from(workspaceId: string, nodeId: string, input: ChangeTerminalProviderInput): ChangeTerminalProviderDto {
    return new ChangeTerminalProviderDto(workspaceId, nodeId, input.provider, input.profileId ?? null);
  }
}

export class ChangeTerminalRuntimeDto {
  constructor(
    public readonly workspaceId: string,
    public readonly nodeId: string,
    public readonly mode: 'default' | 'native' | 'wsl',
    public readonly wslDistribution: string | null,
    public readonly wslWorkingDir: string | null,
  ) {}

  static from(workspaceId: string, nodeId: string, input: ChangeTerminalRuntimeInput): ChangeTerminalRuntimeDto {
    return new ChangeTerminalRuntimeDto(
      workspaceId,
      nodeId,
      input.mode,
      input.wslDistribution ?? null,
      input.wslWorkingDir ?? null,
    );
  }
}

export class CreateWorkspaceDto {
  constructor(
    public readonly name: string,
    public readonly workingDir: string,
    public readonly icon: string | null,
    public readonly instructions: string | null,
    public readonly runtimeKind: 'native' | 'wsl' = 'native',
    public readonly wslDistribution: string | null = null,
    public readonly wslWorkingDir: string | null = null,
    public readonly syncAgentInstructionFiles = false,
    public readonly hooks: WorkspaceHooks = {},
    public readonly repositoryRoots: WorkspaceRepositoryRoot[] = [],
    public readonly groupId: string | null = null,
  ) {}

  static from(input: CreateWorkspaceInput): CreateWorkspaceDto {
    return new CreateWorkspaceDto(
      input.name,
      input.workingDir,
      input.icon ?? null,
      input.instructions ?? null,
      input.runtimeKind,
      input.wslDistribution ?? null,
      input.wslWorkingDir ?? null,
      false,
      {},
      input.repositoryRoots,
      input.groupId ?? null,
    );
  }
}

export class UpdateWorkspaceDto {
  constructor(public readonly changes: Partial<Pick<Workspace, 'name' | 'workingDir' | 'runtimeKind' | 'wslDistribution' | 'wslWorkingDir' | 'icon' | 'instructions' | 'syncAgentInstructionFiles' | 'repositoryRoots'>>) {}

  static from(input: UpdateWorkspaceInput): UpdateWorkspaceDto {
    return new UpdateWorkspaceDto({
      name: input.name,
      workingDir: input.workingDir,
      runtimeKind: input.runtimeKind,
      wslDistribution: input.wslDistribution,
      wslWorkingDir: input.wslWorkingDir,
      icon: input.icon,
      instructions: input.instructions,
      syncAgentInstructionFiles: input.syncAgentInstructionFiles,
      repositoryRoots: input.repositoryRoots,
    });
  }
}

export class CreateCanvasNodeDto {
  constructor(
    public readonly workspaceId: string,
    public readonly type: CanvasNodeType,
    public readonly title: string | null,
    public readonly x: number | undefined,
    public readonly y: number | undefined,
    public readonly width: number | undefined,
    public readonly height: number | undefined,
    public readonly zIndex: number | undefined,
    public readonly payload: CanvasNodePayload | undefined
  ) {}

  static from(workspaceId: string, input: CreateCanvasNodeInput): CreateCanvasNodeDto {
    return new CreateCanvasNodeDto(
      workspaceId,
      input.type,
      input.title ?? null,
      input.x,
      input.y,
      input.width,
      input.height,
      input.zIndex,
      input.payload
    );
  }
}

export class UpdateCanvasNodeDto {
  constructor(
    public readonly nodeId: string,
    public readonly changes: Partial<{
      type: CanvasNodeType;
      title: string | null;
      x: number;
      y: number;
      width: number;
      height: number;
      zIndex: number;
      payload: CanvasNodePayload;
    }>
  ) {}

  static from(nodeId: string, input: UpdateCanvasNodeInput): UpdateCanvasNodeDto {
    return new UpdateCanvasNodeDto(nodeId, {
      type: input.type,
      title: input.title,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      zIndex: input.zIndex,
      payload: input.payload,
    });
  }
}

export class CreateCanvasEdgeDto {
  constructor(
    public readonly workspaceId: string,
    public readonly sourceNodeId: string,
    public readonly targetNodeId: string,
    public readonly style: CanvasEdgeStyle
  ) {}

  static from(workspaceId: string, input: CreateCanvasEdgeInput): CreateCanvasEdgeDto {
    return new CreateCanvasEdgeDto(workspaceId, input.sourceNodeId, input.targetNodeId, input.style);
  }
}

export class UpdateCanvasEdgeDto {
  constructor(
    public readonly edgeId: string,
    public readonly style: CanvasEdgeStyle
  ) {}

  static from(edgeId: string, input: UpdateCanvasEdgeInput): UpdateCanvasEdgeDto {
    return new UpdateCanvasEdgeDto(edgeId, input.style);
  }
}
