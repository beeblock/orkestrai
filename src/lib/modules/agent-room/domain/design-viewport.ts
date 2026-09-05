import type { DesignElement, DesignPage } from '../contracts/schemas/designSchemas.js';

export type DesignViewportBounds = { x: number; y: number; width: number; height: number };

export function designContentBounds(
  elements: DesignElement[],
  page: Pick<DesignPage, 'width' | 'height'>,
): DesignViewportBounds {
  const visible = elements.filter((element) => element.visible);
  if (!visible.length) return { x: 0, y: 0, width: page.width, height: page.height };
  const x = Math.min(...visible.map((element) => element.x));
  const y = Math.min(...visible.map((element) => element.y));
  const right = Math.max(...visible.map((element) => element.x + element.width));
  const bottom = Math.max(...visible.map((element) => element.y + element.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function designSceneBounds(
  elements: DesignElement[],
  page: Pick<DesignPage, 'width' | 'height'>,
  margin = 640,
): DesignViewportBounds {
  const content = designContentBounds(elements, page);
  const pageAndContent = {
    x: Math.min(0, content.x),
    y: Math.min(0, content.y),
    width: Math.max(page.width, content.x + content.width) - Math.min(0, content.x),
    height: Math.max(page.height, content.y + content.height) - Math.min(0, content.y),
  };
  const quantum = 4_096;
  const x = Math.floor((pageAndContent.x - margin) / quantum) * quantum;
  const y = Math.floor((pageAndContent.y - margin) / quantum) * quantum;
  const right = Math.ceil((pageAndContent.x + pageAndContent.width + margin) / quantum) * quantum;
  const bottom = Math.ceil((pageAndContent.y + pageAndContent.height + margin) / quantum) * quantum;
  return {
    x,
    y,
    width: Math.max(quantum, right - x),
    height: Math.max(quantum, bottom - y),
  };
}

function intersects(element: DesignElement, bounds: DesignViewportBounds): boolean {
  return element.x + element.width >= bounds.x
    && element.y + element.height >= bounds.y
    && element.x <= bounds.x + bounds.width
    && element.y <= bounds.y + bounds.height;
}

export function visibleDesignElements(
  elements: DesignElement[],
  bounds: DesignViewportBounds | null,
  retainedIds: Iterable<string> = [],
  threshold = 500,
): DesignElement[] {
  if (!bounds || elements.length <= threshold) return elements;
  const map = new Map(elements.map((element) => [element.id, element]));
  const retained = new Set(retainedIds);
  const visible = new Set(elements.filter((element) => intersects(element, bounds)).map((element) => element.id));
  for (const id of retained) visible.add(id);

  const preserveDependencies = (element: DesignElement | undefined) => {
    let current = element;
    while (current) {
      visible.add(current.id);
      if (current.maskId) visible.add(current.maskId);
      current = current.parentId ? map.get(current.parentId) : undefined;
    }
  };
  for (const id of [...visible]) preserveDependencies(map.get(id));
  return elements.filter((element) => visible.has(element.id));
}
