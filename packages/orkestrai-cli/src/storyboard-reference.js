import { SHOT_DIRECTION_SCHEMA } from './video-reference.js';
const id = { type: 'string', format: 'uuid' };
const content = {
  title: { type: 'string', minLength: 1, maxLength: 120 },
  direction: { type: 'string', maxLength: 16000 }, dialogue: { type: 'string', maxLength: 8000 },
  language: { type: 'string', minLength: 2, maxLength: 35 }, duration: { type: 'number', minimum: 1, maximum: 120 },
  characterIds: { type: 'array', uniqueItems: true, maxItems: 8, items: id },
  referenceNodeIds: { type: 'array', uniqueItems: true, maxItems: 20, items: id },
  executorNodeId: { type: ['string', 'null'], format: 'uuid' },
  shot: SHOT_DIRECTION_SCHEMA,
  aspectRatio: { enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
};
/** @template {Record<string, object>} T @param {T} properties @param {string[]} required */
const object = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
export const STORYBOARD_COMMAND_SCHEMA = object({
  command: { type: 'string', enum: ['list', 'read', 'create', 'apply', 'materialize', 'remove'] },
  nodeId: id, revision: { type: 'integer', minimum: 1 }, title: content.title,
  nearNodeId: id, floorId: { type: ['string', 'null'], format: 'uuid' },
  position: object({ x: { type: 'number', minimum: -100000, maximum: 100000 }, y: { type: 'number', minimum: -100000, maximum: 100000 } }, ['x', 'y']),
  sceneId: id, kind: { enum: ['image', 'video'] },
  operations: { type: 'array', minItems: 1, maxItems: 100, items: { oneOf: [
    object({ type: { const: 'add' }, scene: object({ id, ...content }, ['title']), beforeId: { type: ['string', 'null'], format: 'uuid' } }, ['type', 'scene']),
    object({ type: { const: 'update' }, id, patch: object(content, []) }, ['type', 'id', 'patch']),
    object({ type: { const: 'remove' }, id }, ['type', 'id']),
    object({ type: { const: 'duplicate' }, id, newId: id }, ['type', 'id']),
    object({ type: { const: 'move' }, id, beforeId: { type: ['string', 'null'], format: 'uuid' } }, ['type', 'id', 'beforeId']),
    object({ type: { const: 'rename' }, title: content.title }, ['type', 'title']),
    object({ type: { const: 'link' }, id, kind: { enum: ['image', 'video'] }, nodeId: { type: ['string', 'null'], format: 'uuid' } }, ['type', 'id', 'kind', 'nodeId']),
  ] } },
}, ['command']);
