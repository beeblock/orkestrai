import type { AgentActivitySnapshot, AgentActivityState, ControlCenterSnapshot } from '$lib/modules/agent-room/domain/types.js';
import { ATTENTION_STATES } from './agent-identity.js';

/**
 * Live status of the agents in the open workspace, shared by every surface
 * (canvas headers, Focus, Conversation). One fetch serves all consumers; the
 * page that already listens to `controlCenterChanged` calls
 * `scheduleAgentStatusRefresh` instead of opening another socket.
 */
export const agentStatus = $state<{
  workspaceId: string | null;
  agents: Record<string, AgentActivitySnapshot>;
  counts: Partial<Record<AgentActivityState, number>>;
  attention: number;
  loaded: boolean;
}>({ workspaceId: null, agents: {}, counts: {}, attention: 0, loaded: false });

/** One shared clock for "since" labels, ticking only while a consumer is mounted. */
export const statusClock = $state({ now: Date.now() });

let consumers = 0;
let clock: ReturnType<typeof setInterval> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let dirty = false;
let generation = 0;

async function load(workspaceId: string, ticket: number): Promise<void> {
  try {
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/control-center`);
    const payload = await response.json().catch(() => null) as { data?: ControlCenterSnapshot } | ControlCenterSnapshot | null;
    if (!response.ok || !payload) return;
    const snapshot = ('data' in payload && payload.data ? payload.data : payload) as ControlCenterSnapshot;
    if (ticket !== generation || agentStatus.workspaceId !== workspaceId || !Array.isArray(snapshot.agents)) return;
    agentStatus.agents = Object.fromEntries(snapshot.agents.map((agent) => [agent.nodeId, agent]));
    agentStatus.counts = snapshot.counts ?? {};
    agentStatus.attention = snapshot.agents.filter((agent) => ATTENTION_STATES.has(agent.state)).length;
    agentStatus.loaded = true;
  } catch {
    // The previous snapshot stays on screen; the next event retries.
  }
}

function run(): void {
  const workspaceId = agentStatus.workspaceId;
  if (!workspaceId) return;
  if (inFlight) { dirty = true; return; }
  dirty = false;
  const ticket = generation;
  inFlight = load(workspaceId, ticket).finally(() => {
    inFlight = null;
    if (dirty) scheduleAgentStatusRefresh();
  });
}

/** Debounced refresh, safe to call on every activity frame. */
export function scheduleAgentStatusRefresh(delay = 300): void {
  if (!agentStatus.workspaceId || timer) return;
  timer = setTimeout(() => { timer = null; run(); }, delay);
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') scheduleAgentStatusRefresh(0);
}

/** Starts (or retargets) the shared status feed; returns a release function. */
export function retainAgentStatus(workspaceId: string | null): () => void {
  consumers += 1;
  if (consumers === 1) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    statusClock.now = Date.now();
    clock = setInterval(() => {
      if (document.visibilityState === 'visible') statusClock.now = Date.now();
    }, 30_000);
  }
  if (workspaceId !== agentStatus.workspaceId) {
    generation += 1;
    agentStatus.workspaceId = workspaceId;
    agentStatus.agents = {};
    agentStatus.counts = {};
    agentStatus.attention = 0;
    agentStatus.loaded = false;
  }
  if (workspaceId) {
    if (timer) { clearTimeout(timer); timer = null; }
    run();
  }
  return () => {
    consumers = Math.max(0, consumers - 1);
    if (consumers > 0) return;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (timer) clearTimeout(timer);
    if (clock) clearInterval(clock);
    timer = null;
    clock = null;
  };
}
