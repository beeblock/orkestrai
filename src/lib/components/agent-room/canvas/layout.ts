/**
 * Utilitarios de layout do canvas: alinhar e distribuir nos selecionados.
 * Funcoes puras (testaveis) — retornam novas posicoes por id.
 */

export type LayoutRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV';

export function alignRects(rects: LayoutRect[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (rects.length < 2) return result;

  const minX = Math.min(...rects.map((rect) => rect.x));
  const maxRight = Math.max(...rects.map((rect) => rect.x + rect.width));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxBottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const midX = (minX + maxRight) / 2;
  const midY = (minY + maxBottom) / 2;

  for (const rect of rects) {
    let x = rect.x;
    let y = rect.y;
    switch (mode) {
      case 'left':
        x = minX;
        break;
      case 'right':
        x = maxRight - rect.width;
        break;
      case 'top':
        y = minY;
        break;
      case 'bottom':
        y = maxBottom - rect.height;
        break;
      case 'centerH':
        x = midX - rect.width / 2;
        break;
      case 'centerV':
        y = midY - rect.height / 2;
        break;
    }
    result.set(rect.id, { x, y });
  }
  // Lined-up nodes never land on top of each other: stack them along the free axis.
  const gap = 24;
  const vertical = mode === 'left' || mode === 'right' || mode === 'centerH';
  const ordered = [...rects].sort((one, two) => vertical ? one.y - two.y || one.x - two.x : one.x - two.x || one.y - two.y);
  let edge = -Infinity;
  for (const rect of ordered) {
    const point = result.get(rect.id)!;
    if (vertical) {
      const y = Math.max(point.y, edge);
      result.set(rect.id, { x: point.x, y });
      edge = y + rect.height + gap;
    } else {
      const x = Math.max(point.x, edge);
      result.set(rect.id, { x, y: point.y });
      edge = x + rect.width + gap;
    }
  }
  return result;
}

export function distributeRects(rects: LayoutRect[], axis: 'horizontal' | 'vertical'): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (rects.length < 3) return result;

  const sorted = [...rects].sort((a, b) => (axis === 'horizontal' ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const spanStart = axis === 'horizontal' ? first.x : first.y;
  const spanEnd = axis === 'horizontal' ? last.x + last.width : last.y + last.height;
  const totalSize = sorted.reduce((sum, rect) => sum + (axis === 'horizontal' ? rect.width : rect.height), 0);
  const gap = (spanEnd - spanStart - totalSize) / (sorted.length - 1);

  let cursor = spanStart;
  for (const rect of sorted) {
    result.set(rect.id, {
      x: axis === 'horizontal' ? cursor : rect.x,
      y: axis === 'vertical' ? cursor : rect.y,
    });
    cursor += (axis === 'horizontal' ? rect.width : rect.height) + gap;
  }
  return result;
}

/**
 * Organiza (tidy): arranja os retangulos em grade compacta comecando
 * pelo canto superior esquerdo da selecao, com espacamento fixo.
 */
export function tidyRects(rects: LayoutRect[], options: { gap?: number; maxColumns?: number } = {}): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (rects.length === 0) return result;

  const gap = options.gap ?? 24;
  const startX = Math.min(...rects.map((rect) => rect.x));
  const startY = Math.min(...rects.map((rect) => rect.y));
  const maxWidth = Math.max(...rects.map((rect) => rect.width));
  const columns = options.maxColumns ?? Math.max(1, Math.ceil(Math.sqrt(rects.length)));

  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  let rowHeight = 0;
  sorted.forEach((rect, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    if (column === 0) rowHeight = 0;
    result.set(rect.id, {
      x: startX + column * (maxWidth + gap),
      y: startY + row * (rowHeight || 0) + (row > 0 ? 0 : 0),
    });
  });

  // segunda passada: altura correta por linha
  const rowHeights = new Map<number, number>();
  sorted.forEach((rect, index) => {
    const row = Math.floor(index / columns);
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, rect.height));
  });
  const rowOffsets: number[] = [];
  let offset = 0;
  for (let row = 0; row < rowHeights.size; row += 1) {
    rowOffsets.push(offset);
    offset += (rowHeights.get(row) ?? 0) + gap;
  }
  sorted.forEach((rect, index) => {
    const row = Math.floor(index / columns);
    const current = result.get(rect.id)!;
    result.set(rect.id, { x: current.x, y: startY + rowOffsets[row] });
  });

  return result;
}

/** Bounding box de um conjunto de retangulos. */
export function boundingBox(rects: LayoutRect[]): { x: number; y: number; width: number; height: number } | null {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxRight = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxBottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxRight - minX, height: maxBottom - minY };
}

/** Inner spacing of a group frame around its members; the label sits in the extra top band. */
export const GROUP_FRAME = { pad: 40, header: 20, gap: 28 } as const;

/** The frame that wraps every member with the group's padding and label band. */
export function fitGroupFrame(rects: LayoutRect[]): { x: number; y: number; width: number; height: number } | null {
  const box = boundingBox(rects);
  if (!box) return null;
  return {
    x: box.x - GROUP_FRAME.pad,
    y: box.y - GROUP_FRAME.pad - GROUP_FRAME.header,
    width: box.width + GROUP_FRAME.pad * 2,
    height: box.height + GROUP_FRAME.pad * 2 + GROUP_FRAME.header,
  };
}

/**
 * Lays a group's members out in reading order on an even grid that starts at
 * the frame's inner corner. Columns aim for a landscape block; every column is
 * as wide as the widest member and each row as tall as its tallest one.
 */
