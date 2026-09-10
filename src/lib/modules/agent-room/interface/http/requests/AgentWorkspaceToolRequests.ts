import { FormRequest } from '@beeblock/svelar/forms';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { z } from 'zod';
import {
  createWorkspaceToolSchema, executeWorkspaceToolSchema, rollbackWorkspaceToolSchema,
  updateWorkspaceToolSchema,
} from '../../../contracts/schemas/agent-workspace-tool.schema.js';
import {
  CreateAgentWorkspaceToolDto, ExecuteAgentWorkspaceToolDto, RollbackAgentWorkspaceToolDto,
  UpdateAgentWorkspaceToolDto,
} from '../../../application/dto/AgentWorkspaceToolDtos.js';

const routeSchema = { id: z.string().uuid() };
const itemRouteSchema = { ...routeSchema, toolId: z.string().uuid() };
const createRequestSchema = createWorkspaceToolSchema.omit({ actor: true }).extend(routeSchema);
const updateRequestSchema = updateWorkspaceToolSchema.omit({ actor: true }).extend(itemRouteSchema);
const executeRequestSchema = executeWorkspaceToolSchema.omit({ actor: true, automationRunId: true }).extend(itemRouteSchema);

export class CreateAgentWorkspaceToolRequest extends FormRequest {
  rules() { return createRequestSchema; }
  passedValidation(data: z.infer<typeof createRequestSchema>) {
    const { id, ...input } = data;
    return new CreateAgentWorkspaceToolDto(id, { ...input, actor: { type: 'user', id: 'workspace-owner' } });
  }
}

export class UpdateAgentWorkspaceToolRequest extends FormRequest {
  rules() { return updateRequestSchema; }
  passedValidation(data: z.infer<typeof updateRequestSchema>) {
    const { id, toolId, ...input } = data;
    return new UpdateAgentWorkspaceToolDto(id, toolId, { ...input, actor: { type: 'user', id: 'workspace-owner' } });
  }
}

export class ExecuteAgentWorkspaceToolRequest extends FormRequest {
  rules() { return executeRequestSchema; }
  passedValidation(data: z.infer<typeof executeRequestSchema>) {
    const { id, toolId, ...input } = data;
    return new ExecuteAgentWorkspaceToolDto(id, toolId, { ...input, actor: { type: 'user', id: 'workspace-owner' }, automationRunId: null });
  }
}

export class RollbackAgentWorkspaceToolRequest extends FormRequest {
  rules() { return rollbackWorkspaceToolSchema.omit({ actor: true }).extend(itemRouteSchema); }
  passedValidation(data: { id: string; toolId: string; revision: number }) {
    return new RollbackAgentWorkspaceToolDto(data.id, data.toolId, data.revision, { type: 'user', id: 'workspace-owner' });
  }
}

export class ToolRunsQueryRequest extends FormRequest {
  rules() { return z.object({ id: z.string().uuid(), toolId: z.string().uuid().optional() }).strict(); }

  protected async parseBody(event: RequestEvent) {
    return { toolId: event.url.searchParams.get('toolId') ?? undefined };
  }
}
