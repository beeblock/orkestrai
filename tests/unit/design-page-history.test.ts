import { describe, expect, it } from 'vitest';
import { applyDesignOperations } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designDocumentSchema, type DesignComponent, type DesignDocument } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { pageDeleteInverseOperations } from '$lib/components/agent-room/design/design-page-history.js';

const WORKSPACE_ID = '00000000-0000-7000-8000-000000000201';
const NODE_ID = '00000000-0000-7000-8000-000000000202';
const DOCUMENT_ID = '00000000-0000-7000-8000-000000000203';
const SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000204';
const INSTANCE_PAGE_ID = '00000000-0000-7000-8000-000000000205';
const ROOT_ID = '00000000-0000-7000-8000-000000000206';
const TEXT_ID = '00000000-0000-7000-8000-000000000207';
const COMPONENT_ID = '00000000-0000-7000-8000-000000000208';
const PROPERTY_ID = '00000000-0000-7000-8000-000000000209';
const INSTANCE_ID = '00000000-0000-7000-8000-000000000210';
const ARTIFACT_ID = '00000000-0000-7000-8000-000000000211';
const NOW = '2026-09-05T16:00:00.000Z';

function baseDocument(): DesignDocument {
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: DOCUMENT_ID,
    nodeId: NODE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Undo pages',
    revision: 0,
    activePageId: SOURCE_PAGE_ID,
    pages: [
      { id: SOURCE_PAGE_ID, name: 'Components', width: 1440, height: 1024, background: '#ffffff', order: 0 },
      { id: INSTANCE_PAGE_ID, name: 'Screens', width: 1440, height: 1024, background: '#ffffff', order: 1 },
    ],
    elements: [
      { id: ROOT_ID, pageId: SOURCE_PAGE_ID, parentId: null, type: 'frame', name: 'Button', x: 0, y: 0, width: 180, height: 64, order: 0 },
      { id: TEXT_ID, pageId: SOURCE_PAGE_ID, parentId: ROOT_ID, type: 'text', name: 'Label', x: 20, y: 20, width: 100, height: 24, text: 'Continue', order: 0 },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

const component: DesignComponent = {
  id: COMPONENT_ID,
  name: 'Button',
  description: '',
  rootElementId: ROOT_ID,
  setId: null,
  variantValues: {},
  properties: [{ id: PROPERTY_ID, name: 'Label', type: 'text', targetElementId: TEXT_ID, defaultValue: 'Continue', preferredValues: [], order: 0 }],
  key: 'button',
  libraryId: null,
  librarySourceId: null,
  codeConnect: null,
  updatedAt: NOW,
};

describe('design page history', () => {
  it('restores cross-page instances and shared generated-code links after deletion', () => {
    const current = applyDesignOperations(baseDocument(), [
      { kind: 'add-component', component },
      { kind: 'create-component-instance', componentId: COMPONENT_ID, instanceId: INSTANCE_ID, pageId: INSTANCE_PAGE_ID, parentId: null, x: 400, y: 100 },
      { kind: 'add-code-artifact', artifact: { id: ARTIFACT_ID, name: 'Button view', path: 'src/Button.svelte', framework: 'svelte', elementIds: [ROOT_ID, INSTANCE_ID], sourceRevision: 0, contentHash: 'a'.repeat(64), componentMappings: [], generatedAt: NOW } },
    ], NOW);
    const instanceChild = current.elements.find((element) => element.instanceRootId === INSTANCE_ID && element.instanceSourceId === TEXT_ID)!;
    const inverse = pageDeleteInverseOperations(current, SOURCE_PAGE_ID)!;

    const deleted = applyDesignOperations(current, [{ kind: 'delete-page', pageId: SOURCE_PAGE_ID }], NOW);
    expect(deleted.components).toEqual([]);
    expect(deleted.elements.find((element) => element.id === INSTANCE_ID)?.instanceOf).toBeNull();
    expect(deleted.codeArtifacts[0].elementIds).toEqual([INSTANCE_ID]);

    const restored = applyDesignOperations(deleted, inverse, NOW);
    expect(restored.activePageId).toBe(SOURCE_PAGE_ID);
    expect(restored.components.map((item) => item.id)).toEqual([COMPONENT_ID]);
    expect(restored.elements.find((element) => element.id === INSTANCE_ID)).toMatchObject({ instanceOf: COMPONENT_ID, instanceRootId: INSTANCE_ID });
    expect(restored.elements.find((element) => element.id === instanceChild.id)).toMatchObject({ instanceRootId: INSTANCE_ID, instanceSourceId: TEXT_ID });
    expect(restored.codeArtifacts[0].elementIds).toEqual([ROOT_ID, INSTANCE_ID]);
  });

  it('refuses to create an undo entry larger than the command-bus limit', () => {
    expect(pageDeleteInverseOperations(baseDocument(), SOURCE_PAGE_ID, 1)).toBeUndefined();
  });
});
