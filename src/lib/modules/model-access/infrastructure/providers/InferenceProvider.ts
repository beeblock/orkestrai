import type { InferenceRequest, InferenceToolResult, ModelAccessOffering } from '../../contracts/schemas/model-access.schema.js';
export type InferenceProviderRun = {
  request: InferenceRequest; offering: ModelAccessOffering; signal: AbortSignal;
  emit: (event: 'text' | 'reasoning' | 'status', text: string) => Promise<void>;
  reserveImage: (id: string) => Promise<void>;
  finishImage: (id: string, state: 'completed' | 'failed' | 'unconfirmed') => Promise<void>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<InferenceToolResult>;
};
export interface InferenceProvider { run(input: InferenceProviderRun): Promise<void>; }
