import type { DecideAttentionInput } from '../../contracts/schemas/attention.schema.js';

export class DecideAttentionDto {
  constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    public readonly decision: DecideAttentionInput['decision'],
  ) {}

  static from(id: string, input: DecideAttentionInput): DecideAttentionDto {
    return new DecideAttentionDto(id, input.workspaceId, input.decision);
  }
}
