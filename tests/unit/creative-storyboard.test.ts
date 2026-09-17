import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@beeblock/svelar/support';
import { applyStoryboardOperations, transferStoryboard } from '$lib/modules/creative-media/domain/storyboard.js';
import { storyboardDocumentSchema, storyboardSceneContentSchema, creativeStoryboardCommandSchema } from '$lib/modules/creative-media/contracts/schemas/creative-storyboard.schema.js';
import { STORYBOARD_COMMAND_SCHEMA } from '../../packages/orkestrai-cli/src/storyboard-reference.js';

describe('native storyboard operations', () => {
  const a = uuidv7(), b = uuidv7(), c = uuidv7(), reference = uuidv7(), workflow = uuidv7();
  const source = storyboardDocumentSchema.parse({ title: 'Three shots', scenes: [{ id: a, title: 'A', direction: 'First', referenceNodeIds: [reference], imageWorkflowNodeId: workflow, imageBriefHash: 'a'.repeat(64) }, { id: b, title: 'B' }] });
  it('applies ordered mutations without mutating the input', () => {
    const result = applyStoryboardOperations(source, [{ type: 'duplicate', id: a, newId: c }, { type: 'move', id: b, beforeId: a }, { type: 'update', id: c, patch: { dialogue: 'Hello' } }]);
    expect(result.scenes.map(scene => scene.id)).toEqual([b, a, c]);
    expect(result.scenes[2]).toMatchObject({ direction: 'First', dialogue: 'Hello', referenceNodeIds: [reference], imageWorkflowNodeId: null, imageBriefHash: null });
    expect(source.scenes).toHaveLength(2);
  });
  it('rejects missing targets, duplicate IDs, oversized scenes and unknown fields', () => {
    expect(() => applyStoryboardOperations(source, [{ type: 'move', id: a, beforeId: c }])).toThrow('creative_storyboard_scene_missing');
    expect(() => applyStoryboardOperations(source, [{ type: 'duplicate', id: a, newId: b }])).toThrow();
    expect(() => storyboardDocumentSchema.parse({ ...source, scenes: Array.from({ length: 101 }, () => ({ id: uuidv7(), title: 'Shot' })) })).toThrow();
    expect(() => storyboardSceneContentSchema.parse({ title: 'x', characterIds: [reference, reference] })).toThrow();
    expect(() => storyboardSceneContentSchema.parse({ title: 'x', imageWorkflowNodeId: workflow })).toThrow();
    expect(() => creativeStoryboardCommandSchema.parse({ command: 'apply', nodeId: a, operations: [] })).toThrow();
  });
  it('preserves unselected input identities during transfer and remaps selected links only', () => {
    const copied = transferStoryboard(source, new Map([[workflow, c]]));
    expect(copied.scenes[0]).toMatchObject({ referenceNodeIds: [reference], imageWorkflowNodeId: c, imageBriefHash: null });
    expect(transferStoryboard(source, new Map()).scenes[0].imageWorkflowNodeId).toBeNull();
  });
  it('shares all scene fields and operations with the MCP contract', () => {
    const props = STORYBOARD_COMMAND_SCHEMA.properties.operations.items.oneOf;
    expect(props.map((item: { properties: { type: { const: string } } }) => item.properties.type.const)).toEqual(['add', 'update', 'remove', 'duplicate', 'move', 'rename', 'link']);
    expect(Object.keys(props[0].properties.scene.properties).sort()).toEqual(['id', ...Object.keys(storyboardSceneContentSchema.shape)].sort());
  });
});
