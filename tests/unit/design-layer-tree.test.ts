import { describe, expect, it } from 'vitest';
import { designElementSchema, type DesignElement } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { designLayerRows, rootDesignLayerIds } from '$lib/components/agent-room/design/design-layer-tree.js';

const PAGE_ID = '00000000-0000-7000-8000-000000000001';
const FRAME_ID = '00000000-0000-7000-8000-000000000002';
const TEXT_ID = '00000000-0000-7000-8000-000000000003';
const BACK_ID = '00000000-0000-7000-8000-000000000004';
const NOW = '2026-09-05T12:00:00.000Z';

function element(input: Partial<DesignElement> & Pick<DesignElement, 'id' | 'type' | 'name'>): DesignElement {
  return designElementSchema.parse({
    pageId: PAGE_ID,
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  });
}

const elements = [
  element({ id: BACK_ID, type: 'rectangle', name: 'Background', order: 0 }),
  element({ id: FRAME_ID, type: 'frame', name: 'Checkout', order: 1 }),
  element({ id: TEXT_ID, type: 'text', name: 'Headline', parentId: FRAME_ID, order: 0, text: 'Pay now' }),
];

describe('design layer tree', () => {
  it('shows topmost siblings first and preserves hierarchy', () => {
    expect(designLayerRows(elements, new Set()).map(({ element: item, depth }) => [item.name, depth])).toEqual([
      ['Checkout', 0],
      ['Headline', 1],
      ['Background', 0],
    ]);
  });

  it('collapses branches while search reveals matching ancestors', () => {
    expect(designLayerRows(elements, new Set([FRAME_ID])).map(({ element: item }) => item.id)).toEqual([FRAME_ID, BACK_ID]);
    expect(designLayerRows(elements, new Set([FRAME_ID]), 'headline').map(({ element: item }) => item.id)).toEqual([FRAME_ID, TEXT_ID]);
  });

  it('reduces a multi-selection to independent roots', () => {
    expect(rootDesignLayerIds(elements, [FRAME_ID, TEXT_ID, BACK_ID])).toEqual([FRAME_ID, BACK_ID]);
  });
});
