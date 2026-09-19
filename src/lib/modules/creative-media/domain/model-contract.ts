export const FAL_ENDPOINT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/;
export type ModelSchema = {
  title?: string; description?: string; examples?: unknown[];
  type?: string | string[]; properties?: Record<string, ModelSchema>; required?: string[];
  items?: ModelSchema; enum?: unknown[]; default?: unknown; const?: unknown;
  anyOf?: ModelSchema[]; oneOf?: ModelSchema[]; allOf?: ModelSchema[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; [key: string]: unknown;
};
export type FalModelPrice = { endpointId: string; unitPrice: number; unit: string; currency: 'USD' };
export type FalModelSummary = { id: string; name: string; category: string; status: 'active' | 'deprecated'; documentationUrl: string };
export type FalModelContract = FalModelSummary & { schema: ModelSchema; outputSchema: ModelSchema; digest: string };
export function concreteSchema(schema: ModelSchema): ModelSchema {
  const branches = (schema.anyOf ?? schema.oneOf)?.filter(value => value.type !== 'null');
  if (branches?.length === 1) {
    const { anyOf: _anyOf, oneOf: _oneOf, ...base } = schema;
    return { ...base, ...concreteSchema(branches[0]) };
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter(type => type !== 'null');
    if (types.length === 1) return { ...schema, type: types[0] };
  }
  // A genuine union stays a JSON field instead of silently dropping options.
  return schema;
}
export function modelDefaults(schema: ModelSchema): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([, value]) => value.default !== undefined && value.default !== null).map(([key, value]) => [key, structuredClone(value.default)]));
}
export function modelPromptField(schema: ModelSchema) {
  return ['prompt', 'text_prompt'].find(key => concreteSchema(schema.properties?.[key] ?? {}).type === 'string');
}
export function isVideoCategory(category: string) {
  return /(?:^|-)to-video$/.test(category) || ['video-editing', 'video-upscaling', 'video-to-video', 'video', 'video-interpolation', 'video-extension', 'video-inpainting', 'video-outpainting'].includes(category);
}

function modelStringSlots(schema: ModelSchema, matches: (path: string) => boolean, used: string[], prefix = '', depth = 0): string[] {
  if (depth > 6) return [];
  const spec = concreteSchema(schema);
  const branches = spec.anyOf ?? spec.oneOf;
  if (branches) return [...new Set(branches.flatMap(branch => modelStringSlots(branch, matches, used, prefix, depth + 1)))].slice(0, 150);
  if (spec.type === 'array' && spec.items) {
    const indices = used.filter(path => path.startsWith(`${prefix}/`)).map(path => path.slice(prefix.length + 1).split('/')[0]).filter(index => /^\d+$/.test(index)).map(Number);
    const count = Math.max(0, Math.min(spec.maxItems ?? 50, Math.max(spec.minItems ?? 0, ...indices.map(index => index + 2), 1), 50));
    return Array.from({ length: count }, (_, index) => modelStringSlots(spec.items!, matches, used, `${prefix}/${index}`, depth + 1)).flat().slice(0, 150);
  }
  if (spec.type === 'object' || spec.properties) return Object.entries(spec.properties ?? {}).flatMap(([key, value]) => modelStringSlots(value, matches, used, `${prefix}/${key}`, depth + 1)).slice(0, 150);
  return spec.type === 'string' && matches(prefix) ? [prefix] : [];
}

export function modelMediaSlots(schema: ModelSchema, used: string[] = [], prefix = '', depth = 0): string[] {
  return modelStringSlots(schema, path => /(?:image|video|audio|voice|mask|reference|file|frame).*url/i.test(path), used, prefix, depth);
}

export function modelVoiceIdSlots(schema: ModelSchema, used: string[] = []): string[] {
  return modelStringSlots(schema, path => /\/voice_ids?(?:\/\d+)?$/.test(path), used);
}
