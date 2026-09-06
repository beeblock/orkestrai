import type { DesignElement, DesignOperation } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { rootDesignLayerIds } from './design-layer-tree.js';

type DesignClipboard = {
  documentId: string;
  elements: DesignElement[];
  rootIds: string[];
};

let clipboard: DesignClipboard | null = null;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function copyDesignLayers(documentId: string, elements: DesignElement[], selectedIds: string[]): number {
  const rootIds = rootDesignLayerIds(elements, selectedIds);
  const included = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements) {
      if (element.parentId && included.has(element.parentId) && !included.has(element.id)) {
        included.add(element.id);
        changed = true;
      }
    }
  }
  clipboard = rootIds.length
    ? { documentId, elements: cloneJson(elements.filter((element) => included.has(element.id))), rootIds }
    : null;
  return clipboard?.elements.length ?? 0;
}

export function canPasteDesignLayers(documentId: string): boolean {
  return clipboard?.documentId === documentId && clipboard.elements.length > 0;
}

export function pasteDesignLayerOperations(
  documentId: string,
  targetPageId: string,
  currentElements: DesignElement[],
  makeId: () => string,
  offset = 24,
): { operations: DesignOperation[]; selectedIds: string[] } {
  if (!clipboard || clipboard.documentId !== documentId) return { operations: [], selectedIds: [] };
  const copiedById = new Map(clipboard.elements.map((element) => [element.id, element]));
  const depth = (element: DesignElement): number => {
    const seen = new Set<string>();
    let parentId = element.parentId;
    let value = 0;
    while (parentId && copiedById.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      value += 1;
      parentId = copiedById.get(parentId)?.parentId ?? null;
    }
    return value;
  };
  const orderedElements = [...clipboard.elements].sort((left, right) => (
    depth(left) - depth(right) || left.order - right.order || left.id.localeCompare(right.id)
  ));
  const idMap = new Map(orderedElements.map((element) => [element.id, makeId()]));
  const sourceIds = new Set(orderedElements.map((element) => element.id));
  const currentById = new Map(currentElements.map((element) => [element.id, element]));
  const nextOrderByParent = new Map<string, number>();
  const rootOrder = new Map<string, number>();
  for (const id of clipboard.rootIds) {
    const element = clipboard.elements.find((candidate) => candidate.id === id);
    if (!element) continue;
    const sourceParent = element.parentId ? currentById.get(element.parentId) : null;
    const parentId = sourceParent?.pageId === targetPageId && (sourceParent.type === 'frame' || sourceParent.type === 'group')
      ? sourceParent.id
      : null;
    const key = parentId ?? '';
    const nextOrder = nextOrderByParent.get(key)
      ?? Math.max(-1, ...currentElements.filter((candidate) => candidate.pageId === targetPageId && candidate.parentId === parentId).map((candidate) => candidate.order)) + 1;
    rootOrder.set(id, nextOrder);
    nextOrderByParent.set(key, nextOrder + 1);
  }
  const operations: DesignOperation[] = orderedElements.map((element) => {
    const sourceParent = element.parentId ? currentById.get(element.parentId) : null;
    const parentId = element.parentId && sourceIds.has(element.parentId)
      ? idMap.get(element.parentId) ?? null
      : sourceParent?.pageId === targetPageId && (sourceParent.type === 'frame' || sourceParent.type === 'group')
        ? sourceParent.id
        : null;
    const clone: DesignElement = {
      ...cloneJson(element),
      id: idMap.get(element.id)!,
      pageId: targetPageId,
      parentId,
      x: element.x + offset,
      y: element.y + offset,
      order: rootOrder.get(element.id) ?? element.order,
      maskId: element.maskId && sourceIds.has(element.maskId) ? idMap.get(element.maskId) ?? null : null,
      componentId: null,
      instanceOf: null,
      instanceRootId: null,
      instanceSourceId: null,
      instanceProperties: {},
      instanceOverrides: {},
      slotAssignments: {},
      figmaSource: null,
    };
    return { kind: 'create', element: clone };
  });
  return { operations, selectedIds: clipboard.rootIds.map((id) => idMap.get(id)!).filter(Boolean) };
}

export function clearDesignClipboard(): void {
  clipboard = null;
}
