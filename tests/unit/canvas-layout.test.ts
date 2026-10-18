import { describe, expect, it } from 'vitest';
import { alignRects, distributeRects } from '$lib/components/agent-room/canvas/layout.js';

const a = { id: 'a', x: 0, y: 0, width: 100, height: 50 };
const b = { id: 'b', x: 300, y: 80, width: 200, height: 100 };
const c = { id: 'c', x: 150, y: 400, width: 100, height: 60 };

describe('alignRects', () => {
  it('alinha a esquerda pelo menor x', () => {
    const result = alignRects([a, b, c], 'left');
    expect(result.get('a')?.x).toBe(0);
    expect(result.get('b')?.x).toBe(0);
    expect(result.get('c')?.x).toBe(0);
  });

  it('alinha a direita pela maior borda direita', () => {
    const result = alignRects([a, b, c], 'right');
    expect(result.get('a')?.x).toBe(400); // 500 - 100
    expect(result.get('b')?.x).toBe(300); // 500 - 200
    expect(result.get('c')?.x).toBe(400);
  });

  it('alinha ao topo e a base', () => {
    expect(alignRects([a, b, c], 'top').get('c')?.y).toBe(0);
    expect(alignRects([a, b, c], 'bottom').get('a')?.y).toBe(410); // 460 - 50
  });

  it('centraliza horizontal e vertical', () => {
    const h = alignRects([a, b], 'centerH');
    expect(h.get('a')?.x).toBe(200); // mid 250 - 50
    expect(h.get('b')?.x).toBe(150); // mid 250 - 100
    const v = alignRects([a, b], 'centerV');
    expect(v.get('a')?.y).toBe(65); // mid 90 - 25
    expect(v.get('b')?.y).toBe(40); // mid 90 - 50
  });

  it('um no so nao move nada', () => {
    expect(alignRects([a], 'left').size).toBe(0);
  });
});

describe('distributeRects', () => {
  it('distribui horizontalmente com gaps iguais', () => {
    const result = distributeRects([a, b, c], 'horizontal');
    // span 0..500, total 400, gap = 50
    expect(result.get('a')?.x).toBe(0);
    expect(result.get('c')?.x).toBe(150);
    expect(result.get('b')?.x).toBe(300);
  });

  it('distribui verticalmente com gaps iguais', () => {
    const rects = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', x: 0, y: 150, width: 100, height: 100 },
      { id: 'c', x: 0, y: 500, width: 100, height: 100 },
    ];
    const result = distributeRects(rects, 'vertical');
    // span 0..600, total 300, gap = 150
    expect(result.get('a')?.y).toBe(0);
    expect(result.get('b')?.y).toBe(250);
    expect(result.get('c')?.y).toBe(500);
  });

  it('menos de 3 nos nao distribui', () => {
    expect(distributeRects([a, b], 'horizontal').size).toBe(0);
  });
});

describe('tidyRects', () => {
  it('arranja em grade a partir do canto superior esquerdo', async () => {
    const { tidyRects } = await import('$lib/components/agent-room/canvas/layout.js');
    const rects = [
      { id: 'a', x: 500, y: 300, width: 100, height: 50 },
      { id: 'b', x: 100, y: 100, width: 100, height: 50 },
      { id: 'c', x: 300, y: 200, width: 100, height: 50 },
      { id: 'd', x: 0, y: 0, width: 100, height: 50 },
    ];
    const result = tidyRects(rects, { gap: 24, maxColumns: 2 });
    expect(result.get('d')).toEqual({ x: 0, y: 0 });
    expect(result.get('b')).toEqual({ x: 124, y: 0 });
    expect(result.get('c')?.x).toBe(0);
    expect(result.get('c')!.y).toBeGreaterThan(0);
  });
});

describe('boundingBox', () => {
  it('calcula a caixa envolvente', async () => {
    const { boundingBox } = await import('$lib/components/agent-room/canvas/layout.js');
    const box = boundingBox([
      { id: 'a', x: 10, y: 20, width: 100, height: 50 },
      { id: 'b', x: 200, y: 0, width: 100, height: 80 },
    ]);
    expect(box).toEqual({ x: 10, y: 0, width: 290, height: 80 });
    expect(boundingBox([])).toBeNull();
  });
});

describe('group frames', () => {
  const icons = Array.from({ length: 20 }, (_, index) => ({ id: `i${index}`, x: (index * 137) % 900, y: Math.floor(index / 3) * 260 - (index % 2) * 300, width: 280, height: 240 }));

  it('wraps every member with padding and the label band', async () => {
    const { fitGroupFrame, GROUP_FRAME } = await import('$lib/components/agent-room/canvas/layout.js');
    const frame = fitGroupFrame([a, b, c])!;
    expect(frame).toEqual({ x: -GROUP_FRAME.pad, y: -GROUP_FRAME.pad - GROUP_FRAME.header, width: 500 + GROUP_FRAME.pad * 2, height: 460 + GROUP_FRAME.pad * 2 + GROUP_FRAME.header });
    expect(fitGroupFrame([])).toBeNull();
  });

  it('arranges scattered members on an even grid inside the frame', async () => {
    const { arrangeGroupMembers, fitGroupFrame, GROUP_FRAME } = await import('$lib/components/agent-room/canvas/layout.js');
    const positions = arrangeGroupMembers(icons, { x: 1000, y: 500 });
    expect(positions.size).toBe(20);
    const xs = new Set([...positions.values()].map((point) => point.x));
    const ys = new Set([...positions.values()].map((point) => point.y));
    expect(xs.size).toBe(5);
    expect(ys.size).toBe(4);
    expect(Math.min(...xs)).toBe(1000 + GROUP_FRAME.pad);
    expect(Math.min(...ys)).toBe(500 + GROUP_FRAME.pad + GROUP_FRAME.header);
    // No two members overlap once arranged.
    const placed = icons.map((icon) => ({ ...icon, ...positions.get(icon.id)! }));
    for (const one of placed) for (const other of placed) {
      if (one.id === other.id) continue;
      expect(one.x + one.width <= other.x || other.x + other.width <= one.x || one.y + one.height <= other.y || other.y + other.height <= one.y).toBe(true);
    }
    // The refitted frame starts where the grid was anchored.
    expect(fitGroupFrame(placed)).toMatchObject({ x: 1000, y: 500 });
  });
});
