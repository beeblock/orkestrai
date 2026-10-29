import type { CreateModelAccessInput, JoinModelAccessInput, ApproveModelAccessInput } from '../../contracts/schemas/model-access.schema.js';
export class CreateModelAccessDto {
  private constructor(readonly input: CreateModelAccessInput) {}
  static from(input: CreateModelAccessInput) { return new CreateModelAccessDto(input); }
}
export class JoinModelAccessDto {
  private constructor(readonly input: JoinModelAccessInput) {}
  static from(input: JoinModelAccessInput) { return new JoinModelAccessDto(input); }
}
export class ApproveModelAccessDto {
  private constructor(readonly grantId: string, readonly input: ApproveModelAccessInput) {}
  static from(grantId: string, input: ApproveModelAccessInput) { return new ApproveModelAccessDto(grantId, input); }
}
export class GuestAgentDto {
  private constructor(readonly workspaceId: string, readonly nodeId: string, readonly input: import('../../contracts/schemas/model-access.schema.js').GuestAgentInput) {}
  static from(workspaceId: string, nodeId: string, input: import('../../contracts/schemas/model-access.schema.js').GuestAgentInput) { return new GuestAgentDto(workspaceId, nodeId, input); }
}
