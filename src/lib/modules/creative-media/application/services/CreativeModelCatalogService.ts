import { createHash } from 'node:crypto';
import { falModelCatalog, normalizeSchema } from './FalModelCatalogService.js';
import { CreativeMediaError } from '../../domain/types.js';
import { creativeProviderId, type CreativeProviderId } from '../../domain/providers.js';
import { BYTEPLUS_MODELS, byteplusSchema } from '../../domain/byteplus-models.js';
import type { FalModelContract, FalModelSummary, ModelSchema } from '../../domain/model-contract.js';
import higgsfield from '../../domain/higgsfield-video-contracts.json';

const outputSchema: ModelSchema = { type: 'object', properties: { video: { type: 'object', properties: { url: { type: 'string' } } } } };
const bundled: Record<Exclude<CreativeProviderId, 'fal'>, FalModelContract[]> = {
  byteplus: BYTEPLUS_MODELS.map(model => contract({ id: model.id, name: model.name, category: 'reference-to-video', status: 'active', documentationUrl: 'https://docs.byteplus.com/en/docs/ModelArk/1520757' }, byteplusSchema(model))),
  higgsfield: higgsfield.models.map(model => contract({ id: model.id, name: model.name, category: model.category, status: 'active', documentationUrl: model.documentationUrl }, normalizeSchema(model.schema, {}))),
};
function contract(summary: FalModelSummary, schema: ModelSchema): FalModelContract {
  return { ...summary, schema, outputSchema, digest: createHash('sha256').update(JSON.stringify({ id: summary.id, schema, outputSchema })).digest('hex') };
}
export class CreativeModelCatalogService {
  async contract(id: string, provider: CreativeProviderId = 'fal'): Promise<FalModelContract> {
    const key = creativeProviderId(provider);
    if (key === 'fal') return falModelCatalog.contract(id);
    const found = bundled[key].find(model => model.id === id);
    if (!found) throw new CreativeMediaError('creative_model_not_found', 404);
    return structuredClone(found);
  }
  async discover(provider: CreativeProviderId = 'fal', refresh = false) {
    const key = creativeProviderId(provider);
    if (key === 'fal') {
      if (refresh) await falModelCatalog.list(true);
      return falModelCatalog.discover();
    }
    return { models: bundled[key].map(({ schema, outputSchema, digest, ...summary }) => summary), source: 'reviewed', fetchedAt: key === 'higgsfield' ? higgsfield.fetchedAt : '2026-09-20T00:00:00.000Z' };
  }
}
export const creativeModelCatalog = new CreativeModelCatalogService();
