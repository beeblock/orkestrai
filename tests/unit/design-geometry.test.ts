import { describe, expect, it } from 'vitest';
import { designElementSchema, type DesignElement } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { autoLayoutChanges, bendDesignPathSegment, combineDesignElements, constrainedChildChanges, convertDesignPathPointMode, cornerDesignPathPoint, designPathBounds, designPathData, designTextHeight, designTextLayoutLines, designTextLines, scaleDesignPathSubpaths, smoothDesignPathPoint, splitDesignPathSegment } from '$lib/modules/agent-room/domain/design-geometry.js';

const PAGE_ID = '00000000-0000-7000-8000-000000000004';

function element(id: string, changes: Partial<DesignElement>): DesignElement {
  return designElementSchema.parse({
    id,
    pageId: PAGE_ID,
    parentId: null,
    type: 'rectangle',
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    order: 0,
    ...changes,
  });
}

describe('geometria do Design Mode', () => {
  it('executa boolean union e intersection com paths editaveis', () => {
    const first = element('00000000-0000-7000-8000-000000000011', { x: 0, y: 0 });
    const second = element('00000000-0000-7000-8000-000000000012', { x: 50, y: 20 });

    const union = combineDesignElements([first, second], 'union');
    const intersection = combineDesignElements([first, second], 'intersect');

    expect(union).toMatchObject({ x: 0, y: 0, width: 150, height: 120 });
    expect(union.subpaths[0].length).toBeGreaterThanOrEqual(4);
    expect(intersection).toMatchObject({ x: 50, y: 20, width: 50, height: 80 });
  });

  it('calcula auto layout horizontal com wrap e grid', () => {
    const frame = element('00000000-0000-7000-8000-000000000013', {
      type: 'frame',
      width: 260,
      height: 300,
      layoutMode: 'horizontal',
      layoutWrap: true,
      layoutGap: 10,
      layoutRowGap: 20,
      layoutPaddingLeft: 20,
      layoutPaddingRight: 20,
      layoutPaddingTop: 20,
    });
    const children = [
      element('00000000-0000-7000-8000-000000000014', { width: 120, height: 40, order: 0 }),
      element('00000000-0000-7000-8000-000000000015', { width: 120, height: 60, order: 1 }),
    ];
    const wrapped = autoLayoutChanges(frame, children);
    expect(wrapped.get(children[0].id)).toMatchObject({ x: 20, y: 20 });
    expect(wrapped.get(children[1].id)).toMatchObject({ x: 20, y: 80 });

    const grid = autoLayoutChanges({ ...frame, layoutMode: 'grid', layoutGridColumns: 2, layoutColumnGap: 20 }, children);
    expect(grid.get(children[0].id)).toMatchObject({ x: 20, width: 100 });
    expect(grid.get(children[1].id)).toMatchObject({ x: 140, width: 100 });
  });

  it('calcula fill, hug, cross alignment e preserva filhos absolutos', () => {
    const frame = element('00000000-0000-7000-8000-000000000020', {
      type: 'frame',
      width: 400,
      height: 120,
      heightSizing: 'hug',
      layoutMode: 'horizontal',
      layoutGap: 12,
      layoutPaddingLeft: 20,
      layoutPaddingRight: 20,
      layoutPaddingTop: 10,
      layoutPaddingBottom: 10,
      layoutCrossAlign: 'center',
    });
    const fixed = element('00000000-0000-7000-8000-000000000021', { parentId: frame.id, width: 100, height: 40, order: 0 });
    const fill = element('00000000-0000-7000-8000-000000000022', { parentId: frame.id, width: 80, height: 60, widthSizing: 'fill', minWidth: 120, order: 1 });
    const absolute = element('00000000-0000-7000-8000-000000000023', { parentId: frame.id, x: 300, y: 80, layoutItemAbsolute: true, order: 2 });

    const changes = autoLayoutChanges(frame, [fixed, fill, absolute]);

    expect(changes.get(frame.id)).toMatchObject({ height: 80 });
    expect(changes.get(fixed.id)).toMatchObject({ x: 20, y: 20, width: 100, height: 40 });
    expect(changes.get(fill.id)).toMatchObject({ x: 132, y: 10, width: 248, height: 60 });
    expect(changes.has(absolute.id)).toBe(false);
  });

  it('preserva constraints ao redimensionar o frame', () => {
    const frame = element('00000000-0000-7000-8000-000000000016', { type: 'frame', x: 10, y: 20, width: 200, height: 200 });
    const child = element('00000000-0000-7000-8000-000000000017', {
      parentId: frame.id,
      x: 160,
      y: 170,
      width: 40,
      height: 30,
      constraintHorizontal: 'right',
      constraintVertical: 'bottom',
    });
    expect(constrainedChildChanges(child, frame, { x: 10, y: 20, width: 300, height: 400 })).toMatchObject({ x: 260, y: 370 });
  });

  it('divide curvas sem alterar o seu percurso', () => {
    const points = [
      { x: 0, y: 0, inX: null, inY: null, outX: 30, outY: 0, mode: 'disconnected' as const },
      { x: 90, y: 60, inX: 60, inY: 60, outX: null, outY: null, mode: 'disconnected' as const },
    ];
    const split = splitDesignPathSegment(points, 0, 0.5, false);

    expect(split).toHaveLength(3);
    expect(split[0]).toMatchObject({ outX: 15, outY: 0 });
    expect(split[1]).toMatchObject({ x: 45, y: 30, inX: 30, inY: 15, outX: 60, outY: 45 });
    expect(split[2]).toMatchObject({ inX: 75, inY: 60 });
  });

  it('converte pontos entre corner e smooth e fecha curvas com handles', () => {
    const source = [
      { x: 0, y: 0, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
      { x: 50, y: 60, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
      { x: 100, y: 0, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
    ];
    const smooth = smoothDesignPathPoint(source, 1, false);
    expect(smooth[1].inX).not.toBeNull();
    expect(smooth[1].outX).not.toBeNull();
    expect(cornerDesignPathPoint(smooth, 1)[1]).toMatchObject({ inX: null, inY: null, outX: null, outY: null });

    const path = element('00000000-0000-7000-8000-000000000018', {
      type: 'path',
      pathPoints: [
        { ...source[0], inX: -10, inY: 0 },
        source[1],
        { ...source[2], outX: 110, outY: 0 },
      ],
      pathClosed: true,
    });
    expect(designPathData(path)).toContain('C 110 0 -10 0 0 0 Z');
  });

  it('renderiza e mede curvas com apenas uma alca sem incluir o controle nos bounds', () => {
    const points = [
      { x: 0, y: 0, inX: null, inY: null, outX: 50, outY: -100, mode: 'disconnected' as const },
      { x: 100, y: 0, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
    ];
    const path = element('00000000-0000-7000-8000-000000000019', { type: 'path', pathPoints: points });

    expect(designPathData(path)).toContain('C 50 -100 100 0 100 0');
    const bounds = designPathBounds([points], false)!;
    expect(bounds.y).toBeGreaterThan(-100);
    expect(bounds.y).toBeLessThan(-40);
    expect(bounds.height).toBeLessThan(100);
  });

  it('escala path geometry e oferece os tres modos de espelhamento', () => {
    const source = [
      { x: 0, y: 0, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
      { x: 60, y: 60, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
      { x: 120, y: 0, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
    ];
    const mirrored = convertDesignPathPointMode(source, 1, 'mirrored', false);
    expect(mirrored[1].mode).toBe('mirrored');
    expect(Math.hypot(mirrored[1].x - mirrored[1].inX!, mirrored[1].y - mirrored[1].inY!)).toBeCloseTo(
      Math.hypot(mirrored[1].x - mirrored[1].outX!, mirrored[1].y - mirrored[1].outY!),
    );
    expect(convertDesignPathPointMode(mirrored, 1, 'asymmetric', false)[1].mode).toBe('asymmetric');
    expect(convertDesignPathPointMode(mirrored, 1, 'disconnected', false)[1].mode).toBe('disconnected');

    const scaled = scaleDesignPathSubpaths([mirrored], 2, 0.5)[0];
    expect(scaled[1]).toMatchObject({ x: 120, y: 30 });
    expect(scaled[1].outX).toBeCloseTo(mirrored[1].outX! * 2);
    expect(scaled[1].outY).toBeCloseTo(mirrored[1].outY! * 0.5);
  });

  it('dobra um segmento mantendo os anchors e criando controles editaveis', () => {
    const points = [
      { x: 0, y: 0, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
      { x: 100, y: 0, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const },
    ];
    const bent = bendDesignPathSegment(points, 0, 0.5, 0, 30, false);
    expect(bent[0]).toMatchObject({ x: 0, y: 0, mode: 'disconnected' });
    expect(bent[1]).toMatchObject({ x: 100, y: 0, mode: 'disconnected' });
    expect(bent[0].outY).toBeCloseTo(40);
    expect(bent[1].inY).toBeCloseTo(40);
  });

  it('quebra texto por largura e calcula a altura necessaria sem cortar linhas', () => {
    expect(designTextLines('Complete your order', 360, 34, 700)).toEqual(['Complete your order']);
    const lines = designTextLines('Design text edited on canvas', 240, 32, 600);
    expect(lines.length).toBeGreaterThan(1);
    expect(designTextHeight('Design text edited on canvas', 240, 32, 600)).toBe(lines.length * 32 * 1.2);
    expect(designTextLayoutLines('First\nSecond', 300, 20, 400, 28, 1, 12)).toEqual([
      { text: 'First', offsetY: 0 },
      { text: 'Second', offsetY: 40 },
    ]);
  });
});
