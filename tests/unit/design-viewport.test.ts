import { describe, expect, it } from 'vitest';
import { designElementSchema } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import {
  designContentBounds,
  designSceneBounds,
  visibleDesignElements,
} from '$lib/modules/agent-room/domain/design-viewport.js';

const PAGE = '00000000-0000-7000-8000-000000000001';
const parentId = '00000000-0000-7000-8000-000000000002';
const childId = '00000000-0000-7000-8000-000000000003';

function item(id: string, x: number, parent: string | null = null) {
  return designElementSchema.parse({ id, pageId: PAGE, parentId: parent, type: 'rectangle', name: id, x, y: 0, width: 50, height: 50, order: Math.max(0, x) });
}

describe('incremental Design rendering', () => {
  it('culls distant layers while preserving parents and selected layers', () => {
    const elements = [item(parentId, 1000), item(childId, 10, parentId)];
    for (let index = 0; index < 600; index += 1) elements.push(item(`00000000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`, 2000 + index * 60));
    const visible = visibleDesignElements(elements, { x: 0, y: 0, width: 200, height: 200 }, [], 500);
    expect(visible.map((element) => element.id)).toEqual([parentId, childId]);

    const retained = visibleDesignElements(elements, { x: 0, y: 0, width: 200, height: 200 }, [elements.at(-1)!.id], 500);
    expect(retained.some((element) => element.id === elements.at(-1)!.id)).toBe(true);
  });

  it('expands the navigable scene around artwork outside the nominal page', () => {
    const elements = [
      item(parentId, -700),
      designElementSchema.parse({
        id: childId,
        pageId: PAGE,
        parentId: null,
        type: 'frame',
        name: 'Remote frame',
        x: 10_200,
        y: 2_500,
        width: 1_440,
        height: 900,
        order: 2,
      }),
    ];

    expect(designContentBounds(elements, { width: 1_440, height: 1_024 })).toEqual({
      x: -700,
      y: 0,
      width: 12_340,
      height: 3_400,
    });
    expect(designSceneBounds(elements, { width: 1_440, height: 1_024 })).toEqual({
      x: -4_096,
      y: -4_096,
      width: 16_384,
      height: 8_192,
    });
  });

  it('uses the nominal page when the document has no visible artwork', () => {
    const hidden = { ...item(parentId, 100), visible: false };
    expect(designContentBounds([hidden], { width: 390, height: 844 })).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });

  it('fits visible artwork instead of expanding it to the nominal page', () => {
    const local = designElementSchema.parse({
      id: parentId,
      pageId: PAGE,
      parentId: null,
      type: 'frame',
      name: 'Local frame',
      x: 160,
      y: 120,
      width: 480,
      height: 220,
      order: 0,
    });
    expect(designContentBounds([local], { width: 1_440, height: 1_024 })).toEqual({ x: 160, y: 120, width: 480, height: 220 });
    expect(designSceneBounds([local], { width: 1_440, height: 1_024 })).toEqual({ x: -4_096, y: -4_096, width: 8_192, height: 8_192 });
  });
});
