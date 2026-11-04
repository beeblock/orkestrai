import { FormRequest } from '@beeblock/svelar/forms';
import { markAttentionReadSchema, type MarkAttentionReadInput } from '../../../contracts/schemas/attention.schema.js';

export class MarkAttentionReadRequest extends FormRequest {
  rules() { return markAttentionReadSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): MarkAttentionReadInput { return markAttentionReadSchema.parse(data); }
}
