import { describe, expect, it } from 'vitest';
import { designDocumentSchema, designElementSchema } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { designInspectBindings, designInspectCss, designOwningComponent } from '$lib/modules/agent-room/domain/design-inspect.js';

const pageId = '00000000-0000-7000-8000-000000000001';
const elementId = '00000000-0000-7000-8000-000000000002';
const modeId = '00000000-0000-7000-8000-000000000003';
const collectionId = '00000000-0000-7000-8000-000000000004';
const variableId = '00000000-0000-7000-8000-000000000005';
const componentId = '00000000-0000-7000-8000-000000000006';

const element = designElementSchema.parse({
  id: elementId,
  pageId,
  parentId: null,
  type: 'frame',
  name: 'Card',
  x: 12,
  y: 24,
  width: 320,
  height: 180,
  fill: '#ffffff',
  stroke: '#111111',
  strokeWidth: 1,
  cornerRadius: 12,
  layoutMode: 'horizontal',
  layoutGap: 16,
  variableBindings: { fill: variableId },
  componentId,
  order: 0,
});

const document = designDocumentSchema.parse({
  schemaVersion: 1,
  id: '00000000-0000-7000-8000-000000000010',
  nodeId: '00000000-0000-7000-8000-000000000011',
  workspaceId: '00000000-0000-7000-8000-000000000012',
  name: 'Inspect test',
  revision: 1,
  activePageId: pageId,
  pages: [{ id: pageId, name: 'Page', width: 1440, height: 1024, order: 0 }],
  elements: [element],
  variableCollections: [{ id: collectionId, name: 'Brand', modes: [{ id: modeId, name: 'Light' }], defaultModeId: modeId, order: 0 }],
  variables: [{ id: variableId, collectionId, name: 'Surface/card', type: 'color', values: { [modeId]: { kind: 'color', value: '#ffffff' } }, order: 0 }],
  components: [{ id: componentId, name: 'Card', rootElementId: elementId, key: 'card', updatedAt: '2026-09-05T00:00:00.000Z' }],
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
});

describe('design inspect contract', () => {
  it('creates deterministic CSS from the same native element', () => {
    expect(designInspectCss(element)).toContain('width: 320px;');
    expect(designInspectCss(element)).toContain('display: flex;');
    expect(designInspectCss(element)).toContain('gap: 16px;');
  });

  it('normalizes short and existing-alpha colors before applying paint opacity', () => {
    const translucent = designElementSchema.parse({
      ...element,
      fills: [{ type: 'solid', color: '#3698', opacity: 0.5, visible: true }],
      variableBindings: {},
    });

    expect(designInspectCss(translucent)).toContain('background: #33669944;');
  });

  it('resolves token bindings and the owning component', () => {
    expect(designInspectBindings(document, element)).toEqual([{ property: 'fill', variableId, variableName: 'Surface/card', resolvedValue: '#ffffff' }]);
    expect(designOwningComponent(document, element)?.id).toBe(componentId);
  });
});
