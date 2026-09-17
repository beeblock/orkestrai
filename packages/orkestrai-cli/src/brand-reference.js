const id = { type: 'string', format: 'uuid' };
/** @param {Record<string, object>} properties @param {string[]} required */
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
export const BRAND_COMMAND_SCHEMA = object({
  command: { enum: ['list', 'read', 'create', 'update', 'fork', 'place', 'remove'] }, id,
  revision: { type: 'integer', minimum: 1 }, floorId: { type: ['string', 'null'], format: 'uuid' },
  position: object({ x: { type: 'number', minimum: -100000, maximum: 100000 }, y: { type: 'number', minimum: -100000, maximum: 100000 } }, ['x', 'y']),
  definition: object({ name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 4000 }, tone: { type: 'string', maxLength: 4000 }, rules: { type: 'string', maxLength: 12000 },
    colors: { type: 'array', maxItems: 24, items: object({ name: { type: 'string', minLength: 1, maxLength: 60 }, value: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }, ['name', 'value']) },
    assets: { type: 'array', maxItems: 20, items: object({ label: { type: 'string', minLength: 1, maxLength: 100 }, kind: { enum: ['logo', 'product', 'style'] }, path: { type: 'string', minLength: 1, maxLength: 500, description: 'Confined workspace-relative PNG, JPEG or WebP path. Never a credential or URL.' } }, ['label', 'kind', 'path']) },
  }, ['name']),
}, ['command']);
