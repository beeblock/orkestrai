import { FormRequest } from '@beeblock/svelar/forms';
import { agentLearningCommandSchema } from '../../../contracts/schemas/agent-learning.schema.js';

export class AgentLearningCommandRequest extends FormRequest {
  rules() { return agentLearningCommandSchema; }
  authorize() { return true; }
  passedValidation(data: unknown) { return agentLearningCommandSchema.parse(data); }
}
