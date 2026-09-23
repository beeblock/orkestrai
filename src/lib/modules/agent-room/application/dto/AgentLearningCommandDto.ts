import type { AgentLearningCommand } from '../../contracts/schemas/agent-learning.schema.js';
export class AgentLearningCommandDto {
  constructor(readonly workspaceId: string, readonly input: AgentLearningCommand, readonly actor: { type: 'user' } | { type: 'agent'; nodeId: string }) {}
}
