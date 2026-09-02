import { z } from 'zod';

export const workspaceRepositoryRootSchema = z.object({
  alias: z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/),
  path: z.string().trim().min(1).max(4_000),
});

export const workspaceRepositoryRootsSchema = z.array(workspaceRepositoryRootSchema).max(16).superRefine((roots, context) => {
  const aliases = new Set<string>();
  for (const [index, root] of roots.entries()) {
    if (aliases.has(root.alias)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'alias'], message: 'Repository aliases must be unique.' });
    }
    aliases.add(root.alias);
  }
});

export const codeIntelligenceModeSchema = z.enum(['assisted', 'manual', 'disabled']);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do workspace.'),
  workingDir: z.string().trim().min(1, 'Informe o diretorio de trabalho.'),
  icon: z.string().trim().nullish(),
  instructions: z.string().nullish(),
  runtimeKind: z.enum(['native', 'wsl']).default('native'),
  wslDistribution: z.string().trim().nullish(),
  wslWorkingDir: z.string().trim().nullish(),
  repositoryRoots: workspaceRepositoryRootsSchema.default([]),
  codeIntelligenceMode: codeIntelligenceModeSchema.default('assisted'),
  groupId: z.string().trim().uuid().nullish(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).optional(),
  workingDir: z.string().trim().min(1).optional(),
  icon: z.string().trim().nullish(),
  instructions: z.string().nullish(),
  syncAgentInstructionFiles: z.boolean().optional(),
  runtimeKind: z.enum(['native', 'wsl']).optional(),
  wslDistribution: z.string().trim().nullish(),
  wslWorkingDir: z.string().trim().nullish(),
  repositoryRoots: workspaceRepositoryRootsSchema.optional(),
  codeIntelligenceMode: codeIntelligenceModeSchema.optional(),
});

export const canvasNodeTypeSchema = z.enum(['terminal', 'note', 'fileTree', 'editor', 'diff', 'portal', 'apiClient', 'loop', 'group', 'shape', 'tasks', 'flow', 'image', 'imageWorkflow', 'usage', 'codeGraph', 'device', 'design']);

export const createCanvasNodeSchema = z.object({
  type: canvasNodeTypeSchema,
  title: z.string().trim().nullish(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
  width: z.coerce.number().positive().optional(),
  height: z.coerce.number().positive().optional(),
  zIndex: z.coerce.number().int().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const updateCanvasNodeSchema = z.object({
  type: canvasNodeTypeSchema.optional(),
  title: z.string().trim().nullish(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
  width: z.coerce.number().positive().optional(),
  height: z.coerce.number().positive().optional(),
  zIndex: z.coerce.number().int().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const changeTerminalProviderSchema = z.object({
  provider: z.string().trim().min(1, 'Informe o provider.'),
  profileId: z.string().trim().nullish(),
});

export const changeTerminalRuntimeSchema = z.object({
  mode: z.enum(['default', 'native', 'wsl']),
  wslDistribution: z.string().trim().nullish(),
  wslWorkingDir: z.string().trim().nullish(),
});

export const discoverRolesSchema = z.object({
  fromDir: z.string().trim().min(1).max(4_000).optional(),
});

export const canvasEdgeStyleSchema = z.enum(['cord', 'circuit']);

export const createCanvasEdgeSchema = z.object({
  sourceNodeId: z.string().trim().min(1, 'Informe o no de origem.'),
  targetNodeId: z.string().trim().min(1, 'Informe o no de destino.'),
  style: canvasEdgeStyleSchema.default('cord'),
});

export const updateCanvasEdgeSchema = z.object({
  style: canvasEdgeStyleSchema,
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type CreateCanvasNodeInput = z.infer<typeof createCanvasNodeSchema>;
export type UpdateCanvasNodeInput = z.infer<typeof updateCanvasNodeSchema>;
export type ChangeTerminalProviderInput = z.infer<typeof changeTerminalProviderSchema>;
export type ChangeTerminalRuntimeInput = z.infer<typeof changeTerminalRuntimeSchema>;
export type DiscoverRolesInput = z.infer<typeof discoverRolesSchema>;
export type CreateCanvasEdgeInput = z.infer<typeof createCanvasEdgeSchema>;
export type UpdateCanvasEdgeInput = z.infer<typeof updateCanvasEdgeSchema>;
