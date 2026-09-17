import type { CreativeConfig } from '../../contracts/schemas/creative-media.schema.js';
import type { FalModelContract } from '../../domain/model-contract.js';
import type { VideoMime } from '../../domain/video-format.js';

export type CreativeRemoteHandle = {
  requestId: string; statusUrl: string; responseUrl: string; cancelUrl: string;
};
export type CreativeProviderStatus = {
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; queuePosition: number | null;
};
export type CreativeRemoteVideo = {
  url: string; size: number | null; width: number | null; height: number | null; duration: number | null; fps: number | null;
  variants?: CreativeRemoteVideo[];
  mimeType?: VideoMime;
};
export interface CreativeVideoProvider {
  prepareMedia?(credential: string, media: Record<string, string>): Promise<Record<string, string>>;
  estimate(credential: string, config: CreativeConfig, contract?: FalModelContract): Promise<{ estimatedCents: number; reservedCents: number }>;
  submit(credential: string, config: CreativeConfig, prompt: string, references: { start?: string; end?: string; media?: Record<string, string> }, contract?: FalModelContract): Promise<CreativeRemoteHandle>;
  status(credential: string, handle: CreativeRemoteHandle): Promise<CreativeProviderStatus>;
  cancel(credential: string, handle: CreativeRemoteHandle): Promise<'requested' | 'completed' | 'missing'>;
  result(credential: string, handle: CreativeRemoteHandle, contract?: FalModelContract): Promise<CreativeRemoteVideo>;
  download(credential: string, video: CreativeRemoteVideo): Promise<Response>;
}
