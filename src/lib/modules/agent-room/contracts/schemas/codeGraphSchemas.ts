import { z } from 'zod';
import { CODE_GRAPH_CONTEXT_PURPOSES, CODE_GRAPH_EDGE_KINDS, CODE_GRAPH_EVIDENCE_KINDS, CODE_GRAPH_SYMBOL_KINDS } from '../../domain/code-graph.js';

export const codeGraphIndexSchema = z.object({
  projectIds: z.array(z.string().uuid()).max(16).optional(),
  force: z.boolean().optional().default(false),
});

export const codeGraphSearchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  projectId: z.string().uuid().optional(),
  kinds: z.preprocess(
    (value) => typeof value === 'string' ? value.split(',').filter(Boolean) : value,
    z.array(z.enum(CODE_GRAPH_SYMBOL_KINDS)).max(CODE_GRAPH_SYMBOL_KINDS.length).optional(),
  ),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const codeGraphTraversalSchema = z.object({
  direction: z.enum(['incoming', 'outgoing', 'both']).default('both'),
  kinds: z.preprocess(
    (value) => typeof value === 'string' ? value.split(',').filter(Boolean) : value,
    z.array(z.enum(CODE_GRAPH_EDGE_KINDS)).max(CODE_GRAPH_EDGE_KINDS.length).optional(),
  ),
  depth: z.coerce.number().int().min(1).max(4).default(2),
  limit: z.coerce.number().int().min(10).max(750).default(250),
});

export const codeGraphOverviewSchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(20).max(400).default(220),
});

export const codeGraphChangeSchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(2),
  limit: z.coerce.number().int().min(50).max(750).default(500),
});

export const codeGraphContextSelectionSchema = z.object({
  symbolIds: z.array(z.string().uuid()).max(24).optional(),
  scopeId: z.string().trim().regex(/^(?:workspace|floor:[0-9a-f-]{36})$/i).optional(),
  findingId: z.string().trim().min(1).max(160).optional(),
}).strict().refine((value) => Boolean(value.symbolIds?.length || value.scopeId || value.findingId), {
  message: 'Select at least one symbol, change scope, or quality finding.',
});

export const codeGraphContextSchema = z.object({
  selection: codeGraphContextSelectionSchema,
  purpose: z.enum(CODE_GRAPH_CONTEXT_PURPOSES).default('investigate'),
  maxTokens: z.coerce.number().int().min(500).max(16_000).default(4_000),
  depth: z.coerce.number().int().min(1).max(3).default(2),
  includeSource: z.boolean().default(true),
}).strict();

export const codeGraphHandoffSchema = z.object({
  kind: z.enum(['review', 'task', 'leader', 'agent', 'council']),
  scopeId: z.string().trim().regex(/^(?:workspace|floor:[0-9a-f-]{36})$/i).optional(),
  title: z.string().trim().min(1).max(160),
  locale: z.enum(['pt-BR', 'en', 'es']).default('en'),
  context: codeGraphContextSchema.optional(),
  targetNodeId: z.string().uuid().optional(),
  targetNodeIds: z.array(z.string().uuid()).min(2).max(5).optional(),
}).strict().superRefine((value, context) => {
  if (['review', 'task'].includes(value.kind) && !value.scopeId && !value.context) {
    context.addIssue({ code: 'custom', path: ['scopeId'], message: 'Select a change scope or a code context.' });
  }
  if (value.kind === 'review' && !value.scopeId) {
    context.addIssue({ code: 'custom', path: ['scopeId'], message: 'Reviews require a primary Git change scope.' });
  }
  if (['leader', 'agent', 'council'].includes(value.kind) && !value.context) {
    context.addIssue({ code: 'custom', path: ['context'], message: 'Select code context for this handoff.' });
  }
  if (value.kind === 'agent' && !value.targetNodeId) {
    context.addIssue({ code: 'custom', path: ['targetNodeId'], message: 'Select the target agent.' });
  }
  if (value.kind === 'council' && !value.targetNodeIds) {
    context.addIssue({ code: 'custom', path: ['targetNodeIds'], message: 'Select at least two council agents.' });
  }
});

export const codeGraphLocateSchema = z.object({
  path: z.string().trim().min(1).max(1_024),
  line: z.coerce.number().int().min(1).max(10_000_000),
});

export const codeGraphRevisionsSchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(30),
});

export const codeGraphCompareSchema = z.object({
  projectId: z.string().uuid(),
  from: z.string().uuid().optional(),
  to: z.string().uuid().optional(),
});

const codeGraphVisibleIdSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/);

