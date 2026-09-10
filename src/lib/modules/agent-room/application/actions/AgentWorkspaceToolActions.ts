import { Action } from '@beeblock/svelar/actions';
import type {
  CreateAgentWorkspaceToolDto, ExecuteAgentWorkspaceToolDto, PublishAgentWorkspaceToolDto,
  RollbackAgentWorkspaceToolDto, UpdateAgentWorkspaceToolDto,
} from '../dto/AgentWorkspaceToolDtos.js';
import { agentWorkspaceToolService, toolExecutionService } from '../services/AgentWorkspaceToolService.js';

export class CreateAgentWorkspaceToolAction extends Action<CreateAgentWorkspaceToolDto, unknown> {
  execute(dto: CreateAgentWorkspaceToolDto) { return agentWorkspaceToolService.create(dto.workspaceId, dto.input); }
}
export class UpdateAgentWorkspaceToolAction extends Action<UpdateAgentWorkspaceToolDto, unknown> {
  execute(dto: UpdateAgentWorkspaceToolDto) { return agentWorkspaceToolService.update(dto.workspaceId, dto.toolId, dto.input); }
}
export class ExecuteAgentWorkspaceToolAction extends Action<ExecuteAgentWorkspaceToolDto, unknown> {
  execute(dto: ExecuteAgentWorkspaceToolDto) { return toolExecutionService.execute(dto.workspaceId, dto.toolId, dto.input); }
}
export class PublishAgentWorkspaceToolAction extends Action<PublishAgentWorkspaceToolDto, unknown> {
  execute(dto: PublishAgentWorkspaceToolDto) { return agentWorkspaceToolService.publish(dto.workspaceId, dto.toolId, dto.actor); }
}
export class RollbackAgentWorkspaceToolAction extends Action<RollbackAgentWorkspaceToolDto, unknown> {
  execute(dto: RollbackAgentWorkspaceToolDto) { return agentWorkspaceToolService.rollback(dto.workspaceId, dto.toolId, dto.revision, dto.actor); }
}
