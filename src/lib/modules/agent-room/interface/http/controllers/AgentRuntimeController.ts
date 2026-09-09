import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { FormRequest } from '@beeblock/svelar/forms';
import { agentRuntimeActionSchema, updateAgentRuntimeSchema } from '../../../contracts/schemas/agent-runtime.schema.js';
import { agentRuntimeService } from '../../../application/services/AgentRuntimeService.js';

class UpdateAgentRuntimeRequest extends FormRequest {
  rules() {
    return updateAgentRuntimeSchema;
  }
  authorize(): boolean {
    return true;
  }
  passedValidation(data: unknown) {
    return updateAgentRuntimeSchema.parse(data);
  }
}

class AgentRuntimeActionRequest extends FormRequest {
  rules() {
    return agentRuntimeActionSchema;
  }
  authorize(): boolean {
    return true;
  }
  passedValidation(data: unknown) {
    return agentRuntimeActionSchema.parse(data);
  }
}

export class AgentRuntimeController extends Controller {
  async show(event: RequestEvent) {
    try {
      return this.json({
        data: await agentRuntimeService.status(event.params.id, event.params.nodeId),
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  async update(event: RequestEvent) {
    try {
      const input = await UpdateAgentRuntimeRequest.validate(event);
      return this.json({
        data: await agentRuntimeService.configure(event.params.id, event.params.nodeId, input),
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  async action(event: RequestEvent) {
    try {
      const input = await AgentRuntimeActionRequest.validate(event);
      return this.json({
        data: input.action === 'wake' ? await agentRuntimeService.wake(event.params.id, event.params.nodeId) : await agentRuntimeService.sleep(event.params.id, event.params.nodeId),
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  private failure(error: unknown) {
    const message = error instanceof Error ? error.message : 'AGENT_RUNTIME_FAILED';
    return this.json({ error: message }, message === 'AGENT_NOT_FOUND' ? 404 : 422);
  }
}