export const codeGraphInvestigationStateSchema = z.object({
  projectId: z.string().uuid().nullable(),
  viewMode: z.enum(['overview', 'changes', 'contracts', 'quality', 'semantic', 'runtime', 'operations', 'compare']),
  query: z.string().max(120),
  searchMode: z.enum(['lexical', 'semantic']),
  selectedSymbolIds: z.array(codeGraphVisibleIdSchema).max(24),
  direction: z.enum(['incoming', 'outgoing', 'both']),
  depth: z.number().int().min(1).max(4),
  camera: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    ratio: z.number().finite().positive(),
    angle: z.number().finite(),
  }).strict().nullable(),
  openPath: z.string().max(1_024).nullable(),
}).strict();

export const codeGraphInvestigationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  state: codeGraphInvestigationStateSchema,
}).strict();

export const codeGraphInvestigationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  state: codeGraphInvestigationStateSchema.optional(),
}).strict().refine((value) => value.name !== undefined || value.state !== undefined, {
  message: 'Provide a name or state to update.',
});

export const codeGraphContractSchema = z.object({
  limit: z.coerce.number().int().min(50).max(1_000).default(500),
  includeGraph: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
});

export const codeGraphQualitySchema = z.object({
  limit: z.coerce.number().int().min(50).max(1_000).default(500),
  includeGraph: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
});

export const codeGraphSemanticSearchSchema = codeGraphSearchSchema;

export const codeGraphSemanticActionSchema = z.object({
  action: z.enum(['build', 'clear']),
});

export const codeGraphEvidenceImportSchema = z.object({
  projectId: z.string().uuid(),
  path: z.string().trim().min(1).max(1_024),
  kind: z.enum(['auto', ...CODE_GRAPH_EVIDENCE_KINDS]).default('auto'),
  label: z.string().trim().min(1).max(120).optional(),
});

export const codeGraphEvidenceSnapshotSchema = z.object({
  limit: z.coerce.number().int().min(50).max(5_000).default(2_000),
});

const runtimeLocationSchema = z.object({
  path: z.string().trim().min(1).max(1_024),
  line: z.number().int().min(1).max(10_000_000),
  count: z.number().int().min(1).max(1_000_000).optional(),
}).strict();

export const codeGraphRuntimeDocumentSchema = z.object({
  version: z.literal(1),
  coverage: z.array(runtimeLocationSchema).max(50_000).default([]),
  failures: z.array(runtimeLocationSchema).max(5_000).default([]),
  calls: z.array(z.object({
    from: runtimeLocationSchema.omit({ count: true }),
    to: runtimeLocationSchema.omit({ count: true }),
    count: z.number().int().min(1).max(1_000_000).optional(),
  }).strict()).max(5_000).default([]),
}).strict();

export type CodeGraphIndexInput = z.infer<typeof codeGraphIndexSchema>;
export type CodeGraphSearchInput = z.infer<typeof codeGraphSearchSchema>;
export type CodeGraphTraversalInput = z.infer<typeof codeGraphTraversalSchema>;
export type CodeGraphOverviewInput = z.infer<typeof codeGraphOverviewSchema>;
export type CodeGraphChangeInput = z.infer<typeof codeGraphChangeSchema>;
export type CodeGraphHandoffInput = z.infer<typeof codeGraphHandoffSchema>;
export type CodeGraphContextInput = z.infer<typeof codeGraphContextSchema>;
export type CodeGraphLocateInput = z.infer<typeof codeGraphLocateSchema>;
export type CodeGraphRevisionsInput = z.infer<typeof codeGraphRevisionsSchema>;
export type CodeGraphCompareInput = z.infer<typeof codeGraphCompareSchema>;
export type CodeGraphInvestigationCreateInput = z.infer<typeof codeGraphInvestigationCreateSchema>;
export type CodeGraphInvestigationUpdateInput = z.infer<typeof codeGraphInvestigationUpdateSchema>;
export type CodeGraphContractInput = z.infer<typeof codeGraphContractSchema>;
export type CodeGraphQualityInput = z.infer<typeof codeGraphQualitySchema>;
export type CodeGraphSemanticSearchInput = z.infer<typeof codeGraphSemanticSearchSchema>;
export type CodeGraphSemanticActionInput = z.infer<typeof codeGraphSemanticActionSchema>;
export type CodeGraphEvidenceImportInput = z.infer<typeof codeGraphEvidenceImportSchema>;
export type CodeGraphEvidenceSnapshotInput = z.infer<typeof codeGraphEvidenceSnapshotSchema>;
