import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { z } from 'zod';
import { agentLearningService } from '../../../application/services/AgentLearningService.js';
import { bridgeService } from '../../../application/services/BridgeService.js';
import { ptySessionManager } from '../../../infrastructure/pty/PtySessionManager.ts';
import { AgentLearningCommandDto } from '../../../application/dto/AgentLearningCommandDto.js';
import { AgentLearningCommandRequest } from '../requests/AgentLearningCommandRequest.js';

export class AgentLearningController extends Controller {
  async index(event: RequestEvent) {
    try {
      const context = await this.context(event);
      if (context.actor.type === 'agent') {
        const query = z.string().max(500).parse(event.url.searchParams.get('q') ?? '');
        const limit = z.coerce.number().int().min(1).max(50).parse(event.url.searchParams.get('limit') ?? 20);
        return this.json({ data: await agentLearningService.recall(context.workspaceId, context.actor.nodeId, query, limit) });
      }
      const nodeId = event.url.searchParams.get('nodeId') || undefined;
      return this.json({ data: await agentLearningService.list(context.workspaceId, nodeId) });
    } catch (error) { return this.failure(error); }
  }
  async store(event: RequestEvent) {
    try {
      const { workspaceId, actor } = await this.context(event);
      // The workspace route id is not the lesson id in the command body.
      const input = await AgentLearningCommandRequest.validate({ ...event, params: {} });
      return this.json({ data: await agentLearningService.execute(new AgentLearningCommandDto(workspaceId, input, actor)) });
    } catch (error) { return this.failure(error); }
  }
  private async context(event: RequestEvent): Promise<{ workspaceId: string; actor: AgentLearningCommandDto['actor'] }> {
    if (event.params.id) return { workspaceId: event.params.id, actor: { type: 'user' } };
    const token = event.request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const workspace = await bridgeService.resolveWorkspaceByToken(token);
    const nodeId = ptySessionManager.resolveBridgeAgent(workspace.id, event.request.headers.get('x-orkestrai-agent-token') ?? '');
    if (!nodeId) throw new Error('learning_agent_identity_required');
    return { workspaceId: workspace.id, actor: { type: 'agent', nodeId } };
  }
  private failure(error: unknown) {
    const code = error instanceof Error && error.message.startsWith('learning_') ? error.message : 'learning_request_failed';
    return this.json({ error: code }, code === 'learning_revision_conflict' ? 409 : 422);
  }
}
