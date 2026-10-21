export const WORKBENCH_LAYOUT_VERSION = 2 as const;
export const WORKBENCH_LAYOUT_STORAGE_PREFIX = 'orkestrai.workbench.layout.v2';
export const LEGACY_WORKBENCH_LAYOUT_STORAGE_PREFIX = 'orkestrai.workbench.layout.v1';
export const MAX_WORKBENCH_PANES = 8;

export type WorkbenchPaneId = string;
export type WorkbenchTabPlacement = 'vertical' | 'horizontal';
export type WorkbenchSplitDirection = 'horizontal' | 'vertical';

export type WorkbenchPaneState = {
  kind: 'pane';
  id: WorkbenchPaneId;
  nodeIds: string[];
  activeNodeId: string | null;
};

export type WorkbenchSplitState = {
  kind: 'split';
  id: string;
  direction: WorkbenchSplitDirection;
  children: [WorkbenchLayoutNode, WorkbenchLayoutNode];
};

export type WorkbenchLayoutNode = WorkbenchPaneState | WorkbenchSplitState;

export type WorkbenchLayout = {
  version: typeof WORKBENCH_LAYOUT_VERSION;
  activePaneId: WorkbenchPaneId;
  root: WorkbenchLayoutNode;
};

type LegacyWorkbenchPane = {
  id?: unknown;
  nodeIds?: unknown;
  activeNodeId?: unknown;
};

type LegacyWorkbenchLayout = {
  split?: unknown;
  activePaneId?: unknown;
  panes?: unknown;
};

