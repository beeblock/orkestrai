import { FormRequest } from '@beeblock/svelar/forms';
import { z } from 'zod';
import {
  codeGraphIndexSchema,
  codeGraphSearchSchema,
  codeGraphTraversalSchema,
  codeGraphOverviewSchema,
  codeGraphChangeSchema,
  codeGraphHandoffSchema,
  codeGraphContractSchema,
  codeGraphQualitySchema,
  codeGraphSemanticSearchSchema,
  codeGraphSemanticActionSchema,
  codeGraphEvidenceImportSchema,
  codeGraphEvidenceSnapshotSchema,
  codeGraphContextSchema,
  codeGraphLocateSchema,
  codeGraphRevisionsSchema,
  codeGraphCompareSchema,
  codeGraphInvestigationCreateSchema,
  codeGraphInvestigationUpdateSchema,
  type CodeGraphIndexInput,
  type CodeGraphSearchInput,
  type CodeGraphTraversalInput,
  type CodeGraphOverviewInput,
  type CodeGraphChangeInput,
  type CodeGraphHandoffInput,
  type CodeGraphContractInput,
  type CodeGraphQualityInput,
  type CodeGraphSemanticSearchInput,
  type CodeGraphSemanticActionInput,
  type CodeGraphEvidenceImportInput,
  type CodeGraphEvidenceSnapshotInput,
  type CodeGraphContextInput,
  type CodeGraphLocateInput,
  type CodeGraphRevisionsInput,
  type CodeGraphCompareInput,
  type CodeGraphInvestigationCreateInput,
  type CodeGraphInvestigationUpdateInput,
} from '../../../contracts/schemas/codeGraphSchemas.js';

abstract class AuthorizedRequest extends FormRequest {
  authorize(): boolean {
    return true;
  }
}

function withoutRouteParams<T extends z.ZodType>(schema: T, routeParams: string[] = ['id']) {
  return z.preprocess((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const input = { ...(value as Record<string, unknown>) };
    for (const routeParam of routeParams) delete input[routeParam];
    return input;
  }, schema);
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

export class ChangeCodeGraphRequest extends AuthorizedRequest {
  rules() { return codeGraphChangeSchema; }
  passedValidation(data: unknown): CodeGraphChangeInput { return codeGraphChangeSchema.parse(data); }
}

export class CodeGraphHandoffRequest extends AuthorizedRequest {
  rules() { return withoutRouteParams(codeGraphHandoffSchema); }
  passedValidation(data: unknown): CodeGraphHandoffInput { return codeGraphHandoffSchema.parse(data); }
}

export class CodeGraphContractRequest extends AuthorizedRequest {
  rules() { return codeGraphContractSchema; }
  passedValidation(data: unknown): CodeGraphContractInput { return codeGraphContractSchema.parse(data); }
}

export class CodeGraphQualityRequest extends AuthorizedRequest {
  rules() { return codeGraphQualitySchema; }
  passedValidation(data: unknown): CodeGraphQualityInput { return codeGraphQualitySchema.parse(data); }
}

export class CodeGraphSemanticSearchRequest extends AuthorizedRequest {
  rules() { return codeGraphSemanticSearchSchema; }
  passedValidation(data: unknown): CodeGraphSemanticSearchInput { return codeGraphSemanticSearchSchema.parse(data); }
}

export class CodeGraphSemanticActionRequest extends AuthorizedRequest {
  rules() { return codeGraphSemanticActionSchema; }
  passedValidation(data: unknown): CodeGraphSemanticActionInput { return codeGraphSemanticActionSchema.parse(data); }
}

export class CodeGraphEvidenceImportRequest extends AuthorizedRequest {
  rules() { return codeGraphEvidenceImportSchema; }
  passedValidation(data: unknown): CodeGraphEvidenceImportInput { return codeGraphEvidenceImportSchema.parse(data); }
}

export class CodeGraphEvidenceSnapshotRequest extends AuthorizedRequest {
  rules() { return codeGraphEvidenceSnapshotSchema; }
  passedValidation(data: unknown): CodeGraphEvidenceSnapshotInput { return codeGraphEvidenceSnapshotSchema.parse(data); }
}

export class CodeGraphContextRequest extends AuthorizedRequest {
  rules() { return withoutRouteParams(codeGraphContextSchema); }
  passedValidation(data: unknown): CodeGraphContextInput { return codeGraphContextSchema.parse(data); }
}

export class CodeGraphLocateRequest extends AuthorizedRequest {
  rules() { return codeGraphLocateSchema; }
  passedValidation(data: unknown): CodeGraphLocateInput { return codeGraphLocateSchema.parse(data); }
}

export class CodeGraphRevisionsRequest extends AuthorizedRequest {
  rules() { return codeGraphRevisionsSchema; }
  passedValidation(data: unknown): CodeGraphRevisionsInput { return codeGraphRevisionsSchema.parse(data); }
}

export class CodeGraphCompareRequest extends AuthorizedRequest {
  rules() { return codeGraphCompareSchema; }
  passedValidation(data: unknown): CodeGraphCompareInput { return codeGraphCompareSchema.parse(data); }
}

export class CodeGraphInvestigationCreateRequest extends AuthorizedRequest {
  rules() { return withoutRouteParams(codeGraphInvestigationCreateSchema); }
  passedValidation(data: unknown): CodeGraphInvestigationCreateInput { return codeGraphInvestigationCreateSchema.parse(data); }
}

export class CodeGraphInvestigationUpdateRequest extends AuthorizedRequest {
  rules() { return withoutRouteParams(codeGraphInvestigationUpdateSchema, ['id', 'investigationId']); }
  passedValidation(data: unknown): CodeGraphInvestigationUpdateInput { return codeGraphInvestigationUpdateSchema.parse(data); }
}
