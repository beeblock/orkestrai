import { z } from 'zod/v3';
import { designVariableTypeSchema } from './designSchemas.js';

export const designCodeTokenCandidateSchema = z.object({
  key: z.string().trim().min(1).max(800),
  name: z.string().trim().min(1).max(240),
  type: designVariableTypeSchema.exclude(['effect']),
  value: z.union([z.string().max(2_000), z.number().finite(), z.boolean()]),
  aliasKey: z.string().trim().min(1).max(800).nullable().default(null),
  path: z.string().trim().min(1).max(512),
  format: z.enum(['css', 'tailwind']),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const designCodeComponentCandidateSchema = z.object({
  key: z.string().trim().min(1).max(700),
  name: z.string().trim().min(1).max(160),
  exportName: z.string().trim().min(1).max(160),
  framework: z.enum(['svelte', 'react', 'vue']),
  path: z.string().trim().min(1).max(512),
  props: z.array(z.string().trim().min(1).max(120)).max(200),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const designCodebaseScanSchema = z.object({
  files: z.array(z.string().max(512)).max(500),
  tokens: z.array(designCodeTokenCandidateSchema).max(10_000),
  components: z.array(designCodeComponentCandidateSchema).max(5_000),
  truncated: z.boolean(),
  scannedAt: z.string().datetime(),
});

export type DesignCodeTokenCandidate = z.infer<typeof designCodeTokenCandidateSchema>;
export type DesignCodeComponentCandidate = z.infer<typeof designCodeComponentCandidateSchema>;
export type DesignCodebaseScan = z.infer<typeof designCodebaseScanSchema>;
