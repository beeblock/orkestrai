import type { AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';
import { modelAccessEffortSchema } from '$lib/modules/model-access/contracts/schemas/model-access.schema.js';
import type { ModelAccessOffering } from '$lib/modules/model-access/contracts/schemas/model-access.schema.js';

export type AccessScope = { models: string[] | null; efforts: string[] | null; images: boolean };
export type AccessModel = ModelAccessOffering['availableModels'][number];
const efforts = new Set<string>(modelAccessEffortSchema.options);

/** Reuse the adapter catalog; retain saved selections when a CLI catalog changes. */
export function accessModels(provider: AgentProviderInfo | undefined, saved: AccessModel[] = []): AccessModel[] {
  const seen = new Set<string>();
  return [...(provider?.models ?? []), ...saved].slice(0, 200).flatMap(model => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model.value) || seen.has(model.value)) return [];
    seen.add(model.value);
    return [{ value: model.value, label: String(model.label || model.value).slice(0, 100), efforts: [...new Set(model.efforts ?? provider?.efforts ?? [])].filter(effort => efforts.has(effort)) as AccessModel['efforts'] }];
  }).slice(0, 100);
}

export function accessEfforts(models: AccessModel[], selected: string[] | null): string[] {
  const available = new Set(models.filter(model => selected === null || selected.includes(model.value)).flatMap(model => model.efforts));
  return modelAccessEffortSchema.options.filter(effort => available.has(effort));
}
