import type { KnowledgeCommand } from '../../contracts/schemas/knowledge.schema.js';
export class KnowledgeCommandDto {
  constructor(readonly workspaceId: string, readonly input: KnowledgeCommand, readonly authorNodeId?: string) {}
}
