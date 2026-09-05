import { describe, expect, it } from 'vitest';
import { applyDesignOperations } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designDocumentSchema, type DesignComponent, type DesignDocument, type DesignOperation } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';

const WORKSPACE_ID = '00000000-0000-7000-8000-000000000101';
const NODE_ID = '00000000-0000-7000-8000-000000000102';
const DOCUMENT_ID = '00000000-0000-7000-8000-000000000103';
const PAGE_ID = '00000000-0000-7000-8000-000000000104';
const ROOT_ID = '00000000-0000-7000-8000-000000000105';
const TEXT_ID = '00000000-0000-7000-8000-000000000106';
const SLOT_ID = '00000000-0000-7000-8000-000000000107';
const EXTERNAL_ID = '00000000-0000-7000-8000-000000000108';
const COMPONENT_ID = '00000000-0000-7000-8000-000000000109';
const TEXT_PROPERTY_ID = '00000000-0000-7000-8000-000000000110';
const SLOT_PROPERTY_ID = '00000000-0000-7000-8000-000000000111';
const INSTANCE_ID = '00000000-0000-7000-8000-000000000112';
const SECOND_ROOT_ID = '00000000-0000-7000-8000-000000000113';
const SECOND_COMPONENT_ID = '00000000-0000-7000-8000-000000000114';
const SET_ID = '00000000-0000-7000-8000-000000000115';
const DUPLICATE_PAGE_ID = '00000000-0000-7000-8000-000000000116';
const NOW = '2026-08-16T19:00:00.000Z';

