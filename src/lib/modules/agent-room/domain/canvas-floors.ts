import { canvasRectsOverlap, findFreeCanvasPosition, type CanvasPlacementRect } from './canvas-placement.js';

type FloorScopedNode = {
  type: string;
  floorId?: string | null;
  payload?: unknown;
};

type SettleNode = FloorScopedNode & CanvasPlacementRect & { id: string };

/** A provider-backed terminal: a member of the team, whichever floor it codes on. */
export function isTeamAgentNode(node: FloorScopedNode): boolean {
  return node.type === 'terminal' && Boolean((node.payload as { provider?: unknown } | null | undefined)?.provider);
}

/**
 * A floor is the worktree an agent codes in, not where the team is seen: the
 * ground floor shows its own nodes plus every agent, and a floor view shows
 * only that floor's nodes.
 */
export function shownOnFloor(node: FloorScopedNode, floorId: string | null): boolean {
  const own = node.floorId ?? null;
  return own === floorId || (floorId === null && visitsGroundFloor(node));
}

/** An agent of a floor that joins the ground view: copies made by cloning the ground layout stay on their floor. */
function visitsGroundFloor(node: FloorScopedNode): boolean {
  return isTeamAgentNode(node) && !(node.payload as { floorCloneOfNodeId?: unknown } | null | undefined)?.floorCloneOfNodeId;
}

/** Occupied area of a floor view, for placing new nodes without overlap. */
export function occupiedOnFloor(nodes: Array<FloorScopedNode & CanvasPlacementRect>, floorId: string | null): CanvasPlacementRect[] {
  return nodes
    .filter((node) => shownOnFloor(node, floorId))
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
}

/**
 * Agents placed while each floor was laid out on its own can cover a node on
 * the ground floor. Those agents move, in creation order, to a row below the
 * board; agents that already fit, and members of a group frame, stay put.
 */
export function settleFloorAgents(nodes: SettleNode[], gap = 48): Array<{ id: string; x: number; y: number }> {
  const grouped = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'group') continue;
    const members = (node.payload as { members?: unknown } | null | undefined)?.members;
    if (Array.isArray(members)) for (const id of members) if (typeof id === 'string') grouped.add(id);
  }
  const ground = nodes.filter((node) => (node.floorId ?? null) === null && node.type !== 'group');
  const visitors = nodes.filter((node) => (node.floorId ?? null) !== null && visitsGroundFloor(node) && !grouped.has(node.id));
  const occupied: CanvasPlacementRect[] = ground.map(rectOf);
  const blocked: SettleNode[] = [];
  for (const visitor of visitors) {
    if (occupied.some((rect) => canvasRectsOverlap(rectOf(visitor), rect))) blocked.push(visitor);
    else occupied.push(rectOf(visitor));
  }
  if (!blocked.length) return [];
  const left = Math.min(...occupied.map((rect) => rect.x));
  const bottom = Math.max(...occupied.map((rect) => rect.y + rect.height));
  const moves: Array<{ id: string; x: number; y: number }> = [];
  for (const visitor of blocked) {
    const position = findFreeCanvasPosition(occupied, { x: Math.round(left), y: Math.round(bottom + gap * 2), width: visitor.width, height: visitor.height }, { gap, rowsPerColumn: 1 });
    occupied.push({ ...position, width: visitor.width, height: visitor.height });
    moves.push({ id: visitor.id, ...position });
  }
  return moves;
}

function rectOf(node: CanvasPlacementRect): CanvasPlacementRect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}
