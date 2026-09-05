import type { DesignElement } from '../contracts/schemas/designSchemas.js';

export const designArrangeModes = [
  'left',
  'hcenter',
  'right',
  'top',
  'vcenter',
  'bottom',
  'distribute-x',
  'distribute-y',
  'tidy',
] as const;

export type DesignArrangeMode = (typeof designArrangeModes)[number];
export type DesignPositionChange = { elementId: string; x: number; y: number };

function selectedRoots(elements: DesignElement[], elementIds: string[]): DesignElement[] {
  const selected = new Set(elementIds);
  const elementMap = new Map(elements.map((element) => [element.id, element]));
  return elements.filter((element) => {
    if (!selected.has(element.id)) return false;
    let parentId = element.parentId;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = elementMap.get(parentId)?.parentId ?? null;
    }
    return true;
  });
}

function tidyPositions(elements: DesignElement[], spacing: number): Map<string, { x: number; y: number }> {
  const ordered = [...elements].sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  const rows: DesignElement[][] = [];
  for (const element of ordered) {
    const center = element.y + element.height / 2;
    const row = rows.find((candidate) => {
      const rowCenter = candidate.reduce((total, item) => total + item.y + item.height / 2, 0) / candidate.length;
      const tolerance = Math.max(8, Math.min(element.height, Math.max(...candidate.map((item) => item.height))) / 2);
      return Math.abs(rowCenter - center) <= tolerance;
    });
    if (row) row.push(element);
    else rows.push([element]);
  }

  const left = Math.min(...elements.map((element) => element.x));
  let y = Math.min(...elements.map((element) => element.y));
  const positions = new Map<string, { x: number; y: number }>();
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    let x = left;
    const rowHeight = Math.max(...row.map((element) => element.height));
    for (const element of row) {
      positions.set(element.id, { x, y });
      x += element.width + spacing;
    }
    y += rowHeight + spacing;
  }
  return positions;
}

export function arrangeDesignElements(
  elements: DesignElement[],
  pageId: string,
  elementIds: string[],
  mode: DesignArrangeMode,
  spacing = 16,
): DesignPositionChange[] {
  const uniqueIds = [...new Set(elementIds)];
  if (uniqueIds.length < 2) throw new Error('Arrange requires at least two design elements.');
  const selected = uniqueIds.map((id) => elements.find((element) => element.id === id));
  if (selected.some((element) => !element)) throw new Error('Design element not found.');
  if (selected.some((element) => element!.pageId !== pageId)) throw new Error('Design elements must belong to the requested page.');
  if (selected.some((element) => element!.locked)) throw new Error('Locked design elements cannot be arranged.');

  const roots = selectedRoots(elements, uniqueIds);
  if (roots.length < 2) throw new Error('Arrange requires at least two independent design elements.');
  if ((mode === 'distribute-x' || mode === 'distribute-y') && roots.length < 3) {
    throw new Error('Distribute requires at least three design elements.');
  }

  const left = Math.min(...roots.map((element) => element.x));
  const right = Math.max(...roots.map((element) => element.x + element.width));
  const top = Math.min(...roots.map((element) => element.y));
  const bottom = Math.max(...roots.map((element) => element.y + element.height));
  const positions = mode === 'tidy' ? tidyPositions(roots, spacing) : new Map<string, { x: number; y: number }>();

  if (mode === 'distribute-x') {
    const ordered = [...roots].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    const gap = (right - left - ordered.reduce((total, element) => total + element.width, 0)) / (ordered.length - 1);
    let x = left;
    for (const element of ordered) {
      positions.set(element.id, { x, y: element.y });
      x += element.width + gap;
    }
  } else if (mode === 'distribute-y') {
    const ordered = [...roots].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    const gap = (bottom - top - ordered.reduce((total, element) => total + element.height, 0)) / (ordered.length - 1);
    let y = top;
    for (const element of ordered) {
      positions.set(element.id, { x: element.x, y });
      y += element.height + gap;
    }
  } else if (mode !== 'tidy') {
    for (const element of roots) {
      positions.set(element.id, {
        x: mode === 'left' ? left : mode === 'hcenter' ? left + (right - left - element.width) / 2 : mode === 'right' ? right - element.width : element.x,
        y: mode === 'top' ? top : mode === 'vcenter' ? top + (bottom - top - element.height) / 2 : mode === 'bottom' ? bottom - element.height : element.y,
      });
    }
  }

  const deltas = new Map(roots.map((root) => {
    const next = positions.get(root.id) ?? { x: root.x, y: root.y };
    return [root.id, { x: next.x - root.x, y: next.y - root.y }] as const;
  }));
  const elementMap = new Map(elements.map((element) => [element.id, element]));
  const rootFor = (element: DesignElement): string | null => {
    let current: DesignElement | undefined = element;
    while (current) {
      if (deltas.has(current.id)) return current.id;
      current = current.parentId ? elementMap.get(current.parentId) : undefined;
    }
    return null;
  };

  if (elements.some((element) => element.pageId === pageId && rootFor(element) && element.locked)) {
    throw new Error('Locked descendants cannot be arranged with their parent.');
  }

  return elements.flatMap((element) => {
    if (element.pageId !== pageId) return [];
    const rootId = rootFor(element);
    if (!rootId) return [];
    const delta = deltas.get(rootId)!;
    const x = Math.round((element.x + delta.x) * 1000) / 1000;
    const y = Math.round((element.y + delta.y) * 1000) / 1000;
    return x === element.x && y === element.y ? [] : [{ elementId: element.id, x, y }];
  });
}
