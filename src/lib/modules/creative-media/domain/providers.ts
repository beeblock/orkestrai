export const CREATIVE_PROVIDER_IDS = ['fal', 'byteplus', 'higgsfield'] as const;
export type CreativeProviderId = typeof CREATIVE_PROVIDER_IDS[number];

export const CREATIVE_PROVIDERS = [
  { id: 'fal', name: 'fal.ai', url: 'https://fal.ai/dashboard/keys' },
  { id: 'byteplus', name: 'BytePlus ModelArk', url: 'https://console.byteplus.com/ark' },
  { id: 'higgsfield', name: 'Higgsfield', url: 'https://console.higgsfield.ai' },
] as const;

export function creativeProviderId(value: unknown): CreativeProviderId {
  // Persisted workflows and runs created before provider selection belong to fal.
  if (value === undefined) return 'fal';
  if (CREATIVE_PROVIDER_IDS.includes(value as CreativeProviderId)) return value as CreativeProviderId;
  throw new Error('creative_provider_invalid');
}

export function creativeSubmitUrl(provider: CreativeProviderId, endpoint: string): string {
  if (provider === 'byteplus') return 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';
  return `${provider === 'higgsfield' ? 'https://api.higgsfield.ai' : 'https://queue.fal.run'}/${endpoint}`;
}
