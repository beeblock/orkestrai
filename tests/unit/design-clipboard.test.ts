import { describe, expect, it } from 'vitest';
import { designElementSchema, type DesignElement } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { canPasteDesignLayers, clearDesignClipboard, copyDesignLayers, pasteDesignLayerOperations } from '$lib/components/agent-room/design/design-clipboard.js';

const DOCUMENT_ID = '00000000-0000-7000-8000-000000000001';
const PAGE_ID = '00000000-0000-7000-8000-000000000002';
const FRAME_ID = '00000000-0000-7000-8000-000000000003';
const TEXT_ID = '00000000-0000-7000-8000-000000000004';
const NOW = '2026-09-05T12:00:00.000Z';

function element(input: Partial<DesignElement> & Pick<DesignElement, 'id' | 'type' | 'name'>): DesignElement {
  return designElementSchema.parse({
    pageId: PAGE_ID,
    parentId: null,
    x: 10,
    y: 20,
    width: 100,
    height: 100,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  });
}

const elements = [
  element({ id: TEXT_ID, type: 'text', name: 'Title', parentId: FRAME_ID, text: 'Hello' }),
  element({ id: FRAME_ID, type: 'frame', name: 'Card', componentId: '00000000-0000-7000-8000-000000000010' }),
];

describe('design layer clipboard', () => {
  it('copies descendants and pastes an independent hierarchy with remapped ids', () => {
    let id = 20;
    const makeId = () => `00000000-0000-7000-8000-${String(id++).padStart(12, '0')}`;
    expect(copyDesignLayers(DOCUMENT_ID, elements, [FRAME_ID])).toBe(2);
    expect(canPasteDesignLayers(DOCUMENT_ID)).toBe(true);

    const pasted = pasteDesignLayerOperations(DOCUMENT_ID, PAGE_ID, elements, makeId);
    const clones = pasted.operations.map((operation) => operation.kind === 'create' ? operation.element : null).filter(Boolean) as DesignElement[];
    const frame = clones.find((candidate) => candidate.type === 'frame')!;
    const text = clones.find((candidate) => candidate.type === 'text')!;
    expect(clones.map((candidate) => candidate.type)).toEqual(['frame', 'text']);
    expect(frame).toMatchObject({ x: 34, y: 44, componentId: null, parentId: null, order: 1 });
    expect(text).toMatchObject({ x: 34, y: 44, parentId: frame.id });
    expect(pasted.selectedIds).toEqual([frame.id]);
  });

  it('keeps copied children in an existing parent and appends their sibling order', () => {
    const sibling = element({ id: '00000000-0000-7000-8000-000000000005', type: 'text', name: 'Subtitle', parentId: FRAME_ID, order: 3, text: 'Details' });
    copyDesignLayers(DOCUMENT_ID, elements, [TEXT_ID]);
    const pasted = pasteDesignLayerOperations(DOCUMENT_ID, PAGE_ID, [...elements, sibling], () => '00000000-0000-7000-8000-000000000021');
    const operation = pasted.operations[0];
    expect(operation.kind === 'create' ? operation.element : null).toMatchObject({ parentId: FRAME_ID, order: 4 });
  });

  it('does not expose copied design content to a different document', () => {
    copyDesignLayers(DOCUMENT_ID, elements, [FRAME_ID]);
    expect(canPasteDesignLayers('another-document')).toBe(false);
    expect(pasteDesignLayerOperations('another-document', PAGE_ID, elements, () => crypto.randomUUID()).operations).toEqual([]);
    clearDesignClipboard();
  });
});
