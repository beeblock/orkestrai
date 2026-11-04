import type { MarkAttentionReadInput } from '../../contracts/schemas/attention.schema.js';

export class MarkAttentionReadDto {
  constructor(public readonly workspaceId: string | null) {}
  static from(input: MarkAttentionReadInput): MarkAttentionReadDto {
    return new MarkAttentionReadDto(input.workspaceId ?? null);
  }
}
