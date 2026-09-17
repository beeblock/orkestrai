import type { CreativeConfig } from '../../contracts/schemas/creative-media.schema.js';

export type CreativeRemoteHandle = {
  requestId: string; statusUrl: string; responseUrl: string; cancelUrl: string;
};
export type CreativeProviderStatus = {
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; queuePosition: number | null;
};
export type CreativeRemoteVideo = {
  url: string; size: number | null; width: number | null; height: number | null; duration: number | null; fps: number | null;
};
export interface CreativeVideoProvider {
  estimate(credential: string, config: CreativeConfig): Promise<{ estimatedCents: number; reservedCents: number }>;
  submit(credential: string, config: CreativeConfig, prompt: string, references: { start?: string; end?: string }): Promise<CreativeRemoteHandle>;
  status(credential: string, handle: CreativeRemoteHandle): Promise<CreativeProviderStatus>;
  cancel(credential: string, handle: CreativeRemoteHandle): Promise<'requested' | 'completed' | 'missing'>;
  result(credential: string, handle: CreativeRemoteHandle): Promise<CreativeRemoteVideo>;
  download(credential: string, video: CreativeRemoteVideo): Promise<Response>;
}
