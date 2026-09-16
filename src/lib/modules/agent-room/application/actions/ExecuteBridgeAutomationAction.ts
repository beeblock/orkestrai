import type { BridgeAutomationCommandDto } from '../dto/BridgeAutomationCommandDto.js';
import { agentRoutineService } from '../services/AgentRoutineService.js';

export class ExecuteBridgeAutomationAction {
  async execute(workspaceId: string, actorId: string, dto: BridgeAutomationCommandDto, assertRelevant: () => Promise<void>) {
    return agentRoutineService.execute(workspaceId, actorId, dto.request, assertRelevant);
  }
}
