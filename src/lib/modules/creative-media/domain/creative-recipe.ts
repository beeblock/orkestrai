import type { CreativeRecipeDefinition } from '../contracts/schemas/creative-recipe.schema.js';
export type CreativeRecipe = {
  id: string; workspaceId: string; familyId: string; version: number;
  name: string; description: string; definition: CreativeRecipeDefinition;
  digest: string; createdAt: string;
};
export type CreativeRecipeLibraryItem = CreativeRecipe & { workspaceName: string };
export type CreativeQueueItem = {
  nodeId: string; title: string; kind: 'image' | 'video'; status: string;
  runId: string | null; errorCode: string | null; queuePosition: number | null;
  reservedCents: number | null; outputs: Array<{ nodeId: string; title: string }>;
  canCancel: boolean; canRetryDownload: boolean;
};