export function arrangeGroupMembers(
  rects: LayoutRect[],
  frame: { x: number; y: number },
  gap: number = GROUP_FRAME.gap,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (!rects.length) return result;
  const cellWidth = Math.max(...rects.map((rect) => rect.width));
  const averageHeight = rects.reduce((sum, rect) => sum + rect.height, 0) / rects.length;
  const averageWidth = rects.reduce((sum, rect) => sum + rect.width, 0) / rects.length;
  const columns = Math.max(1, Math.min(rects.length, Math.ceil(Math.sqrt(rects.length * (4 / 3) * (averageHeight / averageWidth)))));
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const startX = frame.x + GROUP_FRAME.pad;
  let y = frame.y + GROUP_FRAME.pad + GROUP_FRAME.header;
  for (let start = 0; start < sorted.length; start += columns) {
    const row = sorted.slice(start, start + columns);
    row.forEach((rect, column) => result.set(rect.id, { x: startX + column * (cellWidth + gap), y }));
    y += Math.max(...row.map((rect) => rect.height)) + gap;
  }
  return result;
}

/**
 * Organizes a board by what is connected: every connected cluster becomes one
 * compact block with its most connected node (usually the leader) on top and
 * the nodes it talks to in rows below, layer by layer. Blocks are packed in
 * rows, largest first, and lone nodes close the board. `units` are the movable
 * blocks (a group counts as one); `links` join unit ids.
 */
export function organizeByConnections(
  units: LayoutRect[],
  links: Array<[string, string]>,
  options: { gap?: number; blockGap?: number } = {},
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (!units.length) return result;
  const gap = options.gap ?? 32;
  const blockGap = options.blockGap ?? 120;
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const neighbours = new Map<string, Set<string>>(units.map((unit) => [unit.id, new Set<string>()]));
  for (const [a, b] of links) {
    if (a === b || !byId.has(a) || !byId.has(b)) continue;
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  // Reading order of the current board keeps related placement stable.
  const reading = (one: LayoutRect, two: LayoutRect) => one.y - two.y || one.x - two.x;

  type Block = { width: number; height: number; places: Map<string, { x: number; y: number }> };
  const blocks: Block[] = [];
  const loose: LayoutRect[] = [];
  const seen = new Set<string>();
  for (const start of [...units].sort(reading)) {
    if (seen.has(start.id)) continue;
    const component: LayoutRect[] = [];
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length) {
      const id = queue.shift()!;
      component.push(byId.get(id)!);
      for (const next of neighbours.get(id)!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    if (component.length === 1) { loose.push(component[0]); continue; }
    // Layers by distance from the most connected node.
    const hub = [...component].sort((one, two) => neighbours.get(two.id)!.size - neighbours.get(one.id)!.size || reading(one, two))[0];
    const depth = new Map<string, number>([[hub.id, 0]]);
    const order = [hub.id];
    for (let index = 0; index < order.length; index += 1) {
      const id = order[index];
      const children = [...neighbours.get(id)!].filter((next) => !depth.has(next)).map((next) => byId.get(next)!).sort(reading);
      for (const child of children) { depth.set(child.id, depth.get(id)! + 1); order.push(child.id); }
    }
    const layers: LayoutRect[][] = [];
    for (const id of order) (layers[depth.get(id)!] ??= []).push(byId.get(id)!);
    const area = component.reduce((sum, unit) => sum + (unit.width + gap) * (unit.height + gap), 0);
    const widest = Math.max(...component.map((unit) => unit.width));
    const target = Math.max(widest, Math.sqrt(area) * 1.5);
    const places = new Map<string, { x: number; y: number }>();
    let y = 0;
    let width = 0;
    for (const layer of layers) {
      let x = 0;
      let rowHeight = 0;
      for (const unit of layer) {
        if (x > 0 && x + unit.width > target) { y += rowHeight + gap; x = 0; rowHeight = 0; }
        places.set(unit.id, { x, y });
        x += unit.width + gap;
        rowHeight = Math.max(rowHeight, unit.height);
        width = Math.max(width, x - gap);
      }
      y += rowHeight + gap * 2;
    }
    blocks.push({ width, height: y - gap * 2, places });
  }
  if (loose.length) {
    const area = loose.reduce((sum, unit) => sum + (unit.width + gap) * (unit.height + gap), 0);
    const target = Math.max(Math.max(...loose.map((unit) => unit.width)), Math.sqrt(area) * 1.5);
    const places = new Map<string, { x: number; y: number }>();
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let width = 0;
    for (const unit of [...loose].sort(reading)) {
      if (x > 0 && x + unit.width > target) { y += rowHeight + gap; x = 0; rowHeight = 0; }
      places.set(unit.id, { x, y });
      x += unit.width + gap;
      rowHeight = Math.max(rowHeight, unit.height);
      width = Math.max(width, x - gap);
    }
    blocks.push({ width, height: y + rowHeight, places });
  }
  // Pack blocks in rows, largest first, starting where the board started.
  const origin = { x: Math.min(...units.map((unit) => unit.x)), y: Math.min(...units.map((unit) => unit.y)) };
  const lone = loose.length ? blocks.pop()! : null;
  blocks.sort((one, two) => two.width * two.height - one.width * one.height);
  if (lone) blocks.push(lone);
  const totalArea = blocks.reduce((sum, block) => sum + (block.width + blockGap) * (block.height + blockGap), 0);
  const rowLimit = Math.max(Math.max(...blocks.map((block) => block.width)), Math.sqrt(totalArea) * 1.6);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.width > rowLimit) { y += rowHeight + blockGap; x = 0; rowHeight = 0; }
    for (const [id, place] of block.places) result.set(id, { x: origin.x + x + place.x, y: origin.y + y + place.y });
    x += block.width + blockGap;
    rowHeight = Math.max(rowHeight, block.height);
  }
  return result;
}

