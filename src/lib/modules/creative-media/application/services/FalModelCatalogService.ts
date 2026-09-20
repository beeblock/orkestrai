import { createHash } from 'node:crypto';
import { z } from 'zod';
import Ajv, { type ValidateFunction } from 'ajv';
import { TrustedIntegrationHttpClient } from '$lib/modules/agent-room/infrastructure/integrations/TrustedIntegrationHttpClient.js';
import { CreativeMediaError } from '../../domain/types.js';
import { FAL_ENDPOINT_PATTERN, isVideoCategory, type FalModelContract, type FalModelSummary, type ModelSchema } from '../../domain/model-contract.js';
import bundledCatalog from '../../domain/fal-video-catalog.json';

const modelSchema = z.object({ endpoint_id: z.string().max(240).regex(FAL_ENDPOINT_PATTERN), metadata: z.object({ display_name: z.string().min(1).max(200), category: z.string().max(80), status: z.enum(['active', 'deprecated']) }), openapi: z.record(z.unknown()).optional() });
const pageSchema = z.object({ models: z.array(modelSchema).max(100), has_more: z.boolean(), next_cursor: z.string().max(200).nullable() });
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false, ownProperties: true, removeAdditional: false, coerceTypes: false, useDefaults: false });
const validators = new Map<string, ValidateFunction>();
function validatorFor(contract: Pick<FalModelContract, 'digest' | 'schema'>) {
  const cached = validators.get(contract.digest);
  if (cached) return cached;
  const validator = ajv.compile(contract.schema);
  ajv.removeSchema(contract.schema);
  if (validators.size >= 64) validators.delete(validators.keys().next().value!);
  validators.set(contract.digest, validator);
  return validator;
}
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key);
function boundedExamples(value: unknown): unknown[] | undefined {
  // Annotations are provider data, never executable markup or validation enums.
  let nodes = 0;
  const valid = (item: unknown, depth = 0): boolean => {
    if (++nodes > 1000 || depth > 12) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item === 'string') return item.length <= 8000;
    if (Array.isArray(item)) return item.length <= 50 && item.every(child => valid(child, depth + 1));
    return !!item && typeof item === 'object' && Object.entries(item).every(([key, child]) => safeKey(key) && key.length <= 150 && valid(child, depth + 1));
  };
  if (!Array.isArray(value) || value.length > 20 || !valid(value)) return undefined;
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { return undefined; }
  if (!encoded || encoded.length > 16000) return undefined;
  return value;
}

