const id = { type: 'string', format: 'uuid' };
/** @param {Record<string, object>} properties @param {string[]} required */
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
export const RECIPE_COMMAND_SCHEMA = object({
  command: { enum: ['list', 'read', 'capture', 'instantiate', 'remove', 'queue'] }, id,
  floorId: { type: ['string', 'null'], format: 'uuid' },
  position: object({ x: { type: 'number', minimum: -100000, maximum: 100000 }, y: { type: 'number', minimum: -100000, maximum: 100000 } }, ['x', 'y']),
  capture: object({ name: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 2000 }, sourceNodeId: id, revision: { type: 'integer', minimum: 1 }, previousId: id }, ['name', 'sourceNodeId', 'revision']),
  bindings: object({ script: { type: 'string', maxLength: 12000 }, aspectRatio: { enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] }, executorNodeId: { type: ['string', 'null'], format: 'uuid' }, values: { type: 'array', maxItems: 100, items: object({ key: { type: 'string', maxLength: 60 }, id }, ['key', 'id']) } }),
}, ['command']);
