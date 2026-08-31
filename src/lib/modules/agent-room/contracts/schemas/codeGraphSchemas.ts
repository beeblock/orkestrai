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

export type CodeGraphIndexInput = z.infer<typeof codeGraphIndexSchema>;
export type CodeGraphSearchInput = z.infer<typeof codeGraphSearchSchema>;
export type CodeGraphTraversalInput = z.infer<typeof codeGraphTraversalSchema>;
export type CodeGraphOverviewInput = z.infer<typeof codeGraphOverviewSchema>;
