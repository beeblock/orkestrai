import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import {
  CreateAgentWorkspaceToolAction, ExecuteAgentWorkspaceToolAction, PublishAgentWorkspaceToolAction,
  RollbackAgentWorkspaceToolAction, UpdateAgentWorkspaceToolAction,
} from '../../../application/actions/AgentWorkspaceToolActions.js';
import {
  CreateAgentWorkspaceToolRequest, ExecuteAgentWorkspaceToolRequest, RollbackAgentWorkspaceToolRequest,
  ToolRunsQueryRequest, UpdateAgentWorkspaceToolRequest,
} from '../requests/AgentWorkspaceToolRequests.js';
import { PublishAgentWorkspaceToolDto } from '../../../application/dto/AgentWorkspaceToolDtos.js';
import { agentWorkspaceToolService, toolExecutionService } from '../../../application/services/AgentWorkspaceToolService.js';
import { AgentWorkspaceToolResource } from '../resources/AgentWorkspaceToolResource.js';

export class AgentWorkspaceToolController extends Controller {
  async index(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.collection(await agentWorkspaceToolService.list(event.params.id)).toResponse(); }
    catch (error) { return this.failure(error, 'Could not list workspace tools.'); }
  }

  async store(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.make(await new CreateAgentWorkspaceToolAction().run(await CreateAgentWorkspaceToolRequest.validate(event)) as never).status(201).toResponse(); }
    catch (error) { return this.failure(error, 'Could not create workspace tool.'); }
  }

  async show(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.make(await agentWorkspaceToolService.find(event.params.id, event.params.toolId) as never).toResponse(); }
    catch (error) { return this.failure(error, 'Could not read workspace tool.'); }
  }

  async update(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.make(await new UpdateAgentWorkspaceToolAction().run(await UpdateAgentWorkspaceToolRequest.validate(event)) as never).toResponse(); }
    catch (error) { return this.failure(error, 'Could not update workspace tool.'); }
  }

  async archive(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.make(await agentWorkspaceToolService.archive(event.params.id, event.params.toolId, { type: 'user', id: 'workspace-owner' }) as never).toResponse(); }
    catch (error) { return this.failure(error, 'Could not archive workspace tool.'); }
  }

  async publish(event: RequestEvent) {
    try {
      const dto = new PublishAgentWorkspaceToolDto(event.params.id, event.params.toolId, { type: 'user', id: 'workspace-owner' });
      return AgentWorkspaceToolResource.make(await new PublishAgentWorkspaceToolAction().run(dto) as never).toResponse();
    } catch (error) { return this.failure(error, 'Could not publish workspace tool.'); }
  }

  async revisions(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.collection(await agentWorkspaceToolService.revisions(event.params.id, event.params.toolId) as never).toResponse(); }
    catch (error) { return this.failure(error, 'Could not list tool revisions.'); }
  }

  async rollback(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.make(await new RollbackAgentWorkspaceToolAction().run(await RollbackAgentWorkspaceToolRequest.validate(event)) as never).toResponse(); }
    catch (error) { return this.failure(error, 'Could not roll back workspace tool.'); }
  }

  async execute(event: RequestEvent) {
    try { return AgentWorkspaceToolResource.make(await new ExecuteAgentWorkspaceToolAction().run(await ExecuteAgentWorkspaceToolRequest.validate(event)) as never).toResponse(); }
    catch (error) { return this.failure(error, 'Could not execute workspace tool.'); }
  }

  async runs(event: RequestEvent) {
    try {
      const query = await ToolRunsQueryRequest.validate(event) as { toolId?: string };
      return AgentWorkspaceToolResource.collection(await toolExecutionService.listRuns(event.params.id, query.toolId) as never).toResponse();
    } catch (error) { return this.failure(error, 'Could not list tool runs.'); }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