function emptyPane(id: WorkbenchPaneId): WorkbenchPaneState {
  return { kind: 'pane', id, nodeIds: [], activeNodeId: null };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function activeFrom(ids: string[], requested: unknown): string | null {
  return typeof requested === 'string' && ids.includes(requested) ? requested : (ids[0] ?? null);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function paneIdAt(index: number): string {
  if (index === 0) return 'primary';
  if (index === 1) return 'secondary';
  return `pane-${index + 1}`;
}

function nextPaneId(layout: WorkbenchLayout): string {
  const existing = new Set(workbenchPanes(layout).map((pane) => pane.id));
  for (let index = 0; index < MAX_WORKBENCH_PANES; index += 1) {
    const candidate = paneIdAt(index);
    if (!existing.has(candidate)) return candidate;
  }
  return `pane-${Date.now()}`;
}

function nextSplitId(layout: WorkbenchLayout): string {
  const ids = new Set<string>();
  walkLayout(layout.root, (node) => {
    if (node.kind === 'split') ids.add(node.id);
  });
  let index = 1;
  while (ids.has(`split-${index}`)) index += 1;
  return `split-${index}`;
}

function walkLayout(node: WorkbenchLayoutNode, visit: (node: WorkbenchLayoutNode) => void): void {
  visit(node);
  if (node.kind === 'split') {
    walkLayout(node.children[0], visit);
    walkLayout(node.children[1], visit);
  }
}

function replaceLayoutNode(
  node: WorkbenchLayoutNode,
  nodeId: string,
  replacement: WorkbenchLayoutNode,
): WorkbenchLayoutNode {
  if (node.id === nodeId) return replacement;
  if (node.kind === 'pane') return node;
  const first = replaceLayoutNode(node.children[0], nodeId, replacement);
  const second = replaceLayoutNode(node.children[1], nodeId, replacement);
  if (first === node.children[0] && second === node.children[1]) return node;
  return { ...node, children: [first, second] };
}

function updatePane(layout: WorkbenchLayout, pane: WorkbenchPaneState): WorkbenchLayout {
  return { ...layout, root: replaceLayoutNode(layout.root, pane.id, pane) };
}

function removeNodeFromPane(pane: WorkbenchPaneState, nodeId: string): WorkbenchPaneState {
  const index = pane.nodeIds.indexOf(nodeId);
  if (index < 0) return pane;
  const nodeIds = pane.nodeIds.filter((id) => id !== nodeId);
  const activeNodeId = pane.activeNodeId === nodeId
    ? (nodeIds[Math.min(index, nodeIds.length - 1)] ?? null)
    : pane.activeNodeId;
  return { ...pane, nodeIds, activeNodeId };
}

function removeNodeFromAllPanes(layout: WorkbenchLayout, nodeId: string): WorkbenchLayout {
  let next = layout;
  for (const pane of workbenchPanes(layout)) {
    const updated = removeNodeFromPane(pane, nodeId);
    if (updated !== pane) next = updatePane(next, updated);
  }
  return next;
}

function firstPane(node: WorkbenchLayoutNode): WorkbenchPaneState {
  return node.kind === 'pane' ? node : firstPane(node.children[0]);
}

function removePaneFromTree(
  node: WorkbenchLayoutNode,
  paneId: WorkbenchPaneId,
): { root: WorkbenchLayoutNode; removed: WorkbenchPaneState; recipientId: WorkbenchPaneId } | null {
  if (node.kind === 'pane') return null;
  const [first, second] = node.children;
  if (first.kind === 'pane' && first.id === paneId) {
    return { root: second, removed: first, recipientId: firstPane(second).id };
  }
  if (second.kind === 'pane' && second.id === paneId) {
    return { root: first, removed: second, recipientId: firstPane(first).id };
  }
  const fromFirst = removePaneFromTree(first, paneId);
  if (fromFirst) {
    return { ...fromFirst, root: { ...node, children: [fromFirst.root, second] } };
  }
  const fromSecond = removePaneFromTree(second, paneId);
  if (fromSecond) {
    return { ...fromSecond, root: { ...node, children: [first, fromSecond.root] } };
  }
  return null;
}

function normalizeLegacyPane(
  raw: unknown,
  id: string,
  validNodeIds: Set<string>,
  seenNodeIds: Set<string>,
): WorkbenchPaneState {
  const value = isObject(raw) ? raw as LegacyWorkbenchPane : {};
  const nodeIds = unique(Array.isArray(value.nodeIds) ? value.nodeIds.filter((nodeId): nodeId is string => (
    typeof nodeId === 'string' && validNodeIds.has(nodeId) && !seenNodeIds.has(nodeId)
  )) : []);
  nodeIds.forEach((nodeId) => seenNodeIds.add(nodeId));
  return { kind: 'pane', id, nodeIds, activeNodeId: activeFrom(nodeIds, value.activeNodeId) };
}

function normalizeTree(
  raw: unknown,
  validNodeIds: Set<string>,
  seenNodeIds: Set<string>,
  seenIds: Set<string>,
  paneCount: { value: number },
): WorkbenchLayoutNode | null {
  if (!isObject(raw)) return null;
  if (raw.kind === 'pane') {
    if (paneCount.value >= MAX_WORKBENCH_PANES) return null;
    const requestedId = typeof raw.id === 'string' && raw.id ? raw.id : paneIdAt(paneCount.value);
    const id = seenIds.has(requestedId) ? paneIdAt(paneCount.value) : requestedId;
    seenIds.add(id);
    paneCount.value += 1;
    return normalizeLegacyPane(raw, id, validNodeIds, seenNodeIds);
  }
  if (raw.kind !== 'split' || !Array.isArray(raw.children)) return null;
  const first = normalizeTree(raw.children[0], validNodeIds, seenNodeIds, seenIds, paneCount);
  const second = normalizeTree(raw.children[1], validNodeIds, seenNodeIds, seenIds, paneCount);
  if (!first) return second;
  if (!second) return first;
  let id = typeof raw.id === 'string' && raw.id ? raw.id : `split-${paneCount.value}`;
  while (seenIds.has(id)) id = `${id}-next`;
  seenIds.add(id);
  return {
    kind: 'split',
    id,
    direction: raw.direction === 'vertical' ? 'vertical' : 'horizontal',
    children: [first, second],
  };
}

function migrateLegacyLayout(
  raw: LegacyWorkbenchLayout,
  validNodeIds: Set<string>,
  fallbackNodeId?: string | null,
): WorkbenchLayout {
  const rawPanes = Array.isArray(raw.panes) ? raw.panes : [];
  const seenNodeIds = new Set<string>();
  let primary = normalizeLegacyPane(rawPanes.find((pane) => (
    isObject(pane) && pane.id === 'primary'
  )) ?? rawPanes[0], 'primary', validNodeIds, seenNodeIds);
  let secondary = normalizeLegacyPane(rawPanes.find((pane) => (
    isObject(pane) && pane.id === 'secondary'
  )) ?? rawPanes[1], 'secondary', validNodeIds, seenNodeIds);

  if (!primary.nodeIds.length && !secondary.nodeIds.length && fallbackNodeId && validNodeIds.has(fallbackNodeId)) {
    primary = { ...primary, nodeIds: [fallbackNodeId], activeNodeId: fallbackNodeId };
  }

  const split = Boolean(raw.split) && secondary.nodeIds.length > 0;
  if (!split && secondary.nodeIds.length) {
    primary = {
      ...primary,
      nodeIds: unique([...primary.nodeIds, ...secondary.nodeIds]),
      activeNodeId: primary.activeNodeId ?? secondary.activeNodeId,
    };
    secondary = emptyPane('secondary');
  }
  const requestedPane = raw.activePaneId === 'secondary' ? 'secondary' : 'primary';
  return {
    version: WORKBENCH_LAYOUT_VERSION,
    activePaneId: split && requestedPane === 'secondary' ? 'secondary' : 'primary',
    root: split
      ? { kind: 'split', id: 'split-1', direction: 'horizontal', children: [primary, secondary] }
      : primary,
  };
}

export function createWorkbenchLayout(initialNodeId?: string | null): WorkbenchLayout {
  const primary = emptyPane('primary');
  if (initialNodeId) {
    primary.nodeIds = [initialNodeId];
    primary.activeNodeId = initialNodeId;
  }
  return { version: WORKBENCH_LAYOUT_VERSION, activePaneId: primary.id, root: primary };
}

export function workbenchLayoutStorageKey(workspaceId: string): string {
  return `${WORKBENCH_LAYOUT_STORAGE_PREFIX}.${workspaceId}`;
}

export function legacyWorkbenchLayoutStorageKey(workspaceId: string): string {
  return `${LEGACY_WORKBENCH_LAYOUT_STORAGE_PREFIX}.${workspaceId}`;
}

export function workbenchPanes(layout: WorkbenchLayout): WorkbenchPaneState[] {
  const panes: WorkbenchPaneState[] = [];
  walkLayout(layout.root, (node) => {
    if (node.kind === 'pane') panes.push(node);
  });
  return panes;
}

export function workbenchPane(layout: WorkbenchLayout, paneId: WorkbenchPaneId): WorkbenchPaneState | null {
  return workbenchPanes(layout).find((pane) => pane.id === paneId) ?? null;
}

export function normalizeWorkbenchLayout(
  raw: unknown,
  validIds: Iterable<string>,
  fallbackNodeId?: string | null,
): WorkbenchLayout {
  const validNodeIds = new Set(validIds);
  if (!isObject(raw) || raw.version !== WORKBENCH_LAYOUT_VERSION || !('root' in raw)) {
    return migrateLegacyLayout(isObject(raw) ? raw : {}, validNodeIds, fallbackNodeId);
  }

  const root = normalizeTree(raw.root, validNodeIds, new Set(), new Set(), { value: 0 })
    ?? emptyPane('primary');
  const panes = (() => {
    const result: WorkbenchPaneState[] = [];
    walkLayout(root, (node) => {
      if (node.kind === 'pane') result.push(node);
    });
    return result;
  })();
  if (panes.every((pane) => !pane.nodeIds.length) && fallbackNodeId && validNodeIds.has(fallbackNodeId)) {
    const first = panes[0];
    first.nodeIds = [fallbackNodeId];
    first.activeNodeId = fallbackNodeId;
  }
  const requestedPaneId = typeof raw.activePaneId === 'string' ? raw.activePaneId : '';
  return {
    version: WORKBENCH_LAYOUT_VERSION,
    activePaneId: panes.some((pane) => pane.id === requestedPaneId) ? requestedPaneId : panes[0].id,
    root,
  };
}

export function activeWorkbenchPane(layout: WorkbenchLayout): WorkbenchPaneState {
  return workbenchPane(layout, layout.activePaneId) ?? workbenchPanes(layout)[0];
}

export function activateWorkbenchPane(layout: WorkbenchLayout, paneId: WorkbenchPaneId): WorkbenchLayout {
  return workbenchPane(layout, paneId) ? { ...layout, activePaneId: paneId } : layout;
}

export function activateWorkbenchNode(
  layout: WorkbenchLayout,
  paneId: WorkbenchPaneId,
  nodeId: string,
): WorkbenchLayout {
  const pane = workbenchPane(layout, paneId);
  if (!pane?.nodeIds.includes(nodeId)) return layout;
  return updatePane({ ...layout, activePaneId: paneId }, { ...pane, activeNodeId: nodeId });
}

export function cycleWorkbenchNode(layout: WorkbenchLayout, direction: -1 | 1): WorkbenchLayout {
  const pane = activeWorkbenchPane(layout);
  if (pane.nodeIds.length < 2) return layout;
  const currentIndex = Math.max(0, pane.nodeIds.indexOf(pane.activeNodeId ?? ''));
  const nextIndex = (currentIndex + direction + pane.nodeIds.length) % pane.nodeIds.length;
  return activateWorkbenchNode(layout, pane.id, pane.nodeIds[nextIndex]);
}

export function cycleWorkbenchPane(layout: WorkbenchLayout, direction: -1 | 1): WorkbenchLayout {
  const panes = workbenchPanes(layout);
  if (panes.length < 2) return layout;
  const currentIndex = Math.max(0, panes.findIndex((pane) => pane.id === layout.activePaneId));
  const nextIndex = (currentIndex + direction + panes.length) % panes.length;
  return activateWorkbenchPane(layout, panes[nextIndex].id);
}

export function splitWorkbenchPane(
  layout: WorkbenchLayout,
  paneId: WorkbenchPaneId,
  direction: WorkbenchSplitDirection,
  nodeId?: string | null,
): WorkbenchLayout {
  if (workbenchPanes(layout).length >= MAX_WORKBENCH_PANES) return layout;
  let next = nodeId ? removeNodeFromAllPanes(layout, nodeId) : layout;
  const source = workbenchPane(next, paneId);
  if (!source) return layout;
  const created = emptyPane(nextPaneId(next));
  if (nodeId) {
    created.nodeIds = [nodeId];
    created.activeNodeId = nodeId;
  }
  next = {
    ...next,
    activePaneId: created.id,
    root: replaceLayoutNode(next.root, source.id, {
      kind: 'split',
      id: nextSplitId(next),
      direction,
      children: [source, created],
    }),
  };
  return next;
}

export function openWorkbenchNode(
  layout: WorkbenchLayout,
  nodeId: string,
  options: {
    paneId?: WorkbenchPaneId;
    toSide?: boolean;
    direction?: WorkbenchSplitDirection;
  } = {},
): WorkbenchLayout {
  const existing = workbenchPanes(layout).find((pane) => pane.nodeIds.includes(nodeId));
  if (!options.toSide && !options.paneId && existing) {
    return activateWorkbenchNode(layout, existing.id, nodeId);
  }
  if (options.toSide) {
    return splitWorkbenchPane(layout, layout.activePaneId, options.direction ?? 'horizontal', nodeId);
  }

  const targetPaneId = options.paneId ?? layout.activePaneId;
  const target = workbenchPane(layout, targetPaneId);
  if (!target) return layout;
  let next = removeNodeFromAllPanes(layout, nodeId);
  const cleanTarget = workbenchPane(next, targetPaneId)!;
  next = updatePane(next, {
    ...cleanTarget,
    nodeIds: [...cleanTarget.nodeIds, nodeId],
    activeNodeId: nodeId,
  });
  return { ...next, activePaneId: targetPaneId };
}

export function moveWorkbenchNode(
  layout: WorkbenchLayout,
  nodeId: string,
  paneId: WorkbenchPaneId,
): WorkbenchLayout {
  return openWorkbenchNode(layout, nodeId, { paneId });
}

export function closeWorkbenchNode(
  layout: WorkbenchLayout,
  paneId: WorkbenchPaneId,
  nodeId: string,
): WorkbenchLayout {
  const pane = workbenchPane(layout, paneId);
  if (!pane) return layout;
  return updatePane(layout, removeNodeFromPane(pane, nodeId));
}

export function closeWorkbenchPane(layout: WorkbenchLayout, paneId: WorkbenchPaneId): WorkbenchLayout {
  if (workbenchPanes(layout).length <= 1) return layout;
  const closingActivePane = layout.activePaneId === paneId;
  const removed = removePaneFromTree(layout.root, paneId);
  if (!removed) return layout;
  let next: WorkbenchLayout = {
    ...layout,
    root: removed.root,
    activePaneId: layout.activePaneId === paneId ? removed.recipientId : layout.activePaneId,
  };
  const recipient = workbenchPane(next, removed.recipientId)!;
  const mergedIds = unique([...recipient.nodeIds, ...removed.removed.nodeIds]);
  next = updatePane(next, {
    ...recipient,
    nodeIds: mergedIds,
    activeNodeId: closingActivePane
      ? removed.removed.activeNodeId ?? recipient.activeNodeId ?? mergedIds[0] ?? null
      : recipient.activeNodeId ?? removed.removed.activeNodeId ?? mergedIds[0] ?? null,
  });
  return next;
}

export function collapseWorkbenchLayout(layout: WorkbenchLayout): WorkbenchLayout {
  const panes = workbenchPanes(layout);
  const active = activeWorkbenchPane(layout);
  return {
    version: WORKBENCH_LAYOUT_VERSION,
    activePaneId: 'primary',
    root: {
      kind: 'pane',
      id: 'primary',
      nodeIds: unique([...active.nodeIds, ...panes.flatMap((pane) => pane.nodeIds)]),
      activeNodeId: active.activeNodeId ?? panes.flatMap((pane) => pane.nodeIds)[0] ?? null,
    },
  };
}

export function removeWorkbenchNode(layout: WorkbenchLayout, nodeId: string): WorkbenchLayout {
  const pane = workbenchPanes(layout).find((item) => item.nodeIds.includes(nodeId));
  let next = removeNodeFromAllPanes(layout, nodeId);
  if (pane && pane.nodeIds.length === 1 && workbenchPanes(next).length > 1) {
    next = closeWorkbenchPane(next, pane.id);
  }
  return next;
}

/** Tabs sit on top of each pane, like an editor, unless the owner chose the side list. */
export function normalizeWorkbenchTabPlacement(value: unknown): WorkbenchTabPlacement {
  return value === 'vertical' ? 'vertical' : 'horizontal';
}
