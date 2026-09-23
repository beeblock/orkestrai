import { FormRequest } from '@beeblock/svelar/forms';
import { knowledgeCommandSchema, knowledgeUploadSchema } from '../../../contracts/schemas/knowledge.schema.js';

export class KnowledgeCommandRequest extends FormRequest {
  rules() { return knowledgeCommandSchema; }
  authorize() { return true; }
  passedValidation(data: unknown) { return knowledgeCommandSchema.parse(data); }
}

export class KnowledgeUploadRequest extends FormRequest {
  rules() { return knowledgeUploadSchema; }
  authorize() { return true; }
  passedValidation(data: unknown) { return knowledgeUploadSchema.parse(data); }
}
