import type {
  CompleteImageWorkflowInput,
  FailImageWorkflowInput,
  RunImageWorkflowInput,
} from '../../contracts/schemas/imageWorkflowSchemas.js';

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
