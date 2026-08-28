import type {
  AddImageWorkflowReferenceInput,
  CompleteImageWorkflowInput,
  ConnectImageWorkflowNodeInput,
  CreateImageWorkflowInput,
  FailImageWorkflowInput,
  RunImageWorkflowInput,
  UpdateImageWorkflowInput,
} from '../../contracts/schemas/imageWorkflowSchemas.js';

export class CreateImageWorkflowDto {
  constructor(public readonly workspaceId: string, public readonly input: CreateImageWorkflowInput, public readonly actorNodeId: string) {}
}

export class UpdateImageWorkflowDto {
  constructor(public readonly workspaceId: string, public readonly nodeId: string, public readonly input: UpdateImageWorkflowInput, public readonly actorNodeId: string) {}
}

export class ConnectImageWorkflowNodeDto {
  constructor(public readonly workspaceId: string, public readonly nodeId: string, public readonly input: ConnectImageWorkflowNodeInput, public readonly actorNodeId: string) {}
}

export class AddImageWorkflowReferenceDto {
  constructor(public readonly workspaceId: string, public readonly nodeId: string, public readonly input: AddImageWorkflowReferenceInput, public readonly actorNodeId: string) {}
}

export class RunImageWorkflowDto {
  constructor(
    public readonly workspaceId: string,
    public readonly nodeId: string,
    public readonly config: RunImageWorkflowInput,
    public readonly actorNodeId: string | null,
  ) {}

  static from(workspaceId: string, nodeId: string, input: RunImageWorkflowInput, actorNodeId: string | null = null) {
    return new RunImageWorkflowDto(workspaceId, nodeId, input, actorNodeId);
  }
}

export class CompleteImageWorkflowDto {
  constructor(
    public readonly workspaceId: string,
    public readonly nodeId: string,
    public readonly runId: string,
    public readonly outputPaths: string[],
    public readonly actorNodeId: string,
  ) {}

  static from(workspaceId: string, nodeId: string, input: CompleteImageWorkflowInput, actorNodeId: string) {
    return new CompleteImageWorkflowDto(workspaceId, nodeId, input.runId, input.outputPaths, actorNodeId);
  }
}

export class FailImageWorkflowDto {
  constructor(
    public readonly workspaceId: string,
    public readonly nodeId: string,
    public readonly runId: string,
    public readonly errorCode: FailImageWorkflowInput['errorCode'],
    public readonly actorNodeId: string,
  ) {}

  static from(workspaceId: string, nodeId: string, input: FailImageWorkflowInput, actorNodeId: string) {
    return new FailImageWorkflowDto(workspaceId, nodeId, input.runId, input.errorCode, actorNodeId);
  }
}
