import type { Edge, Node } from '@xyflow/svelte';

/**
 * Ancora flutuante do handle de um no: o ponto da borda (+ respiro de 4px)
 * mais proximo do centro do vizinho conectado mais perto. Compartilhada por
 * NodeShell (posiciona a bolinha do handle) e OrkestraiEdge (ponta da corda)
 * para que corda e bolinha coincidam sempre — mesmo com varias conexoes no
 * mesmo no (todas as cordas convergem para a unica bolinha).
 */

type NodeLike = Pick<Node, 'id' | 'position'> & {
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
};

type Rect = { cx: number; cy: number; halfW: number; halfH: number; x: number; y: number };

const nodeIndexCache = new WeakMap<object, ReadonlyMap<string, unknown>>();
const edgeIndexCache = new WeakMap<object, ReadonlyMap<string, readonly unknown[]>>();
type Anchor = { x: number; y: number } | null;
const anchorSnapshots: Array<{ nodes: WeakRef<object>; edges: WeakRef<object>; anchors: Map<string, Anchor> }> = [];

/**
 * XYFlow publishes new node arrays for drag, dimensions and selection changes.
 * Compute a hub's nearest-neighbor anchor once per immutable node/edge snapshot,
 * not once per incident edge (quadratic work at a highly connected leader).
 * Both graph references are weak: a cached node carries callbacks into its Canvas,
 * so even a small strong snapshot cache can retain entire closed views.
 * Mutable callers must keep using floatingAnchorFor instead.
 */
export function floatingAnchorForSnapshot(nodeId: string, nodes: readonly NodeLike[], edges: readonly Pick<Edge, 'source' | 'target'>[]): Anchor {
  let snapshot = anchorSnapshots.find(item => item.nodes.deref() === nodes && item.edges.deref() === edges);
  if (!snapshot) {
    snapshot = { nodes: new WeakRef(nodes), edges: new WeakRef(edges), anchors: new Map() };
    anchorSnapshots.unshift(snapshot);
    anchorSnapshots.length = Math.min(4, anchorSnapshots.length);
  }
  const anchors = snapshot.anchors;
  if (!anchors.has(nodeId)) anchors.set(nodeId, floatingAnchorFor(nodeId, nodes, edges));
  return anchors.get(nodeId)!;
}

/** Shared indexes prevent every rendered edge from scanning the full canvas. */
export function nodeIndexFor<T extends { id: string }>(nodes: readonly T[]): ReadonlyMap<string, T> {
  const cached = nodeIndexCache.get(nodes) as ReadonlyMap<string, T> | undefined;
  if (cached) return cached;
  const index = new Map(nodes.map((node) => [node.id, node]));
  nodeIndexCache.set(nodes, index);
  return index;
}

export function connectedEdgesFor<T extends { source: string; target: string }>(nodeId: string, edges: readonly T[]): readonly T[] {
  let index = edgeIndexCache.get(edges) as ReadonlyMap<string, readonly T[]> | undefined;
  if (!index) {
    const mutable = new Map<string, T[]>();
    for (const edge of edges) {
      const sourceEdges = mutable.get(edge.source) ?? [];
      sourceEdges.push(edge);
      mutable.set(edge.source, sourceEdges);
      if (edge.target !== edge.source) {
        const targetEdges = mutable.get(edge.target) ?? [];
        targetEdges.push(edge);
        mutable.set(edge.target, targetEdges);
      }
    }
    index = mutable;
    edgeIndexCache.set(edges, index as ReadonlyMap<string, readonly unknown[]>);
  }
  return index.get(nodeId) ?? [];
}

function rectOf(node: NodeLike): Rect {
  const width = node.measured?.width ?? node.width ?? 320;
  const height = node.measured?.height ?? node.height ?? 200;
  return {
    cx: node.position.x + width / 2,
    cy: node.position.y + height / 2,
    halfW: width / 2,
    halfH: height / 2,
    x: node.position.x,
    y: node.position.y,
  };
}

/** Ancora absoluta (coordenadas de flow) do handle flutuante, ou null sem conexoes. */
export function floatingAnchorFor(nodeId: string, nodes: readonly NodeLike[], edges: readonly Pick<Edge, 'source' | 'target'>[]): { x: number; y: number } | null {
  const links = connectedEdgesFor(nodeId, edges);
  if (!links.length) return null;
  const nodesById = nodeIndexFor(nodes);
  const self = nodesById.get(nodeId);
  if (!self) return null;
  const rect = rectOf(self);

  let best: { dx: number; dy: number } | null = null;
  let bestDist = Infinity;
  for (const link of links) {
    const otherId = link.source === nodeId ? link.target : link.source;
    const other = nodesById.get(otherId);
    if (!other) continue;
    const otherRect = rectOf(other);
    const dx = otherRect.cx - rect.cx;
    const dy = otherRect.cy - rect.cy;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = { dx, dy };
    }
  }
  if (!best || (best.dx === 0 && best.dy === 0)) return null;
  const scale = Math.max(Math.abs(best.dx) / (rect.halfW + 4), Math.abs(best.dy) / (rect.halfH + 4));
  return { x: rect.cx + best.dx / scale, y: rect.cy + best.dy / scale };
}
