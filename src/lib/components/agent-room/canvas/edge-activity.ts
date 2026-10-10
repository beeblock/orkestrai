type ActivityEdge = { source: string; target: string; data?: Record<string, unknown> };
type ActivityNode = { id: string; type?: string };
export type EdgeActivity = { from: string | null; to: string; talking: boolean };

/** A user/system prompt has no agent-to-agent edge: never animate its assets. */
export function applyEdgeActivity<T extends ActivityEdge>(edges: T[], nodes: ActivityNode[], activity: EdgeActivity): T[] {
  if (!activity.from) return edges;
  const terminals = new Set(nodes.filter(node => node.type === 'terminal').map(node => node.id));
  if (!terminals.has(activity.from) || !terminals.has(activity.to)) return edges;
  let changed = false;
  const next = edges.map(edge => {
    const matches = (edge.source === activity.from && edge.target === activity.to)
      || (edge.target === activity.from && edge.source === activity.to);
    if (!matches || Boolean(edge.data?.talking) === activity.talking) return edge;
    changed = true;
    return { ...edge, data: { ...edge.data, talking: activity.talking } };
  });
  return changed ? next : edges;
}
