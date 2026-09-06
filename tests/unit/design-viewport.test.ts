import { describe, expect, it } from 'vitest';
import { designElementSchema } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import {
  designContentBounds,
  designSceneBounds,
  labeledDesignFrames,
  visibleDesignConnections,
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
      x: -1_280,
      y: -512,
      width: 13_312,
      height: 4_352,
    });
  });

  it('uses the nominal page when the document has no visible artwork', () => {
    const hidden = { ...item(parentId, 100), visible: false };
    expect(designContentBounds([hidden], { width: 390, height: 844 })).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });

  it('labels only top-level frames like Figma instead of every internal layout frame', () => {
    const root = designElementSchema.parse({ ...item(parentId, 0), type: 'frame', name: 'Desktop' });
    const nested = designElementSchema.parse({ ...item(childId, 20, parentId), type: 'frame', name: 'Toolbar' });
    expect(labeledDesignFrames([root, nested]).map((element) => element.name)).toEqual(['Desktop']);
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
    expect(designSceneBounds([local], { width: 1_440, height: 1_024 })).toEqual({ x: -512, y: -512, width: 2_560, height: 2_048 });
  });

  it('culls large prototype connection sets while preserving crossing and selected connections', () => {
    const connections = Array.from({ length: 250 }, (_, index) => ({
      id: String(index),
      source: item(`00000000-0000-7000-8100-${String(index).padStart(12, '0')}`, 2_000 + index * 100),
      target: item(`00000000-0000-7000-8200-${String(index).padStart(12, '0')}`, 2_100 + index * 100),
    }));
    connections.push({ id: 'crossing', source: item('00000000-0000-7000-8300-000000000001', -200), target: item('00000000-0000-7000-8300-000000000002', 300) });

    const visible = visibleDesignConnections(connections, { x: 0, y: 0, width: 200, height: 200 });
    expect(visible.map((connection) => connection.id)).toEqual(['crossing']);

    const selectedId = connections[0].source.id;
    const retained = visibleDesignConnections(connections, { x: 0, y: 0, width: 200, height: 200 }, [selectedId]);
    expect(retained.map((connection) => connection.id)).toEqual(['0', 'crossing']);
  });
});
