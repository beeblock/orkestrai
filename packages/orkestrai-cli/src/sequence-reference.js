const id = { type: 'string', format: 'uuid' };
/** @param {Record<string, object>} properties @param {string[]} required */
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const time = { type: 'number', minimum: 0, maximum: 600 };
export const SEQUENCE_COMMAND_SCHEMA = object({
  command: { enum: ['list', 'read', 'create', 'apply', 'export', 'cancel', 'remove', 'runtime'] }, nodeId: id, nearNodeId: id,
  floorId: { type: ['string', 'null'], format: 'uuid' }, revision: { type: 'integer', minimum: 1 }, title: { type: 'string', minLength: 1, maxLength: 120 }, idempotencyKey: id,
  operations: { type: 'array', minItems: 1, maxItems: 60, items: { oneOf: [
    object({ type: { const: 'add' }, nodeId: id }, ['type', 'nodeId']),
    object({ type: { const: 'update' }, clipId: id, patch: object({ in: time, out: time, volume: { type: 'number', minimum: 0, maximum: 1 }, caption: { type: 'string', maxLength: 500 } }) }, ['type', 'clipId', 'patch']),
    object({ type: { const: 'move' }, clipId: id, index: { type: 'integer', minimum: 0, maximum: 29 } }, ['type', 'clipId', 'index']),
    object({ type: { const: 'remove' }, clipId: id }, ['type', 'clipId']),
    object({ type: { const: 'settings' }, title: { type: 'string', minLength: 1, maxLength: 120 }, width: { type: 'integer', minimum: 240, maximum: 1920, multipleOf: 2 }, height: { type: 'integer', minimum: 240, maximum: 1920, multipleOf: 2 }, fps: { enum: [24,25,30] } }, ['type']),
  ] } },
}, ['command']);
