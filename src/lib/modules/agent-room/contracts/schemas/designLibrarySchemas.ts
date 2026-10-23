import { z } from 'zod/v3';
import {
  designAssetSchema,
  designComponentSchema,
  designComponentSetSchema,
  designElementSchema,
  designVariableCollectionSchema,
  designVariableSchema,
} from './designSchemas.js';

export const designLibrarySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1_000).default(''),
  sourceWorkspaceId: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  sourceRevision: z.number().int().min(0),
  allowedWorkspaceIds: z.array(z.string().uuid()).max(500).default([]),
  variableCollections: z.array(designVariableCollectionSchema).max(100),
  variables: z.array(designVariableSchema).max(5_000),
  componentSets: z.array(designComponentSetSchema).max(500),
  components: z.array(designComponentSchema).max(2_000),
  elements: z.array(designElementSchema).max(25_000),
  assets: z.array(designAssetSchema).max(5_000),
  publishedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const publishDesignLibrarySchema = z.object({
  libraryId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1_000).default(''),
  allowedWorkspaceIds: z.array(z.string().uuid()).max(500).default([]),
});

export const importDesignLibrarySchema = z.object({
  baseRevision: z.number().int().min(0),
});

export type DesignLibrary = z.infer<typeof designLibrarySchema>;
export type PublishDesignLibraryInput = z.infer<typeof publishDesignLibrarySchema>;
export type ImportDesignLibraryInput = z.infer<typeof importDesignLibrarySchema>;
