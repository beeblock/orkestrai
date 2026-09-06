import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { designDeliveryReadiness } from '$lib/modules/agent-room/domain/design-delivery-readiness.js';

const id = (suffix: number) => `00000000-0000-7000-8000-${String(suffix).padStart(12, '0')}`;

function document() {
  const now = '2026-09-06T12:00:00.000Z';
  const collectionId = id(10);
  const modeId = id(11);
  const desktopId = id(20);
  const mobileId = id(21);
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: id(1),
    nodeId: id(2),
    workspaceId: id(3),
    name: 'Todo app',
    revision: 8,
    activePageId: id(4),
    pages: [
      { id: id(4), name: 'Product', width: 1440, height: 1024, background: '#fff', order: 0 },
      { id: id(5), name: 'Brand board', width: 1440, height: 1024, background: '#fff', order: 1 },
    ],
    elements: [
      { id: desktopId, pageId: id(4), parentId: null, type: 'frame', name: 'Desktop / Todo', x: 0, y: 0, width: 1440, height: 900, variableBindings: { fill: id(12) }, order: 0 },
      { id: mobileId, pageId: id(4), parentId: null, type: 'frame', name: 'Mobile / Todo', x: 1520, y: 0, width: 390, height: 844, variableBindings: { fill: id(12), cornerRadius: id(15) }, order: 1 },
      { id: id(22), pageId: id(5), parentId: null, type: 'frame', name: 'Brand palette', x: 0, y: 0, width: 1200, height: 800, variableBindings: { layoutGap: id(13), effects: id(20) }, order: 2 },
      { id: id(23), pageId: id(5), parentId: id(22), type: 'text', name: 'Brand wordmark', x: 40, y: 40, width: 320, height: 80, text: 'Tempo', order: 3 },
      { id: id(24), pageId: id(5), parentId: id(22), type: 'rectangle', name: 'Accent swatch', x: 40, y: 140, width: 120, height: 120, order: 4 },
    ],
    variableCollections: [{ id: collectionId, name: 'System', modes: [{ id: modeId, name: 'Light' }], defaultModeId: modeId, order: 0 }],
    variables: [
      ['color', 'Surface'], ['color', 'Text'], ['color', 'Accent'], ['spacing', 'Space 4'],
      ['radius', 'Radius md'], ['font-size', 'Body'], ['font-weight', 'Medium'], ['line-height', 'Body line'], ['effect', 'Elevation sm'],
    ].map(([type, name], index) => ({
      id: id(12 + index),
      collectionId,
      name,
      type,
      values: {
        [modeId]: type === 'color'
          ? { kind: 'color', value: '#ffffff' }
          : type === 'effect'
            ? { kind: 'effect', value: [{ type: 'drop-shadow', color: '#00000022', x: 0, y: 4, blur: 12, spread: 0, visible: true }] }
            : { kind: 'number', value: 16 },
      },
      order: index,
    })),
    components: [{ id: id(30), name: 'Todo row', rootElementId: desktopId, key: 'todo-row', updatedAt: now }],
    prototypeFlows: [{ id: id(31), name: 'Complete task', startFrameId: desktopId, order: 0 }],
    prototypeInteractions: Array.from({ length: 4 }, (_, index) => ({ id: id(32 + index), sourceElementId: desktopId, trigger: { type: 'click', delayMs: 0 }, action: { type: 'navigate', targetFrameId: mobileId }, transition: { type: 'dissolve', direction: 'left', durationMs: 200, easing: { type: 'preset', value: 'ease-out' } }, order: index })),
    motionTokens: [{ id: id(40), name: 'Motion quick', durationMs: 160, easing: { type: 'preset', value: 'ease-out' }, order: 0 }],
    codeArtifacts: [{ id: id(33), name: 'Todo', path: 'src/routes/+page.svelte', framework: 'svelar', elementIds: [desktopId], sourceRevision: 7, contentHash: 'a'.repeat(64), generatedAt: now }],
    createdAt: now,
    updatedAt: now,
  });
}

describe('design delivery readiness', () => {
  it('requires the complete design-to-code contract at the current approved revision', () => {
    const ready = designDeliveryReadiness(document(), { visualReview: { status: 'approved', revision: 8 } });
    expect(ready.deliveryComplete).toBe(true);
    expect(ready.missing).toEqual([]);
  });

  it('does not call a visual concept a complete delivery', () => {
    const concept = document();
    concept.pages = concept.pages.slice(0, 1);
    concept.variables = [];
    concept.variableCollections = [];
    concept.components = [];
    concept.prototypeFlows = [];
    concept.prototypeInteractions = [];
    concept.codeArtifacts = [];
    concept.elements = concept.elements
      .filter((element) => element.pageId === concept.pages[0].id)
      .map((element) => ({ ...element, variableBindings: {} }));
    const readiness = designDeliveryReadiness(concept, { visualReview: { status: 'approved', revision: 7 } });
    expect(readiness.deliveryComplete).toBe(false);
    expect(readiness.missing).toEqual(expect.arrayContaining(['brandBoard', 'tokenSystem', 'tokenBindings', 'components', 'prototype', 'codeArtifact', 'currentApproval']));
  });

  it('requires only the frame class selected for a single-platform exploration', () => {
    const desktopOnly = document();
    desktopOnly.elements = desktopOnly.elements.filter((element) => element.id !== id(21));
    expect(designDeliveryReadiness(desktopOnly, { platform: 'desktop' }).completed).toContain('responsiveFrames');
    expect(designDeliveryReadiness(desktopOnly, { platform: 'native-mobile' }).missing).toContain('responsiveFrames');
  });
});
