export const FAL_ENDPOINT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/;
export type ModelSchema = {
  type?: string | string[]; properties?: Record<string, ModelSchema>; required?: string[];
  items?: ModelSchema; enum?: unknown[]; default?: unknown; const?: unknown;
  anyOf?: ModelSchema[]; oneOf?: ModelSchema[]; allOf?: ModelSchema[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; [key: string]: unknown;
};
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

export function modelMediaSlots(schema: ModelSchema, used: string[] = [], prefix = '', depth = 0): string[] {
  if (depth > 6) return [];
  const spec = concreteSchema(schema);
  const branches = spec.anyOf ?? spec.oneOf;
  if (branches) return [...new Set(branches.flatMap(branch => modelMediaSlots(branch, used, prefix, depth + 1)))].slice(0, 150);
  if (spec.type === 'array' && spec.items) {
    const count = Math.min(spec.maxItems ?? 50, used.filter(path => path.startsWith(`${prefix}/`)).length + 1, 50);
    return Array.from({ length: count }, (_, index) => modelMediaSlots(spec.items!, used, `${prefix}/${index}`, depth + 1)).flat();
  }
  if (spec.type === 'object' || spec.properties) return Object.entries(spec.properties ?? {}).flatMap(([key, value]) => modelMediaSlots(value, used, `${prefix}/${key}`, depth + 1)).slice(0, 150);
  return spec.type === 'string' && /(?:image|video|audio|mask|reference|file|frame).*url/i.test(prefix) ? [prefix] : [];
}
