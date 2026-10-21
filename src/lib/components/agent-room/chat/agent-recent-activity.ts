import type { AgentActivity } from '$lib/modules/agent-room/domain/types.js';

const STATE_BLIPS = new Set(['working', 'idle']);

/**
 * An agent's latest activity, newest first, from a snapshot already ordered
 * newest first. Plain working/idle flips are left out once there is anything
 * with substance, since the header already shows the current state.
 */
export function recentAgentActivity(activity: readonly AgentActivity[], nodeId: string, limit = 8): AgentActivity[] {
  const own = activity.filter((event) => event.nodeId === nodeId);
  const meaningful = own.filter((event) => event.objectTitle || !STATE_BLIPS.has(event.state));
  return (meaningful.length ? meaningful : own).slice(0, limit);
}
