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
