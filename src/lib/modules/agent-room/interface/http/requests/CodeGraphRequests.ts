import { FormRequest } from '@beeblock/svelar/forms';
import {
  codeGraphIndexSchema,
  codeGraphSearchSchema,
  codeGraphTraversalSchema,
  codeGraphOverviewSchema,
  type CodeGraphIndexInput,
  type CodeGraphSearchInput,
  type CodeGraphTraversalInput,
  type CodeGraphOverviewInput,
} from '../../../contracts/schemas/codeGraphSchemas.js';

abstract class AuthorizedRequest extends FormRequest {
  authorize(): boolean {
    return true;
  }
}

export class IndexCodeGraphRequest extends AuthorizedRequest {
  rules() { return codeGraphIndexSchema; }
  passedValidation(data: unknown): CodeGraphIndexInput { return codeGraphIndexSchema.parse(data); }
}

export class SearchCodeGraphRequest extends AuthorizedRequest {
  rules() { return codeGraphSearchSchema; }
  passedValidation(data: unknown): CodeGraphSearchInput { return codeGraphSearchSchema.parse(data); }
}

export class TraverseCodeGraphRequest extends AuthorizedRequest {
  rules() { return codeGraphTraversalSchema; }
  passedValidation(data: unknown): CodeGraphTraversalInput { return codeGraphTraversalSchema.parse(data); }
}

export class OverviewCodeGraphRequest extends AuthorizedRequest {
  rules() { return codeGraphOverviewSchema; }
  passedValidation(data: unknown): CodeGraphOverviewInput { return codeGraphOverviewSchema.parse(data); }
}
