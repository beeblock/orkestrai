import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import louvain from 'graphology-communities-louvain';
import type { KnowledgeLink } from '$lib/modules/agent-room/domain/knowledge.js';
import { graphLinks } from './knowledge-graph-view.js';
export { graphLinks, graphPointer } from './knowledge-graph-view.js';

export type GraphPosition = { x: number; y: number; z: number };
export type LayoutInput = { ids: string[]; links: KnowledgeLink[]; previous: Record<string, GraphPosition> };

export function knowledgeCommunities(ids: string[], links: KnowledgeLink[]): Record<string, string> {
  const graph = new Graph({ type: 'undirected' });
  for (const id of [...ids].sort()) graph.addNode(id);
  for (const link of graphLinks(ids, links)) graph.addEdge(link.source, link.target);
  if (!graph.size) return Object.fromEntries(ids.map(id => [id, id]));
  const communities = louvain(graph, { randomWalk: false });
  const hubs = new Map<number, string>();
  for (const id of graph.nodes()) {
    const hub = hubs.get(communities[id]);
    if (!hub || graph.degree(id) > graph.degree(hub)) hubs.set(communities[id], id);
  }
  return Object.fromEntries(ids.map(id => [id, hubs.get(communities[id])!]));
}


function seed(id: string) {
  let value = 2166136261;
  for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296;
}

// Runs in a worker. Existing positions are fixed during incremental updates:
// new information must not rearrange the map the user is reading.
export function layoutKnowledgeGraph({ ids, links, previous }: LayoutInput): Record<string, GraphPosition> {
  const graph = new Graph({ type: 'undirected' });
  const valid = graphLinks(ids, links);
  const neighbors = new Map<string, string[]>();
  for (const link of valid) {
    neighbors.set(link.source, [...(neighbors.get(link.source) ?? []), link.target]);
    neighbors.set(link.target, [...(neighbors.get(link.target) ?? []), link.source]);
  }
  for (const id of ids) {
    const old = previous[id];
    const anchor = (neighbors.get(id) ?? []).map(key => previous[key]).find(Boolean);
    const angle = seed(id) * Math.PI * 2;
    const radius = anchor ? 35 : 30 + 90 * seed(`${id}:radius`);
    graph.addNode(id, { x: old?.x ?? (anchor?.x ?? 0) + Math.cos(angle) * radius, y: old?.y ?? (anchor?.y ?? 0) + Math.sin(angle) * radius, fixed: Boolean(old), size: 5 });
  }
  for (const link of valid) graph.addEdge(link.source, link.target);
  if (ids.length > 1) forceAtlas2.assign(graph, { iterations: 160, settings: {
    ...forceAtlas2.inferSettings(graph), barnesHutOptimize: true, gravity: 0.5,
    scalingRatio: 18, slowDown: 4, adjustSizes: false,
  } });
  const points = ids.map(id => graph.getNodeAttributes(id));
  const minX = Math.min(0, ...points.map(p => p.x)), maxX = Math.max(1, ...points.map(p => p.x));
  const minY = Math.min(0, ...points.map(p => p.y)), maxY = Math.max(1, ...points.map(p => p.y));
  const scale = Math.max(180, Math.sqrt(ids.length) * 55) / Math.max(maxX - minX, maxY - minY);
  const initial = !Object.keys(previous).length;
  const output: Record<string, GraphPosition> = {};
  for (const id of ids) {
    const point = graph.getNodeAttributes(id);
    output[id] = previous[id] ?? {
      x: Number.isFinite(point.x) ? initial ? (point.x - (minX + maxX) / 2) * scale : point.x : 0,
      y: Number.isFinite(point.y) ? initial ? (point.y - (minY + maxY) / 2) * scale : point.y : 0,
      z: (seed(`${id}:depth`) - 0.5) * Math.min(150, 20 + Math.sqrt(ids.length) * 12),
    };
  }
  return output;
}
