import { describe, expect, it } from 'vitest';
import { arrangeDesignElements } from '$lib/modules/agent-room/domain/design-arrangement.js';
import { applyDesignOperations } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designDocumentSchema, type DesignDocument, type DesignElement } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';

const PAGE_ID = '00000000-0000-7000-8000-000000000001';
const ids = {
  left: '00000000-0000-7000-8000-000000000002',
  middle: '00000000-0000-7000-8000-000000000003',
  right: '00000000-0000-7000-8000-000000000004',
  child: '00000000-0000-7000-8000-000000000005',
};

function element(id: string, x: number, y: number, width = 100, height = 40, parentId: string | null = null): DesignElement {
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: '00000000-0000-7000-8000-000000000010',
    nodeId: '00000000-0000-7000-8000-000000000011',
    workspaceId: '00000000-0000-7000-8000-000000000012',
    name: 'Arrange', revision: 0, activePageId: PAGE_ID,
    pages: [{ id: PAGE_ID, name: 'Page', width: 1200, height: 800, background: '#fff', order: 0 }],
    elements: [{ id, pageId: PAGE_ID, parentId, type: parentId ? 'text' : 'frame', name: id, x, y, width, height, order: 0, text: parentId ? 'Child' : '' }],
    createdAt: '2026-09-05T12:00:00.000Z', updatedAt: '2026-09-05T12:00:00.000Z',
  }).elements[0];
}

function document(elements: DesignElement[]): DesignDocument {
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: '00000000-0000-7000-8000-000000000010',
    nodeId: '00000000-0000-7000-8000-000000000011',
    workspaceId: '00000000-0000-7000-8000-000000000012',
    name: 'Arrange', revision: 0, activePageId: PAGE_ID,
    pages: [{ id: PAGE_ID, name: 'Page', width: 1200, height: 800, background: '#fff', order: 0 }],
    elements,
    createdAt: '2026-09-05T12:00:00.000Z', updatedAt: '2026-09-05T12:00:00.000Z',
  });
}

describe('design arrangement', () => {
  it('aligns roots and moves descendants by the same delta', () => {
    const source = [
      element(ids.left, 20, 40),
      element(ids.right, 300, 120),
      element(ids.child, 320, 130, 40, 20, ids.right),
    ];
    const changes = arrangeDesignElements(source, PAGE_ID, [ids.left, ids.right], 'top');
    expect(changes).toContainEqual({ elementId: ids.right, x: 300, y: 40 });
    expect(changes).toContainEqual({ elementId: ids.child, x: 320, y: 50 });
  });

  it('distributes three layers with an equal horizontal gap', () => {
    const source = [element(ids.left, 0, 0, 50), element(ids.middle, 200, 0, 50), element(ids.right, 500, 0, 50)];
    const changes = arrangeDesignElements(source, PAGE_ID, Object.values(ids).slice(0, 3), 'distribute-x');
    expect(changes).toContainEqual({ elementId: ids.middle, x: 250, y: 0 });
  });

  it('tidies rough rows using a stable gap and applies through the command bus', () => {
    const source = [element(ids.left, 20, 30), element(ids.middle, 175, 38), element(ids.right, 26, 180)];
    const current = document(source);
    const next = applyDesignOperations(current, [{
      kind: 'arrange-elements', pageId: PAGE_ID, elementIds: [ids.left, ids.middle, ids.right], mode: 'tidy', spacing: 24,
    }], '2026-09-05T12:01:00.000Z');
    expect(next.elements.find((item) => item.id === ids.left)).toMatchObject({ x: 20, y: 30 });
    expect(next.elements.find((item) => item.id === ids.middle)).toMatchObject({ x: 144, y: 30 });
    expect(next.elements.find((item) => item.id === ids.right)).toMatchObject({ x: 20, y: 94 });
  });

  it('rejects locked, cross-page, and undersized selections', () => {
    const locked = { ...element(ids.left, 0, 0), locked: true };
    expect(() => arrangeDesignElements([locked, element(ids.right, 100, 0)], PAGE_ID, [ids.left, ids.right], 'left')).toThrow('Locked');
    expect(() => arrangeDesignElements([element(ids.left, 0, 0)], PAGE_ID, [ids.left], 'left')).toThrow('at least two');
  });
});
