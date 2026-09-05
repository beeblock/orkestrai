import type { DesignElement } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';

export type DesignLayerRow = {
  element: DesignElement;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function designLayerRows(
  elements: DesignElement[],
  collapsedIds: ReadonlySet<string>,
  query = '',
): DesignLayerRow[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const children = new Map<string | null, DesignElement[]>();
  for (const element of elements) {
    const parentId = element.parentId && byId.has(element.parentId) ? element.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(element);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => right.order - left.order || left.name.localeCompare(right.name));

  const needle = normalized(query);
  const visibleIds = new Set<string>();
  if (needle) {
    for (const element of elements) {
      if (!normalized(`${element.name} ${element.type}`).includes(needle)) continue;
      let current: DesignElement | undefined = element;
      while (current && !visibleIds.has(current.id)) {
        visibleIds.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
  }

  const rows: DesignLayerRow[] = [];
  const visited = new Set<string>();
  const visit = (element: DesignElement, depth: number) => {
    if (visited.has(element.id) || (needle && !visibleIds.has(element.id))) return;
    visited.add(element.id);
    const nested = children.get(element.id) ?? [];
    const expanded = needle ? true : !collapsedIds.has(element.id);
    rows.push({ element, depth, hasChildren: nested.length > 0, expanded });
    if (expanded) for (const child of nested) visit(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  for (const element of elements) {
    if (visited.has(element.id) || (needle && !visibleIds.has(element.id))) continue;
    let parentId = element.parentId;
    const ancestors = new Set<string>();
    let hiddenByCollapsedAncestor = false;
    while (parentId && !ancestors.has(parentId)) {
      if (!needle && collapsedIds.has(parentId)) {
        hiddenByCollapsedAncestor = true;
        break;
      }
      ancestors.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    if (!hiddenByCollapsedAncestor) visit(element, 0);
  }
  return rows;
}

export function rootDesignLayerIds(elements: DesignElement[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds);
  const byId = new Map(elements.map((element) => [element.id, element]));
  return selectedIds.filter((id) => {
    let parentId = byId.get(id)?.parentId ?? null;
    const visited = new Set<string>();
    while (parentId) {
      if (selected.has(parentId)) return false;
      if (visited.has(parentId)) break;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return byId.has(id);
  });
}
