import { z } from 'zod';

export const applyPresetSchema = z.object({
  workspaceId: z.string().trim().optional(),
  name: z.string().trim().optional(),
  workingDir: z.string().trim().optional(),
  runtimeKind: z.enum(['native', 'wsl']).optional(),
  wslDistribution: z.string().trim().nullish(),
  wslWorkingDir: z.string().trim().nullish(),
  groupId: z.string().trim().uuid().nullish(),
  locale: z.enum(['pt-BR', 'en', 'es']).optional(),
});

export type ApplyPresetInput = z.infer<typeof applyPresetSchema>;
