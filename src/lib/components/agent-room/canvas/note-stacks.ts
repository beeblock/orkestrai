/**
 * Notes an agent writes for itself pile up around it. A note whose only
 * connection is one agent belongs to that agent's stack; an agent with two or
 * more such notes shows the newest one with a count and hides the rest until
 * the owner expands the stack.
 */
export type StackNode = { id: string; type?: string };
export type StackEdge = { source: string; target: string };
export type NoteStack = { agentId: string; noteIds: string[] };

export function computeNoteStacks(nodes: readonly StackNode[], edges: readonly StackEdge[]): NoteStack[] {
  const types = new Map(nodes.map((node) => [node.id, node.type]));
  const neighbours = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (types.get(edge.source) === 'note') (neighbours.get(edge.source) ?? neighbours.set(edge.source, new Set()).get(edge.source)!).add(edge.target);
    if (types.get(edge.target) === 'note') (neighbours.get(edge.target) ?? neighbours.set(edge.target, new Set()).get(edge.target)!).add(edge.source);
  }
  const byAgent = new Map<string, string[]>();
  // Canvas order is creation order, so the last note of a stack is the newest.
  for (const node of nodes) {
    if (node.type !== 'note') continue;
    const linked = neighbours.get(node.id);
    if (!linked || linked.size !== 1) continue;
    const [agentId] = linked;
    if (types.get(agentId) !== 'terminal') continue;
    (byAgent.get(agentId) ?? byAgent.set(agentId, []).get(agentId)!).push(node.id);
  }
  return [...byAgent.entries()]
    .filter(([, noteIds]) => noteIds.length >= 2)
    .map(([agentId, noteIds]) => ({ agentId, noteIds }));
}

/** Ids hidden by collapsed stacks: every note except the newest one. */
export function hiddenStackedNotes(stacks: readonly NoteStack[], expanded: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  for (const stack of stacks) {
    if (expanded.has(stack.agentId)) continue;
    for (const noteId of stack.noteIds.slice(0, -1)) hidden.add(noteId);
  }
  return hidden;
}
