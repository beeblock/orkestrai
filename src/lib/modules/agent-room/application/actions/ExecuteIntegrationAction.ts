import { Action } from '@beeblock/svelar/actions';
import type { ExecuteIntegrationDto } from '../dto/IntegrationDtos.js';
import { integrationExecutionService } from '../services/IntegrationExecutionService.js';

type ExecuteIntegrationActionInput = {
  workspaceId: string;
  dto: ExecuteIntegrationDto;
  context: {
    actorType: 'agent' | 'automation' | 'user' | 'integration' | 'system';
    actorId?: string | null;
    runId?: string | null;
  };
};

export class ExecuteIntegrationAction extends Action<ExecuteIntegrationActionInput, Record<string, unknown>> {
  async execute(input: ExecuteIntegrationActionInput): Promise<Record<string, unknown>> {
    return integrationExecutionService.execute(input.workspaceId, input.dto.input, input.context);
  }
}

export const executeIntegrationAction = new ExecuteIntegrationAction();