export function normalizeSchema(source: any, document: any, depth = 0, budget = { nodes: 0 }): ModelSchema {
  if (++budget.nodes > 6000 || depth > 24 || !source || typeof source !== 'object' || Array.isArray(source)) throw new CreativeMediaError('creative_model_contract_invalid');
  if (source.$ref) {
    if (typeof source.$ref !== 'string' || !/^#\/components\/schemas\/[a-zA-Z0-9_.-]+$/.test(source.$ref)) throw new CreativeMediaError('creative_model_contract_invalid');
    const resolved = normalizeSchema(document.components?.schemas?.[source.$ref.split('/').pop()], document, depth + 1, budget);
    const { $ref: _ref, ...siblings } = source;
    return { ...resolved, ...normalizeSchema(siblings, document, depth + 1, budget) };
  }
  const result: ModelSchema = {};
  for (const [key, value] of Object.entries(source)) {
    if (!safeKey(key)) throw new CreativeMediaError('creative_model_contract_invalid');
    if (key === 'title' || key === 'description') {
      if (typeof value === 'string') result[key] = value.slice(0, key === 'title' ? 200 : 8000);
    } else if (key === 'examples' || key === 'example') {
      const examples = boundedExamples(key === 'example' ? [value] : value);
      if (examples) result.examples = examples;
    } else if (['properties', 'patternProperties'].includes(key)) {
      if (key === 'patternProperties' || !value || typeof value !== 'object' || Object.keys(value).length > 150) throw new CreativeMediaError('creative_model_contract_invalid');
      result.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => {
        if (!safeKey(name) || name.length > 150) throw new CreativeMediaError('creative_model_contract_invalid');
        return [name, normalizeSchema(child, document, depth + 1, budget)];
      }));
    } else if (['anyOf', 'oneOf', 'allOf'].includes(key)) {
      if (!Array.isArray(value) || value.length > 20) throw new CreativeMediaError('creative_model_contract_invalid');
      result[key] = value.map(child => normalizeSchema(child, document, depth + 1, budget));
    } else if (['items', 'not', 'if', 'then', 'else', 'additionalProperties'].includes(key)) {
      result[key] = typeof value === 'boolean' ? value : normalizeSchema(value, document, depth + 1, budget);
    } else if (['type', 'enum', 'const', 'default', 'required', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties'].includes(key)) result[key] = value;
    else if (key === 'pattern') {
      // Only audited, bounded expressions from the official contracts are compiled.
      if (value !== '\\S' && value !== '^#([0-9A-Fa-f]{3}){1,2}$') throw new CreativeMediaError('creative_model_contract_invalid');
      result.pattern = value;
    }
  }
  if (result.properties && result.additionalProperties === undefined) result.additionalProperties = false;
  if (source.nullable && typeof result.type === 'string') result.type = [result.type, 'null'];
  return result;
}

export function parseFalContract(raw: unknown): FalModelContract {
  const item = modelSchema.parse(raw);
  if (!isVideoCategory(item.metadata.category) || !item.openapi) throw new CreativeMediaError('creative_model_contract_invalid');
  const document = item.openapi as any;
  if (document.error?.code === 'expansion_failed') throw new CreativeMediaError('creative_model_contract_unavailable', 503);
  const alias = document.info?.['x-fal-metadata']?.endpointId;
  const schemaEndpoint = document.paths?.[`/${item.endpoint_id}`]?.post ? item.endpoint_id : alias;
  if (typeof schemaEndpoint !== 'string' || schemaEndpoint.length > 240 || !FAL_ENDPOINT_PATTERN.test(schemaEndpoint)) throw new CreativeMediaError('creative_model_contract_invalid');
  const operation = document.paths?.[`/${schemaEndpoint}`]?.post;
  const output = document.paths?.[`/${schemaEndpoint}/requests/{request_id}`]?.get?.responses?.['200']?.content?.['application/json']?.schema;
  const schema = normalizeSchema(operation?.requestBody?.content?.['application/json']?.schema, document);
  const outputSchema = normalizeSchema(output, document);
  if (schema.type !== 'object') throw new CreativeMediaError('creative_model_contract_invalid');
  const contract = { ...summaryOf(item), schema, outputSchema, digest: createHash('sha256').update(JSON.stringify({ schema, outputSchema })).digest('hex') };
  try { validatorFor(contract); } catch { throw new CreativeMediaError('creative_model_contract_invalid'); }
  return contract;
}
function summaryOf(item: z.infer<typeof modelSchema>): FalModelSummary {
  return { id: item.endpoint_id, name: item.metadata.display_name, category: item.metadata.category, status: item.metadata.status, documentationUrl: `https://fal.ai/models/${item.endpoint_id}/api` };
}
export function validateFalParameters(contract: FalModelContract, input: Record<string, unknown>) {
  if (!validatorFor(contract)(input)) throw new CreativeMediaError('creative_model_parameters_invalid');
}

export class FalModelCatalogService {
  private http: TrustedIntegrationHttpClient;
  private entries = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<any>>();
  private nextRequestAt = 0;
  constructor(fetchFn: typeof fetch = fetch) { this.http = new TrustedIntegrationHttpClient(fetchFn); }
  discover() {
    const cached = this.entries.get('catalog');
    if (!cached || cached.expires <= Date.now()) void this.list().catch(() => undefined);
    return cached
      ? { models: structuredClone(cached.value) as FalModelSummary[], source: 'live', fetchedAt: new Date(cached.expires - 300000).toISOString() }
      : { models: structuredClone(bundledCatalog.models) as FalModelSummary[], source: 'bundled', fetchedAt: bundledCatalog.fetchedAt };
  }
  private async query(params: URLSearchParams): Promise<z.infer<typeof pageSchema>> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const start = Math.max(Date.now(), this.nextRequestAt);
      this.nextRequestAt = start + 1100;
      if (start > Date.now()) await new Promise(resolve => setTimeout(resolve, start - Date.now()));
      try {
        const response = await this.http.request(`https://api.fal.ai/v1/models?${params}`, { signal: AbortSignal.timeout(20000) });
        if (response.status === 429 && attempt < 3) { this.nextRequestAt = Date.now() + 10000 * (attempt + 1); continue; }
        if (response.status === 404 && params.has('endpoint_id')) throw new CreativeMediaError('creative_model_not_found', 404);
        if (!response.ok) throw new Error();
        return pageSchema.parse(response.json);
      } catch (error) { if (error instanceof CreativeMediaError) throw error; throw new CreativeMediaError('creative_catalog_unavailable', 502); }
    }
    throw new CreativeMediaError('creative_catalog_unavailable', 502);
  }
  private async cached<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.entries.get(key);
    if (previous && previous.expires > Date.now()) return structuredClone(previous.value) as T;
    if (this.pending.has(key)) return structuredClone(await this.pending.get(key));
    if (this.pending.size >= 12) throw new CreativeMediaError('creative_catalog_unavailable', 429);
    const promise = operation().then(value => {
      if (this.entries.size >= 100) this.entries.delete([...this.entries.keys()].find(key => key !== 'catalog')!);
      this.entries.set(key, { expires: Date.now() + 300000, value }); return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return structuredClone(await promise);
  }
  list(refresh = false): Promise<FalModelSummary[]> {
    if (refresh) this.entries.delete('catalog');
    return this.cached('catalog', async () => {
      const models = new Map<string, FalModelSummary>();
      const cursors = new Set<string>();
      let cursor = '';
      for (let page = 0; page < 100; page++) {
        const result = await this.query(new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) }));
        for (const item of result.models) if (isVideoCategory(item.metadata.category)) models.set(item.endpoint_id, summaryOf(item));
        if (!result.has_more) return [...models.values()];
        if (!result.next_cursor || cursors.has(result.next_cursor)) break;
        cursor = result.next_cursor; cursors.add(cursor);
      }
      throw new CreativeMediaError('creative_catalog_incomplete', 502);
    });
  }
  async contract(endpoint: string): Promise<FalModelContract> {
    if (endpoint.length > 240 || !FAL_ENDPOINT_PATTERN.test(endpoint)) throw new CreativeMediaError('creative_model_contract_invalid');
    return this.cached(`contract:${endpoint}`, async () => {
      const result = await this.query(new URLSearchParams({ endpoint_id: endpoint, expand: 'openapi-3.0', limit: '1' }));
      const item = result.models.find(item => item.endpoint_id === endpoint);
      if (!item) throw new CreativeMediaError('creative_model_not_found', 404);
      return parseFalContract(item);
    });
  }
  async contracts(endpoints: string[]) {
    if (!endpoints.length || endpoints.length > 10 || endpoints.some(id => id.length > 240 || !FAL_ENDPOINT_PATTERN.test(id))) throw new CreativeMediaError('creative_model_contract_invalid');
    const params = new URLSearchParams({ expand: 'openapi-3.0', limit: '10' });
    for (const id of endpoints) params.append('endpoint_id', id);
    const response = await this.query(params);
    return endpoints.map(id => {
      try {
        const contract = parseFalContract(response.models.find(item => item.endpoint_id === id));
        if (this.entries.size >= 100) this.entries.delete([...this.entries.keys()].find(key => key !== 'catalog')!);
        this.entries.set(`contract:${id}`, { expires: Date.now() + 300000, value: contract });
        return { id, contract };
      } catch (error) { return { id, error: error instanceof CreativeMediaError ? error.code : 'creative_model_contract_invalid' }; }
    });
  }
}
const state = globalThis as typeof globalThis & { __orkestraiFalCatalog?: FalModelCatalogService };
export const falModelCatalog = state.__orkestraiFalCatalog ??= new FalModelCatalogService();