function document(): DesignDocument {
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: DOCUMENT_ID,
    nodeId: NODE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Components',
    revision: 0,
    activePageId: PAGE_ID,
    pages: [{ id: PAGE_ID, name: 'Page 1', width: 1440, height: 1024, background: '#f5f5f3', order: 0 }],
    elements: [
      { id: ROOT_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Button', x: 100, y: 100, width: 180, height: 64, fill: '#2255ff', order: 0 },
      { id: TEXT_ID, pageId: PAGE_ID, parentId: ROOT_ID, type: 'text', name: 'Label', x: 124, y: 120, width: 100, height: 24, text: 'Continue', order: 0 },
      { id: SLOT_ID, pageId: PAGE_ID, parentId: ROOT_ID, type: 'frame', name: 'Icon slot', x: 240, y: 116, width: 32, height: 32, order: 1 },
      { id: EXTERNAL_ID, pageId: PAGE_ID, parentId: null, type: 'ellipse', name: 'Icon', x: 320, y: 100, width: 24, height: 24, order: 2 },
      { id: SECOND_ROOT_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Button disabled', x: 100, y: 220, width: 180, height: 64, fill: '#777777', order: 3 },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function component(): DesignComponent {
  return {
    id: COMPONENT_ID,
    name: 'Button',
    description: 'Primary action',
    rootElementId: ROOT_ID,
    setId: null,
    variantValues: {},
    properties: [
      { id: TEXT_PROPERTY_ID, name: 'Label', type: 'text', targetElementId: TEXT_ID, defaultValue: 'Continue', preferredValues: [], order: 0 },
      { id: SLOT_PROPERTY_ID, name: 'Leading icon', type: 'slot', targetElementId: SLOT_ID, defaultValue: null, preferredValues: [], order: 1 },
    ],
    key: 'button-primary',
    libraryId: null,
    librarySourceId: null,
    codeConnect: null,
    updatedAt: NOW,
  };
}

function seeded(): DesignDocument {
  return applyDesignOperations(document(), [{ kind: 'add-component', component: component() }], NOW);
}

describe('Design components', () => {
  it('cria instâncias vinculadas e propaga mudanças da fonte', () => {
    const current = applyDesignOperations(seeded(), [{
      kind: 'create-component-instance',
      componentId: COMPONENT_ID,
      instanceId: INSTANCE_ID,
      pageId: PAGE_ID,
      parentId: null,
      x: 500,
      y: 100,
    }], NOW);
    const root = current.elements.find((element) => element.id === INSTANCE_ID)!;
    const label = current.elements.find((element) => element.instanceRootId === INSTANCE_ID && element.instanceSourceId === TEXT_ID)!;
    expect(root).toMatchObject({ instanceOf: COMPONENT_ID, instanceRootId: INSTANCE_ID, x: 500, y: 100 });
    expect(label).toMatchObject({ text: 'Continue', x: 524, y: 120 });

    const updated = applyDesignOperations(current, [
      { kind: 'update', elementId: ROOT_ID, changes: { fill: '#ff3355' } },
      { kind: 'set-instance-property', instanceId: INSTANCE_ID, propertyId: TEXT_PROPERTY_ID, value: 'Buy now' },
    ], NOW);
    expect(updated.elements.find((element) => element.id === INSTANCE_ID)?.fill).toBe('#ff3355');
    expect(updated.elements.find((element) => element.instanceRootId === INSTANCE_ID && element.instanceSourceId === TEXT_ID)?.text).toBe('Buy now');
  });

  it('preserva overrides locais durante a sincronização', () => {
    let current = applyDesignOperations(seeded(), [{ kind: 'create-component-instance', componentId: COMPONENT_ID, instanceId: INSTANCE_ID, pageId: PAGE_ID, parentId: null, x: 500, y: 100 }], NOW);
    const labelId = current.elements.find((element) => element.instanceRootId === INSTANCE_ID && element.instanceSourceId === TEXT_ID)!.id;
    current = applyDesignOperations(current, [{ kind: 'update', elementId: labelId, changes: { opacity: 0.4 } }], NOW);
    current = applyDesignOperations(current, [{ kind: 'update', elementId: TEXT_ID, changes: { opacity: 0.8, fontSize: 20 } }], NOW);
    const label = current.elements.find((element) => element.id === labelId)!;
    expect(label.opacity).toBe(0.4);
    expect(label.fontSize).toBe(20);
  });

  it('moves component instances without creating redundant child overrides', () => {
    const current = applyDesignOperations(seeded(), [
      { kind: 'create-component-instance', componentId: COMPONENT_ID, instanceId: INSTANCE_ID, pageId: PAGE_ID, parentId: null, x: 500, y: 100 },
      { kind: 'arrange-elements', pageId: PAGE_ID, elementIds: [INSTANCE_ID, EXTERNAL_ID], mode: 'left', spacing: 16 },
    ], NOW);
    const root = current.elements.find((element) => element.id === INSTANCE_ID)!;
    const label = current.elements.find((element) => element.instanceRootId === INSTANCE_ID && element.instanceSourceId === TEXT_ID)!;

    expect(root.x).toBe(320);
    expect(root.instanceOverrides).toEqual({});
    expect(label.x).toBe(344);
  });

  it('remapeia componentes e overrides ao duplicar uma página', () => {
    let current = applyDesignOperations(seeded(), [{ kind: 'create-component-instance', componentId: COMPONENT_ID, instanceId: INSTANCE_ID, pageId: PAGE_ID, parentId: null, x: 500, y: 100 }], NOW);
    const labelId = current.elements.find((element) => element.instanceRootId === INSTANCE_ID && element.instanceSourceId === TEXT_ID)!.id;
    current = applyDesignOperations(current, [{ kind: 'update', elementId: labelId, changes: { opacity: 0.4 } }], NOW);
    current = applyDesignOperations(current, [{ kind: 'duplicate-page', pageId: PAGE_ID, duplicateId: DUPLICATE_PAGE_ID, name: 'Components copy' }], NOW);

    const copiedComponent = current.components.find((item) => item.id !== COMPONENT_ID)!;
    const copiedRoot = current.elements.find((element) => element.pageId === DUPLICATE_PAGE_ID && element.instanceOf === copiedComponent.id)!;
    const copiedSourceLabel = current.elements.find((element) => element.pageId === DUPLICATE_PAGE_ID && element.parentId === copiedComponent.rootElementId && element.name === 'Label')!;
    const copiedInstanceLabel = current.elements.find((element) => element.instanceRootId === copiedRoot.id && element.instanceSourceId === copiedSourceLabel.id)!;

    expect(copiedRoot.instanceOverrides).toHaveProperty(copiedSourceLabel.id);
    expect(copiedRoot.instanceOverrides).not.toHaveProperty(TEXT_ID);
    expect(copiedInstanceLabel.opacity).toBe(0.4);
  });

  it('atribui conteúdo arbitrário a slots e permite desanexar', () => {
    let current = applyDesignOperations(seeded(), [{ kind: 'create-component-instance', componentId: COMPONENT_ID, instanceId: INSTANCE_ID, pageId: PAGE_ID, parentId: null, x: 500, y: 100 }], NOW);
    current = applyDesignOperations(current, [{ kind: 'assign-instance-slot', instanceId: INSTANCE_ID, propertyId: SLOT_PROPERTY_ID, elementIds: [EXTERNAL_ID] }], NOW);
    const slot = current.elements.find((element) => element.instanceRootId === INSTANCE_ID && element.instanceSourceId === SLOT_ID)!;
    expect(current.elements.find((element) => element.id === EXTERNAL_ID)?.parentId).toBe(slot.id);
    current = applyDesignOperations(current, [{ kind: 'detach-component-instance', instanceId: INSTANCE_ID }], NOW);
    expect(current.elements.find((element) => element.id === INSTANCE_ID)?.instanceOf).toBeNull();
    expect(current.elements.find((element) => element.id === EXTERNAL_ID)?.parentId).toBe(slot.id);
  });

  it('organiza variantes e troca a fonte de uma instância', () => {
    const second: DesignComponent = {
      ...component(),
      id: SECOND_COMPONENT_ID,
      name: 'Button disabled',
      rootElementId: SECOND_ROOT_ID,
      key: 'button-disabled',
      properties: [],
    };
    const operations: DesignOperation[] = [
      { kind: 'add-component', component: second },
      { kind: 'add-component-set', componentSet: { id: SET_ID, name: 'Button', propertyNames: ['State'], order: 0, libraryId: null, librarySourceId: null } },
      { kind: 'update-component', componentId: COMPONENT_ID, changes: { setId: SET_ID, variantValues: { State: 'Default' } } },
      { kind: 'update-component', componentId: SECOND_COMPONENT_ID, changes: { setId: SET_ID, variantValues: { State: 'Disabled' } } },
      { kind: 'create-component-instance', componentId: COMPONENT_ID, instanceId: INSTANCE_ID, pageId: PAGE_ID, parentId: null, x: 500, y: 100 },
      { kind: 'swap-component-instance', instanceId: INSTANCE_ID, componentId: SECOND_COMPONENT_ID },
    ];
    const current = applyDesignOperations(seeded(), operations, NOW);
    expect(current.elements.find((element) => element.id === INSTANCE_ID)).toMatchObject({ instanceOf: SECOND_COMPONENT_ID, fill: '#777777' });
    expect(current.components.filter((item) => item.setId === SET_ID)).toHaveLength(2);
  });
});
