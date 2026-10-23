import { z } from 'zod/v3';

const figmaUrlSchema = z.string().trim().url().max(2_000).refine((value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'figma.com' || host === 'www.figma.com';
  } catch {
    return false;
  }
}, 'Use a figma.com file, design, or prototype URL.');

const figmaNodeIdSchema = z.string().trim().regex(/^\d+[:;-]\d+(?:[:;-]\d+)*$/).max(240);

export const inspectDesignFigmaSchema = z.object({
  url: figmaUrlSchema,
});

export const importDesignFigmaSchema = z.object({
  url: figmaUrlSchema,
  sourceNodeIds: z.array(figmaNodeIdSchema).min(1).max(100),
  baseRevision: z.number().int().min(0),
  targetPageId: z.string().uuid(),
});

export const previewDesignFigmaSyncSchema = z.object({
  linkId: z.string().uuid(),
});

export const applyDesignFigmaSyncSchema = z.object({
  linkId: z.string().uuid(),
  baseRevision: z.number().int().min(0),
  changes: z.array(z.object({
    nodeId: figmaNodeIdSchema,
    resolution: z.enum(['figma', 'local', 'delete']),
  })).max(2_000),
});

export const disconnectDesignFigmaSchema = z.object({
  linkId: z.string().uuid(),
  baseRevision: z.number().int().min(0),
});

export const acknowledgeDesignFigmaPushSchema = z.object({
  linkId: z.string().uuid(),
  baseRevision: z.number().int().min(0),
  nodeIds: z.array(figmaNodeIdSchema).min(1).max(2_000),
});

export type InspectDesignFigmaInput = z.infer<typeof inspectDesignFigmaSchema>;
export type ImportDesignFigmaInput = z.infer<typeof importDesignFigmaSchema>;
export type PreviewDesignFigmaSyncInput = z.infer<typeof previewDesignFigmaSyncSchema>;
export type ApplyDesignFigmaSyncInput = z.infer<typeof applyDesignFigmaSyncSchema>;
export type DisconnectDesignFigmaInput = z.infer<typeof disconnectDesignFigmaSchema>;
export type AcknowledgeDesignFigmaPushInput = z.infer<typeof acknowledgeDesignFigmaPushSchema>;
