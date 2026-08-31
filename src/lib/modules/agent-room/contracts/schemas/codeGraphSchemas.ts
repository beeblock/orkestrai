import { z } from 'zod';
import { CODE_GRAPH_EDGE_KINDS, CODE_GRAPH_SYMBOL_KINDS } from '../../domain/code-graph.js';

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

export const codeGraphHandoffSchema = z.object({
  kind: z.enum(['review', 'task']),
  scopeId: z.string().trim().regex(/^(?:workspace|floor:[0-9a-f-]{36})$/i),
  title: z.string().trim().min(1).max(160),
  locale: z.enum(['pt-BR', 'en', 'es']).default('en'),
});

export const codeGraphContractSchema = z.object({
  limit: z.coerce.number().int().min(50).max(1_000).default(500),
  includeGraph: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
});

export const codeGraphQualitySchema = z.object({
  limit: z.coerce.number().int().min(50).max(1_000).default(500),
  includeGraph: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
});

export type CodeGraphIndexInput = z.infer<typeof codeGraphIndexSchema>;
export type CodeGraphSearchInput = z.infer<typeof codeGraphSearchSchema>;
export type CodeGraphTraversalInput = z.infer<typeof codeGraphTraversalSchema>;
export type CodeGraphOverviewInput = z.infer<typeof codeGraphOverviewSchema>;
export type CodeGraphChangeInput = z.infer<typeof codeGraphChangeSchema>;
export type CodeGraphHandoffInput = z.infer<typeof codeGraphHandoffSchema>;
export type CodeGraphContractInput = z.infer<typeof codeGraphContractSchema>;
export type CodeGraphQualityInput = z.infer<typeof codeGraphQualitySchema>;
